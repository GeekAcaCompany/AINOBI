// SPDX-License-Identifier: AGPL-3.0-only
import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createJsonPatch } from '@ainobi/courseware-cli/cli/json-patch.ts';
import {
  normalizeSceneJsonForPersistence,
  normalizeScenePatchForPersistence,
} from '@ainobi/courseware-cli/cli/scene-persistence-normalize.ts';
import { livePreviewStreamKeyForSession, publishCoursewareStreamEvent } from '../db/redis-stream.ts';
import { agentAinobiStateDir, isManagedCliWorkDir } from './agent-workspace.ts';
import { isAinobiSceneBootstrapCommand } from './agent-tool-policy.ts';

interface PersistedSessionFile {
  session_id: string;
  scene: unknown;
  live_preview_session_id?: string | null;
  courseware_synced_at?: string | null;
}

/** Last serialized scene published (or seeded) per workspace + live preview session. */
const lastSceneByWorkspace = new Map<string, unknown>();

/** Resolved session JSON path per workspace (only cached when found). */
const sessionPathByWorkspace = new Map<string, string>();
const sessionReadCache = new Map<
  string,
  { path: string; mtimeMs: number; session: PersistedSessionFile }
>();

type LivePreviewFlushSchedule = {
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<boolean>;
  options?: { livePreviewSessionId?: string | null };
};

const livePreviewFlushByWorkspace = new Map<string, LivePreviewFlushSchedule>();

const READONLY_AINOBI_BASH =
  /^\s*ainobi\s+(?:status|help(?:\s|$)|validate|inspect|scene\s+info|slide\s+(?:list|get)|element\s+(?:list|get))\b/i;

const DEFAULT_LIVE_PREVIEW_FLUSH_DEBOUNCE_MS = 250;

export function resolveLivePreviewFlushDebounceMs(): number {
  const raw = process.env.AINOBI_LIVE_PREVIEW_FLUSH_DEBOUNCE_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_LIVE_PREVIEW_FLUSH_DEBOUNCE_MS;
}

export function shouldFlushLivePreviewAfterAinobiBash(command: string): boolean {
  const trimmed = command.trim();
  if (!/\bainobi\b/i.test(trimmed)) {
    return false;
  }
  if (READONLY_AINOBI_BASH.test(trimmed)) {
    return false;
  }
  if (isAinobiSceneBootstrapCommand(trimmed)) {
    return false;
  }
  return true;
}

function workspaceKey(workspaceDir: string): string {
  return resolve(workspaceDir);
}

function cacheKey(workspaceDir: string, livePreviewSessionId: string): string {
  return `${workspaceKey(workspaceDir)}:${livePreviewSessionId.trim()}`;
}

function cloneScene(scene: unknown): unknown {
  return JSON.parse(JSON.stringify(scene)) as unknown;
}

export function invalidateAgentWorkspaceSessionCache(workspaceDir: string): void {
  const key = workspaceKey(workspaceDir);
  sessionPathByWorkspace.delete(key);
  sessionReadCache.delete(key);
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

async function findSessionFileUncached(workspaceDir: string): Promise<string | null> {
  const stateDir = agentAinobiStateDir(workspaceDir);
  if (!(await pathExists(stateDir))) {
    return null;
  }

  const currentDir = join(stateDir, '.current');
  if (await pathExists(currentDir)) {
    const currentNames = await readdir(currentDir);
    for (const name of currentNames) {
      if (!name.endsWith('.txt')) {
        continue;
      }
      const sessionId = (await readFile(join(currentDir, name), 'utf8')).trim();
      if (!sessionId) {
        continue;
      }
      const path = join(stateDir, `${sessionId}.json`);
      if (await pathExists(path)) {
        return path;
      }
    }
  }

  let newest: { path: string; mtime: number } | null = null;
  const stateNames = await readdir(stateDir);
  for (const name of stateNames) {
    if (!name.startsWith('ainobi-') || !name.endsWith('.json')) {
      continue;
    }
    const path = join(stateDir, name);
    const fileStat = await stat(path);
    if (!newest || fileStat.mtimeMs > newest.mtime) {
      newest = { path, mtime: fileStat.mtimeMs };
    }
  }
  return newest?.path ?? null;
}

async function findSessionFile(workspaceDir: string): Promise<string | null> {
  const key = workspaceKey(workspaceDir);
  const cached = sessionPathByWorkspace.get(key);
  if (cached) {
    return cached;
  }
  const path = await findSessionFileUncached(workspaceDir);
  if (path) {
    sessionPathByWorkspace.set(key, path);
  }
  return path;
}

export async function hasAgentWorkspaceCliSession(workspaceDir: string): Promise<boolean> {
  return (await findSessionFile(workspaceDir)) !== null;
}

async function readSessionFile(
  workspaceDir: string,
  sessionPath: string,
): Promise<PersistedSessionFile | null> {
  const key = workspaceKey(workspaceDir);
  try {
    const fileStat = await stat(sessionPath);
    const cached = sessionReadCache.get(key);
    if (cached && cached.path === sessionPath && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.session;
    }
    const session = JSON.parse(await readFile(sessionPath, 'utf8')) as PersistedSessionFile;
    sessionReadCache.set(key, { path: sessionPath, mtimeMs: fileStat.mtimeMs, session });
    return session;
  } catch {
    sessionReadCache.delete(key);
    return null;
  }
}

export async function readAgentWorkspaceSession(
  workspaceDir: string,
): Promise<PersistedSessionFile | null> {
  const sessionPath = await findSessionFile(workspaceDir);
  if (!sessionPath) {
    return null;
  }
  return readSessionFile(workspaceDir, sessionPath);
}

/** `work_dir` from the bound ainobi CLI session (under `$TMP/ainobi-cli/work/…`). */
export async function readAgentWorkspaceCliWorkDir(workspaceDir: string): Promise<string | null> {
  const session = (await readAgentWorkspaceSession(workspaceDir)) as {
    work_dir?: string | null;
  } | null;
  const workDir = session?.work_dir;
  if (typeof workDir !== 'string' || !workDir.trim()) {
    return null;
  }
  const resolved = resolve(workDir.trim());
  return isManagedCliWorkDir(resolved) ? resolved : null;
}

/** Seed diff baseline after host preload so the first agent mutation emits a patch. */
export function seedLivePreviewSceneCache(
  workspaceDir: string,
  scene: unknown,
  livePreviewSessionId: string,
): void {
  const liveId = livePreviewSessionId.trim();
  if (!liveId) {
    return;
  }
  lastSceneByWorkspace.set(cacheKey(workspaceDir, liveId), cloneScene(scene));
}

/**
 * Point the on-disk CLI session at the editor's current live preview stream (new id each editor open).
 */
export async function syncLivePreviewSessionInWorkspace(
  workspaceDir: string,
  livePreviewSessionId: string,
): Promise<boolean> {
  const liveId = livePreviewSessionId.trim();
  if (!liveId) {
    return false;
  }

  const sessionPath = await findSessionFile(workspaceDir);
  if (!sessionPath) {
    return false;
  }

  let session: PersistedSessionFile & { live_preview_stream_key?: string | null; version?: number };
  try {
    session = JSON.parse(await readFile(sessionPath, 'utf8')) as PersistedSessionFile & {
      live_preview_stream_key?: string | null;
      version?: number;
    };
  } catch {
    return false;
  }

  if (session.live_preview_session_id?.trim() === liveId) {
    return false;
  }

  session.live_preview_session_id = liveId;
  session.live_preview_stream_key = livePreviewStreamKeyForSession(liveId);
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  invalidateAgentWorkspaceSessionCache(workspaceDir);
  return true;
}

/**
 * Publish scene.patch to Redis from the on-disk CLI session (runs on the host, not in the agent sandbox).
 */
export async function flushAgentWorkspaceLivePreview(
  workspaceDir: string,
  options?: { livePreviewSessionId?: string | null },
): Promise<boolean> {
  const sessionPath = await findSessionFile(workspaceDir);
  if (!sessionPath) {
    return false;
  }

  const session = await readSessionFile(workspaceDir, sessionPath);
  if (!session) {
    return false;
  }

  const liveId =
    options?.livePreviewSessionId?.trim() || session.live_preview_session_id?.trim();
  if (!liveId || session.scene == null || !session.session_id?.trim()) {
    return false;
  }

  const key = cacheKey(workspaceDir, liveId);
  const nextScene = normalizeSceneJsonForPersistence(cloneScene(session.scene));
  const previous = lastSceneByWorkspace.get(key);

  if (previous === undefined) {
    lastSceneByWorkspace.set(key, nextScene);
    return false;
  }

  const patch = normalizeScenePatchForPersistence(
    createJsonPatch(previous, nextScene) as Array<Record<string, unknown>>,
  );
  lastSceneByWorkspace.set(key, nextScene);

  if (patch.length === 0) {
    return false;
  }

  const sceneId =
    typeof (nextScene as { scene_id?: unknown }).scene_id === 'string'
      ? (nextScene as { scene_id: string }).scene_id
      : 'unknown';

  await publishCoursewareStreamEvent({
    event_type: 'scene.patch',
    live_preview_session_id: liveId,
    cli_session_id: session.session_id,
    scene_id: sceneId,
    created_at: new Date().toISOString(),
    patch,
  });

  return true;
}

function flushSchedule(workspaceDir: string): LivePreviewFlushSchedule {
  const key = workspaceKey(workspaceDir);
  let schedule = livePreviewFlushByWorkspace.get(key);
  if (!schedule) {
    schedule = {};
    livePreviewFlushByWorkspace.set(key, schedule);
  }
  return schedule;
}

/** Debounced live preview flush after mutating `ainobi` Bash (coalesces rapid CLI commands). */
export function scheduleAgentWorkspaceLivePreviewFlush(
  workspaceDir: string,
  options?: { livePreviewSessionId?: string | null },
): void {
  const debounceMs = resolveLivePreviewFlushDebounceMs();
  const schedule = flushSchedule(workspaceDir);
  schedule.options = options;

  if (debounceMs === 0) {
    if (schedule.timer !== undefined) {
      clearTimeout(schedule.timer);
      schedule.timer = undefined;
    }
    schedule.inFlight = flushAgentWorkspaceLivePreview(workspaceDir, options).finally(() => {
      schedule.inFlight = undefined;
    });
    return;
  }

  if (schedule.timer !== undefined) {
    clearTimeout(schedule.timer);
  }

  schedule.timer = setTimeout(() => {
    schedule.timer = undefined;
    schedule.inFlight = flushAgentWorkspaceLivePreview(workspaceDir, schedule.options).finally(() => {
      schedule.inFlight = undefined;
    });
  }, debounceMs);
}

/** Run any pending debounced flush immediately (e.g. end of agent turn). */
export async function flushPendingAgentWorkspaceLivePreview(
  workspaceDir: string,
  options?: { livePreviewSessionId?: string | null },
): Promise<boolean> {
  const schedule = flushSchedule(workspaceDir);
  if (schedule.timer !== undefined) {
    clearTimeout(schedule.timer);
    schedule.timer = undefined;
  }
  if (schedule.inFlight) {
    return schedule.inFlight;
  }
  return flushAgentWorkspaceLivePreview(workspaceDir, options ?? schedule.options);
}

/** @internal Tests only */
export function resetLivePreviewFlushSchedulesForTests(): void {
  for (const schedule of livePreviewFlushByWorkspace.values()) {
    if (schedule.timer !== undefined) {
      clearTimeout(schedule.timer);
    }
  }
  livePreviewFlushByWorkspace.clear();
  sessionPathByWorkspace.clear();
  sessionReadCache.clear();
  lastSceneByWorkspace.clear();
}
