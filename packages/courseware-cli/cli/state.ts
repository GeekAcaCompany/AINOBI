// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { AinobiCliError, type CliIssue } from "./errors.ts";
import { assertNoNewReplacementChars } from "./replacement-char-guard.ts";
import { assertNoNewRichScaffoldText } from "./rich-layout-guards.ts";
import { normalizeTextElementsInScene } from "./text-element-normalize.ts";
import { deserializeScene, serializeScene, type Scene } from "@ainobi/courseware-core";
import { prepareSceneAssetUrlsForCliPersistence } from "./asset-url-persistence.ts";
import type { AITeacher } from "./ai-teachers.ts";
import { cliEnv } from "./env.ts";
import type { PlatformTtsVoice } from "./tts-catalog.ts";

/**
 * Session model. Only metadata is held in JSON; the scene itself is stored
 * via the same on-disk JSON the user loaded so we always round-trip cleanly.
 */
export interface SessionRecord {
  session_id: string;
  source_path: string | null;
  loaded_at: string;
  saved_at: string | null;
  dirty: boolean;
  /** ISO timestamp of DB `courseware.updated_at` when this session last matched the database. */
  courseware_synced_at?: string | null;
  work_dir?: string | null;
  scene: unknown;
  ai_teachers?: AITeacher[];
  /** Platform TTS catalog rows from `ainobi tts list --save`. */
  tts_voices?: PlatformTtsVoice[];
  live_preview_session_id?: string | null;
  live_preview_stream_key?: string | null;
}

const SESSION_FILE_VERSION = 1;

interface PersistedSession extends SessionRecord {
  version: number;
}

const sessionRoot = (): string => {
  const stateDir = cliEnv().AINOBI_STATE_DIR;
  const dir = stateDir ? resolve(stateDir) : join(tmpdir(), "ainobi-cli", "sessions");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

const sanitizeSessionId = (value: string): string =>
  value.trim().replace(/[^A-Za-z0-9._-]/g, "_");

export const hasExplicitSessionId = (): boolean => !!cliEnv().AINOBI_SESSION?.trim();

const shellSessionKey = (): string => {
  const explicitShell = cliEnv().AINOBI_SHELL_SESSION?.trim();
  if (explicitShell) return sanitizeSessionId(explicitShell);
  const ppid = process.ppid;
  if (Number.isFinite(ppid) && ppid > 0) return `ppid-${ppid}`;
  return "default";
};

const currentSessionPath = (): string =>
  join(sessionRoot(), ".current", `${shellSessionKey()}.txt`);

const readCurrentSessionId = (): string | null => {
  const file = currentSessionPath();
  if (!existsSync(file)) return null;
  const sessionId = sanitizeSessionId(readFileSync(file, "utf-8"));
  return sessionId || null;
};

export const createSessionId = (): string => `ainobi-${randomUUID()}`;

const workRoot = (): string => {
  const dir = join(tmpdir(), "ainobi-cli", "work");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

const isManagedWorkDir = (dir: string): boolean => {
  const root = resolve(workRoot());
  const target = resolve(dir);
  return target.startsWith(`${root}${sep}`);
};

export const createSessionWorkDir = (sessionId: string): string => {
  const dir = join(workRoot(), sanitizeSessionId(sessionId));
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
};

export const cleanupSessionWorkDir = (
  session: SessionRecord,
): { work_dir: string | null; cleaned: boolean; warning?: CliIssue } => {
  const dir = session.work_dir ?? null;
  if (!dir) return { work_dir: null, cleaned: false };
  if (!isManagedWorkDir(dir)) {
    return {
      work_dir: dir,
      cleaned: false,
      warning: {
        path: "work_dir",
        message: "Skipped cleanup because the path is not managed by ainobi-cli.",
        value: dir,
      },
    };
  }
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return { work_dir: dir, cleaned: true };
  } catch (error) {
    return {
      work_dir: dir,
      cleaned: false,
      warning: {
        path: "work_dir",
        message: `Failed to clean temporary work directory: ${(error as Error).message}`,
        value: dir,
      },
    };
  }
};

export const setCurrentSessionId = (sessionId: string): string => {
  const normalized = sanitizeSessionId(sessionId);
  const file = currentSessionPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${normalized}\n`, "utf-8");
  cliEnv().AINOBI_SESSION = normalized;
  return normalized;
};

export const createBoundSessionId = (): string => {
  if (hasExplicitSessionId()) return getSessionId();
  clearSessionById(readCurrentSessionId());
  return setCurrentSessionId(createSessionId());
};

const clearCurrentSessionId = (): void => {
  if (hasExplicitSessionId()) return;
  const file = currentSessionPath();
  if (existsSync(file)) rmSync(file);
};

/**
 * Identify the current shell session.
 * Priority: explicit AINOBI_SESSION → current-shell binding → parent shell PID.
 * `ainobi init` creates a unique session and binds it to the current shell key,
 * so later commands share state without requiring an explicit export.
 */
export const getSessionId = (): string => {
  const explicit = cliEnv().AINOBI_SESSION?.trim();
  if (explicit) return sanitizeSessionId(explicit);
  return readCurrentSessionId() ?? shellSessionKey();
};

const sessionPath = (sessionId = getSessionId()): string =>
  join(sessionRoot(), `${sessionId}.json`);

export const hasSession = (): boolean => existsSync(sessionPath());

const readSessionById = (sessionId: string): PersistedSession | null => {
  const file = sessionPath(sessionId);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf-8");
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
};

const clearSessionById = (sessionId: string | null): boolean => {
  if (!sessionId) return false;
  const file = sessionPath(sessionId);
  if (!existsSync(file)) return false;
  const session = readSessionById(sessionId);
  if (session) cleanupSessionWorkDir(session);
  rmSync(file);
  return true;
};

export const readSessionRaw = (): PersistedSession | null => {
  const file = sessionPath();
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || typeof parsed !== "object" || parsed.version !== SESSION_FILE_VERSION) {
      throw new Error(`unsupported session file version: ${parsed?.version}`);
    }
    return parsed;
  } catch (error) {
    throw new AinobiCliError(
      "INTERNAL",
      `Failed to read session file: ${(error as Error).message}`,
      { hint: `Try \`ainobi reset\` to wipe the session at ${file}.` },
    );
  }
};

export const requireSession = (): PersistedSession => {
  const session = readSessionRaw();
  if (!session) {
    throw new AinobiCliError(
      "NOT_LOADED",
      "No courseware loaded in this shell session.",
      {
        hint:
          "Load one first with `ainobi load <path>` or pipe JSON via `cat scene.json | ainobi load -`. In Agent/Bash environments where each tool call is a new process, set a stable `AINOBI_SHELL_SESSION` (or export `AINOBI_SESSION`) so `init`/`load` state persists across commands.",
      },
    );
  }
  return session;
};

const writeSessionFile = (session: PersistedSession): string => {
  const file = sessionPath(session.session_id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, "utf-8");
  return file;
};

export const saveSessionRecord = (session: SessionRecord): string =>
  writeSessionFile({ version: SESSION_FILE_VERSION, ...session });

export const clearSession = (): boolean => {
  const file = sessionPath();
  const had = existsSync(file);
  if (had) {
    const session = readSessionRaw();
    if (session) cleanupSessionWorkDir(session);
  }
  if (had) rmSync(file);
  clearCurrentSessionId();
  if (!had) return false;
  return true;
};

/**
 * Load + validate the scene from the persisted session.
 * Emits structured issues if any validation problem is found.
 */
export const requireScene = (): { session: PersistedSession; scene: Scene } => {
  const session = requireSession();
  const scene = deserializeScene(session.scene);
  return { session, scene };
};

export const getSessionAiTeachers = (session: SessionRecord): AITeacher[] =>
  Array.isArray(session.ai_teachers) ? session.ai_teachers : [];

export const getSessionTtsVoices = (session: SessionRecord): PlatformTtsVoice[] =>
  Array.isArray(session.tts_voices) ? session.tts_voices : [];

export const saveScene = async (
  session: PersistedSession,
  scene: Scene,
  options: { dirty?: boolean } = {},
): Promise<PersistedSession> => {
  const urlPrepared = prepareSceneAssetUrlsForCliPersistence(scene);
  const { scene: normalizedScene } = normalizeTextElementsInScene(urlPrepared);
  const nextScene = serializeScene(normalizedScene);
  assertNoNewReplacementChars(session.scene, nextScene);
  assertNoNewRichScaffoldText(session.scene, nextScene);
  const next: PersistedSession = {
    ...session,
    scene: nextScene,
    dirty: options.dirty ?? true,
  };
  writeSessionFile(next);
  return next;
};

export const stateFilePath = (sessionId?: string): string => sessionPath(sessionId);

export const sessionStat = (): { size: number; mtime: string } | null => {
  const file = sessionPath();
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  return { size: stat.size, mtime: stat.mtime.toISOString() };
};
