// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve, sep } from 'node:path';

import type { CoursewareActorContext } from '../auth/ainobi-org-access.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { redisClient } from '../db/db.ts';
import { ensureSharedRedisConnected } from '../db/redis-shared.ts';
import { REDIS_STREAM_TTL_SECONDS, resolveRedisConfig } from '../db/redis-stream.ts';
import { coursewareCliRoot, projectRoot } from '../runtime-paths.ts';
import { hasAgentWorkspaceCliSession, invalidateAgentWorkspaceSessionCache } from '../services/agent-live-preview-flush.ts';
import { pickAgentSubprocessEnv } from '../services/agent-subprocess-env.ts';
import { coursewareAssetUrlPrefixes } from '@ainobi/courseware-cli/cli/url-policy.ts';
import {
  agentAinobiStateDir,
  agentScenePath,
  ensureAgentWorkspaceLayout,
  resolveAgentWorkspaceDir,
} from '../services/agent-workspace.ts';

/** Serializable Codex MCP workspace binding (no access tokens). */
export type CodexMcpWorkspaceSession = {
  mcpSessionId: string;
  ownerUserId: string;
  coursewareId: string;
  coursewareKey: string;
  coursewareOrgId: string | null;
  workspaceDir: string;
  stateDir: string;
  shellSession: string;
  scenePath: string;
  actor: CoursewareActorContext;
  createdAt: string;
};

const sessions = new Map<string, CodexMcpWorkspaceSession>();

/**
 * Client-supplied mcp_session_id must be path-safe (no `/`, `\`, `..`).
 * Server-generated values use `randomUUID()`.
 */
export function isSafeCodexMcpSessionId(value: string): boolean {
  const id = value.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(id);
}

function assertWorkspaceUnderAgentWorkspaces(workspaceDir: string): void {
  const root = resolve(coursewareCliRoot, 'agent-workspaces');
  const resolved = resolve(workspaceDir);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error('mcp_session_id resolves outside agent-workspaces');
  }
}

const redisKey = (mcpSessionId: string): string =>
  `ainobi:codex-mcp:session:${mcpSessionId.trim()}`;

/** Match ainobi-courseware-cli `sanitizeSessionId` for `.current/<shell>.txt`. */
export function sanitizeCodexMcpShellKey(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]/g, '_');
}

export function codexMcpShellBindingPath(session: CodexMcpWorkspaceSession): string {
  return join(session.stateDir, '.current', `${sanitizeCodexMcpShellKey(session.shellSession)}.txt`);
}

async function sharedRedis() {
  if (!resolveRedisConfig()) {
    return null;
  }
  if (!(await ensureSharedRedisConnected())) {
    return null;
  }
  return redisClient;
}

function sessionTtlSeconds(): number {
  const raw = process.env.AINOBI_CODEX_MCP_SESSION_TTL_SECONDS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return REDIS_STREAM_TTL_SECONDS;
}

function parseSessionPayload(raw: string): CodexMcpWorkspaceSession | undefined {
  try {
    const parsed = JSON.parse(raw) as CodexMcpWorkspaceSession;
    if (!parsed?.mcpSessionId || !parsed.ownerUserId || !parsed.coursewareKey) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function listCodexMcpSessions(): CodexMcpWorkspaceSession[] {
  return [...sessions.values()];
}

/**
 * Load MCP session. When Redis is configured it is the source of truth
 * (local Map is write-through cache only — avoids stale cache after remote close/TTL).
 */
export async function getCodexMcpSession(
  mcpSessionId: string,
): Promise<CodexMcpWorkspaceSession | undefined> {
  const id = mcpSessionId.trim();
  if (!id) {
    return undefined;
  }

  const redis = await sharedRedis();
  if (redis) {
    try {
      const raw = await redis.get(redisKey(id));
      if (!raw) {
        sessions.delete(id);
        return undefined;
      }
      const parsed = parseSessionPayload(raw);
      if (!parsed) {
        sessions.delete(id);
        return undefined;
      }
      sessions.set(id, parsed);
      return parsed;
    } catch (error) {
      console.warn(
        '[codex-mcp] Redis get failed; falling back to local cache:',
        error instanceof Error ? error.message : error,
      );
      return sessions.get(id);
    }
  }

  return sessions.get(id);
}

export async function registerCodexMcpSession(session: CodexMcpWorkspaceSession): Promise<void> {
  sessions.set(session.mcpSessionId, session);
  const redis = await sharedRedis();
  if (!redis) {
    return;
  }
  try {
    await redis.set(
      redisKey(session.mcpSessionId),
      JSON.stringify(session),
      'EX',
      sessionTtlSeconds(),
    );
  } catch (error) {
    console.warn(
      '[codex-mcp] failed to persist session to Redis:',
      error instanceof Error ? error.message : error,
    );
  }
}

export async function deleteCodexMcpSession(mcpSessionId: string): Promise<boolean> {
  const id = mcpSessionId.trim();
  const existedLocal = sessions.delete(id);
  const redis = await sharedRedis();
  if (redis) {
    try {
      const n = await redis.del(redisKey(id));
      return existedLocal || n > 0;
    } catch {
      return existedLocal;
    }
  }
  return existedLocal;
}

/** Build PATH so `ainobi` resolves the same way as the main HTTP server. */
export function buildCodexMcpPathEnv(baseEnv: NodeJS.ProcessEnv = process.env): string {
  const systemPath =
    baseEnv.PATH?.trim() || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  return [
    resolve(projectRoot, 'bin'),
    resolve(coursewareCliRoot, 'bin'),
    resolve(coursewareCliRoot, 'node_modules', '.bin'),
    resolve(projectRoot, 'node_modules', '.bin'),
    systemPath,
  ]
    .filter(Boolean)
    .join(delimiter);
}

export function createCodexMcpWorkspaceBinding(args: {
  userSession: AinobiAuthorizedSession;
  coursewareId: string;
  coursewareKey: string;
  coursewareOrgId?: string | null;
  actor: CoursewareActorContext;
  mcpSessionId?: string;
}): CodexMcpWorkspaceSession {
  const requested = args.mcpSessionId?.trim();
  const mcpSessionId = requested || randomUUID();
  if (!isSafeCodexMcpSessionId(mcpSessionId)) {
    throw new Error(
      'Invalid mcp_session_id (use 8–128 chars of A-Za-z0-9_-, no path separators)',
    );
  }
  const workspaceDir = resolveAgentWorkspaceDir({
    coursewareCliRoot,
    conversationId: `codex-mcp-${mcpSessionId}`,
  });
  assertWorkspaceUnderAgentWorkspaces(workspaceDir);
  ensureAgentWorkspaceLayout({ workspaceDir, projectRoot });
  const stateDir = agentAinobiStateDir(workspaceDir);
  return {
    mcpSessionId,
    ownerUserId: args.userSession.userId,
    coursewareId: args.coursewareId,
    coursewareKey: args.coursewareKey,
    coursewareOrgId: args.coursewareOrgId?.trim() || null,
    workspaceDir,
    stateDir,
    shellSession: `codex-mcp-${mcpSessionId}`,
    scenePath: agentScenePath(workspaceDir),
    actor: args.actor,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Best-effort: keep open local MCP workspaces’ scene `name` in sync after rename.
 * Updates both `db-courseware.scene.json` and the loaded CLI session's `scene.name`
 * (courseware_save persists the latter). Multi-instance Redis peers hydrate later.
 * A session that was in sync before the rename stays in sync, so its next save is not
 * mistaken for a conflict; a session already behind stays behind.
 */
export function syncOpenCodexMcpWorkspaceTitles(args: {
  coursewareId: string;
  coursewareKey: string;
  title: string;
  previousUpdatedAt?: string;
  updatedAt?: string;
}): number {
  const title = args.title.trim();
  if (!title) {
    return 0;
  }
  let updated = 0;
  for (const session of sessions.values()) {
    if (
      session.coursewareId !== args.coursewareId &&
      session.coursewareKey !== args.coursewareKey
    ) {
      continue;
    }
    let touched = false;
    if (existsSync(session.scenePath)) {
      try {
        const parsed = JSON.parse(readFileSync(session.scenePath, 'utf8')) as Record<
          string,
          unknown
        >;
        if (parsed && typeof parsed === 'object') {
          parsed.name = title;
          writeFileSync(session.scenePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
          touched = true;
        }
      } catch {
        // ignore corrupt scene; caller already persisted DB rename
      }
    }

    // Authoritative save path reads `.ainobi-cli/<session>.json` → session.scene
    const cliSessionPath = resolveCodexMcpCliSessionPathSync(session);
    if (cliSessionPath) {
      try {
        const parsed = JSON.parse(readFileSync(cliSessionPath, 'utf8')) as Record<
          string,
          unknown
        >;
        const scene =
          parsed?.scene && typeof parsed.scene === 'object'
            ? (parsed.scene as Record<string, unknown>)
            : null;
        if (scene) {
          scene.name = title;
          const syncedAt = typeof parsed.courseware_synced_at === 'string' ? Date.parse(parsed.courseware_synced_at) : Number.NaN;
          if (args.updatedAt && args.previousUpdatedAt && syncedAt >= Date.parse(args.previousUpdatedAt)) {
            parsed.courseware_synced_at = args.updatedAt;
          }
          writeFileSync(cliSessionPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
          invalidateAgentWorkspaceSessionCache(session.workspaceDir);
          touched = true;
        }
      } catch {
        // ignore corrupt CLI session
      }
    }

    if (touched) {
      updated += 1;
    }
  }
  return updated;
}

/** Resolve the loaded CLI session JSON for an MCP workspace (sync; best-effort). */
function resolveCodexMcpCliSessionPathSync(session: CodexMcpWorkspaceSession): string | null {
  try {
    const pointer = codexMcpShellBindingPath(session);
    if (existsSync(pointer)) {
      const sessionId = readFileSync(pointer, 'utf8').trim().replace(/[^A-Za-z0-9._-]/g, '_');
      if (sessionId) {
        const path = join(session.stateDir, `${sessionId}.json`);
        if (existsSync(path)) {
          return path;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Env for host-side `ainobi` in the Codex MCP workspace.
 * Access token comes from the **current** caller (must already be ownership-checked).
 * Uses the same allowlist as Claude agent sandboxes — never spreads full `process.env`.
 */
export function buildCodexMcpAinobiEnv(
  session: CodexMcpWorkspaceSession,
  accessToken: string,
  port = Number(process.env.PORT ?? 5633),
): NodeJS.ProcessEnv {
  const env = pickAgentSubprocessEnv(process.env, {
    PATH: buildCodexMcpPathEnv(),
    AINOBI_CLI_RUNTIME: 'agent',
    AINOBI_SHELL_SESSION: session.shellSession,
    AINOBI_STATE_DIR: session.stateDir,
    AINOBI_COURSEWARE_KEY: session.coursewareKey,
    AINOBI_COURSEWARE_ID: session.coursewareId,
    AINOBI_AGENT_API_KEY: accessToken,
    AINOBI_ASSET_HOST_FLUSH: '1',
    AINOBI_PERSISTENCE_HOST_FLUSH: '1',
    AINOBI_NARRATION_HOST_FLUSH: '1',
    AINOBI_SEARCH_HOST_FLUSH: '1',
    AINOBI_DOC_HOST_FLUSH: '1',
    AINOBI_IMAGE_GENERATE_HOST_FLUSH: '1',
    AINOBI_IMAGE_REPLICATE_HOST_FLUSH: '1',
    AINOBI_AI_TEACHERS_HOST_FLUSH: '1',
    AINOBI_TTS_HOST_FLUSH: '1',
    AINOBI_LIVE_PREVIEW_HOST_FLUSH: '1',
    AINOBI_COURSEWARE_PERSISTENCE_URL: `http://127.0.0.1:${port}/courseware`,
    AINOBI_COURSEWARE_ASSET_UPLOAD_URL: `http://127.0.0.1:${port}/courseware/assets/upload`,
    AINOBI_COURSEWARE_ASSET_GET_URL: `http://127.0.0.1:${port}/courseware/assets/get`,
    AINOBI_NARRATION_HOST_URL: `http://127.0.0.1:${port}/courseware/narration/run`,
    AINOBI_SEARCH_HOST_URL: `http://127.0.0.1:${port}/courseware/search/run`,
    AINOBI_DOC_HOST_URL: `http://127.0.0.1:${port}/courseware/doc/read`,
    AINOBI_KNOWLEDGE_HOST_URL: `http://127.0.0.1:${port}/courseware/knowledge/read`,
    AINOBI_IMAGE_REPLICATE_HOST_URL: `http://127.0.0.1:${port}/courseware/image/replicate-html`,
    AINOBI_IMAGE_GENERATE_HOST_URL: `http://127.0.0.1:${port}/courseware/image/generate`,
    AINOBI_AI_TEACHERS_HOST_URL: `http://127.0.0.1:${port}/courseware/ai-teachers/list`,
    AINOBI_TTS_HOST_URL: `http://127.0.0.1:${port}/courseware/tts/list`,
    AINOBI_TOOL_RESULT_RECALL_HOST_URL: `http://127.0.0.1:${port}/courseware/tool-result/recall`,
    // Platform resource URL allowlist: same source as the chat-http sandbox (env.AINOBI_COURSEWARE_ASSET_BASE_URLS)
    // — the host derives it from the full env (including OCI_S3_*) and hands it down as a non-secret env. The MCP subprocess previously
    // couldn't pick that key up from process.env, and the pod env doesn't carry it either → the allowlist degraded (no OCI native /
    // compat forms) → validate --publish falsely flagged every OCI native asset URL persisted in the scene as
    // External → publish validation failed, and the agent, assuming a storage failure, regenerated a whole batch of narration
    // (the 2026-09-07 case: 15 voice-over lines re-synthesized for 0.6 credits).
    AINOBI_COURSEWARE_ASSET_BASE_URLS: coursewareAssetUrlPrefixes().join(','),
    ...(session.coursewareOrgId
      ? { AINOBI_COURSEWARE_ORG_ID: session.coursewareOrgId }
      : { AINOBI_COURSEWARE_ORG_ID: undefined }),
  });
  return env;
}

/**
 * Workspace is ready only when scene JSON + shell binding + CLI session file exist.
 * File leftovers without a bound shell session force hydrate/`ainobi load`.
 */
export async function isCodexMcpWorkspaceReady(
  session: CodexMcpWorkspaceSession,
): Promise<boolean> {
  if (!existsSync(session.workspaceDir) || !existsSync(session.scenePath)) {
    return false;
  }
  if (!existsSync(codexMcpShellBindingPath(session))) {
    return false;
  }
  return hasAgentWorkspaceCliSession(session.workspaceDir);
}

/** @deprecated Use {@link isCodexMcpWorkspaceReady} */
export function hasLocalCodexMcpWorkspace(session: CodexMcpWorkspaceSession): boolean {
  return existsSync(session.workspaceDir) && existsSync(session.scenePath);
}

/** @internal Tests only */
export function resetCodexMcpSessionsForTests(): void {
  sessions.clear();
}

/** @internal Tests only — seed local cache without Redis. */
export function seedCodexMcpSessionLocalCacheForTests(session: CodexMcpWorkspaceSession): void {
  sessions.set(session.mcpSessionId, session);
}
