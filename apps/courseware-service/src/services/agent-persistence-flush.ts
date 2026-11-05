// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from 'node:path';

import { coursewareOrgIdFromEnv } from '@ainobi/courseware-cli/cli/courseware-persistence-org.ts';
import type { CoursewareActorContext } from '../auth/ainobi-org-access.ts';
import { patchAgentWorkspaceSessionSyncedAt } from './agent-courseware-scene-sync.ts';
import { getCoursewareEntityById, saveCourseware } from './courseware-service.ts';
import {
  invalidateAgentWorkspaceSessionCache,
  readAgentWorkspaceSession,
} from './agent-live-preview-flush.ts';

async function resolveAgentPersistenceOrgId(
  coursewareKey: string,
  coursewareOrgId?: string | null,
): Promise<string | undefined> {
  const explicit = coursewareOrgId?.trim() || coursewareOrgIdFromEnv();
  if (explicit) {
    return explicit;
  }
  const existing = await getCoursewareEntityById(coursewareKey);
  return existing?.orgId?.trim() || undefined;
}

/** True when the on-disk scene has no persistable slide content (bootstrap blank). */
export function isAgentSessionSceneEffectivelyEmpty(scene: unknown): boolean {
  if (!scene || typeof scene !== 'object') {
    return true;
  }
  const rec = scene as Record<string, unknown>;
  const slides = rec.slide_elements;
  if (!Array.isArray(slides) || slides.length === 0) {
    return true;
  }
  for (const slide of slides) {
    if (!slide || typeof slide !== 'object') continue;
    const s = slide as Record<string, unknown>;
    if (Array.isArray(s.children_elements) && s.children_elements.length > 0) {
      return false;
    }
    if (typeof s.background_image_url === 'string' && s.background_image_url.trim()) {
      return false;
    }
    if (Array.isArray(s.flow_pause_points) && s.flow_pause_points.length > 0) {
      return false;
    }
  }
  if (Array.isArray(rec.vtuber_elements) && rec.vtuber_elements.length > 0) {
    return false;
  }
  if (Array.isArray(rec.audio_elements) && rec.audio_elements.length > 0) {
    return false;
  }
  const quiz = rec.quiz;
  if (quiz && typeof quiz === 'object') {
    const questions = (quiz as Record<string, unknown>).questions;
    if (Array.isArray(questions) && questions.length > 0) {
      return false;
    }
  }
  return true;
}

export const DEFAULT_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT = 2;

export function livePreviewPersistenceMaxConcurrent(): number {
  const raw = process.env.AINOBI_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT?.trim();
  if (!raw) {
    return DEFAULT_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT;
}

function persistQueueKey(workspaceDir: string, coursewareKey: string): string {
  return `${resolve(workspaceDir)}:${coursewareKey.trim()}`;
}

type PersistQueueEntry = {
  pending: boolean;
  actor?: CoursewareActorContext;
  coursewareOrgId?: string | null;
  inFlight: Promise<AgentPersistenceFlushResult | null>;
};

const persistQueues = new Map<string, PersistQueueEntry>();

let persistSlotsInUse = 0;
const persistSlotWaiters: Array<() => void> = [];

async function acquirePersistSlot(): Promise<void> {
  const max = livePreviewPersistenceMaxConcurrent();
  if (persistSlotsInUse < max) {
    persistSlotsInUse += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    persistSlotWaiters.push(resolve);
  });
  persistSlotsInUse += 1;
}

function releasePersistSlot(): void {
  persistSlotsInUse = Math.max(0, persistSlotsInUse - 1);
  const next = persistSlotWaiters.shift();
  if (next) {
    next();
  }
}

/** @internal Tests only — reset in-memory queue and semaphore state. */
export function resetAgentPersistenceQueuesForTests(): void {
  persistQueues.clear();
  persistSlotsInUse = 0;
  persistSlotWaiters.length = 0;
}

export type AgentPersistenceFlushResult = {
  key: string;
  title: string | null;
  updatedAt: string;
  versionCount: number;
};

/**
 * Agent-runtime `ainobi save` (no path, no --stdout) — host persists after PostToolUse.
 * Matches even when the Bash command has env prefixes / redirections / `&&` chains
 * (common in home-entry agent turns).
 */
export function shouldFlushPersistenceAfterAinobiBash(command: string): boolean {
  // Strip redirections first so `ainobi save 2>&1` is treated like `ainobi save`.
  const normalized = command
    .replace(/\d?>&\d+/g, ' ')
    .replace(/(?:\d)?>>?\s*\S+/g, ' ');

  const re = /\bainobi\s+save\b([^;\n|&]*)/gi;
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = re.exec(normalized)) !== null) {
    const rest = match[1] ?? '';
    // `--stdout` is not a word-boundary-friendly token (`\b--` fails); match literally.
    if (/(?:^|\s)--stdout(?:\s|$|=)/.test(rest)) continue;
    const positional = rest
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !token.startsWith('-'));
    if (positional.length > 0) continue;
    found = true;
  }
  return found;
}

export type FlushAgentPersistenceOptions = {
  /**
   * When true, skip writing blank/bootstrap scenes so plan-mode or empty workspaces
   * cannot wipe a previously generated courseware in DB.
   */
  skipIfEmpty?: boolean;
};

/**
 * Save the on-disk CLI session scene to the database (runs on the host, not in the agent sandbox).
 */
type PersistWriter = (
  workspaceDir: string,
  coursewareKey: string,
  actor?: CoursewareActorContext,
  coursewareOrgId?: string | null,
  options?: FlushAgentPersistenceOptions,
) => Promise<AgentPersistenceFlushResult | null>;

let persistWriter: PersistWriter = writeAgentWorkspacePersistence;

/** @internal Tests only */
export function __setPersistWriterForTests(writer: PersistWriter | null): void {
  persistWriter = writer ?? writeAgentWorkspacePersistence;
}

export async function flushAgentWorkspacePersistence(
  workspaceDir: string,
  coursewareKey: string,
  actor?: CoursewareActorContext,
  coursewareOrgId?: string | null,
  options?: FlushAgentPersistenceOptions,
): Promise<AgentPersistenceFlushResult | null> {
  return persistWriter(workspaceDir, coursewareKey, actor, coursewareOrgId, options);
}

async function writeAgentWorkspacePersistence(
  workspaceDir: string,
  coursewareKey: string,
  actor?: CoursewareActorContext,
  coursewareOrgId?: string | null,
  options?: FlushAgentPersistenceOptions,
): Promise<AgentPersistenceFlushResult | null> {
  const key = coursewareKey.trim();
  if (!key) {
    return null;
  }

  // CLI just rewrote the session file; drop any stale mtime cache before reading.
  invalidateAgentWorkspaceSessionCache(workspaceDir);
  const session = await readAgentWorkspaceSession(workspaceDir);
  if (!session?.scene || typeof session.scene !== 'object') {
    return null;
  }

  const scene = session.scene as Record<string, unknown>;
  if (options?.skipIfEmpty && isAgentSessionSceneEffectivelyEmpty(scene)) {
    return null;
  }

  const title = typeof scene.name === 'string' ? scene.name : null;

  const orgId = await resolveAgentPersistenceOrgId(key, coursewareOrgId);
  // Host flush is create-or-update by design: the CLI just rewrote the workspace scene and
  // is authoritative for this turn, and there is no client-supplied base updated_at to check.
  // Access was already enforced when the chat turn wired AINOBI_COURSEWARE_KEY.
  const dto = await saveCourseware({
    mode: 'upsert',
    key,
    content: scene,
    title,
    actor,
    ...(orgId ? { orgId } : {}),
  });

  await patchAgentWorkspaceSessionSyncedAt(workspaceDir, dto.updatedAt);

  return {
    key: dto.key,
    title: dto.title,
    updatedAt: dto.updatedAt,
    versionCount: dto.versions.length,
  };
}

async function runCoalescedLivePreviewPersist(
  workspaceDir: string,
  coursewareKey: string,
  mapKey: string,
): Promise<AgentPersistenceFlushResult | null> {
  let lastResult: AgentPersistenceFlushResult | null = null;

  try {
    do {
      const entry = persistQueues.get(mapKey);
      if (!entry) {
        break;
      }
      entry.pending = false;
      const actor = entry.actor;
      const coursewareOrgId = entry.coursewareOrgId;

      await acquirePersistSlot();
      try {
        lastResult = await persistWriter(workspaceDir, coursewareKey, actor, coursewareOrgId);
      } catch (error) {
        console.warn(
          '[persistence] live-preview persist failed:',
          error instanceof Error ? error.message : error,
        );
        lastResult = null;
      } finally {
        releasePersistSlot();
      }
    } while (persistQueues.get(mapKey)?.pending);
  } finally {
    persistQueues.delete(mapKey);
  }

  return lastResult;
}

/**
 * Queue a DB persist after a live-preview patch. Rapid patches for the same courseware
 * coalesce into one in-flight write plus at most one follow-up (latest scene on disk).
 * A global semaphore caps concurrent writes across all courseware keys.
 */
/** @internal Tests only — wait until the coalesced live-preview queue finishes. */
export async function awaitAgentWorkspacePersistenceQueue(
  workspaceDir: string,
  coursewareKey: string,
): Promise<void> {
  const mapKey = persistQueueKey(workspaceDir, coursewareKey.trim());
  const entry = persistQueues.get(mapKey);
  if (entry?.inFlight) {
    await entry.inFlight.catch(() => null);
  }
}

export function scheduleAgentWorkspacePersistenceOnLivePreview(
  workspaceDir: string,
  coursewareKey: string,
  actor?: CoursewareActorContext,
  coursewareOrgId?: string | null,
): void {
  const key = coursewareKey.trim();
  if (!key) {
    return;
  }

  const mapKey = persistQueueKey(workspaceDir, key);
  const existing = persistQueues.get(mapKey);
  if (existing) {
    existing.actor = actor;
    existing.coursewareOrgId = coursewareOrgId;
    existing.pending = true;
    return;
  }

  const entry: PersistQueueEntry = {
    pending: false,
    actor,
    coursewareOrgId,
    inFlight: Promise.resolve(null),
  };
  persistQueues.set(mapKey, entry);
  entry.inFlight = runCoalescedLivePreviewPersist(workspaceDir, key, mapKey).then((saved) => {
    if (saved) {
      console.info('[persistence] live-preview patch saved', {
        workspace: workspaceDir,
        coursewareKey: saved.key,
        versionCount: saved.versionCount,
      });
    }
    return saved;
  });
}

/**
 * Wait for any queued live-preview persists, then write the latest on-disk scene (e.g. `ainobi save`).
 */
export async function flushAgentWorkspacePersistenceWhenIdle(
  workspaceDir: string,
  coursewareKey: string,
  actor?: CoursewareActorContext,
  coursewareOrgId?: string | null,
  options?: FlushAgentPersistenceOptions,
): Promise<AgentPersistenceFlushResult | null> {
  const key = coursewareKey.trim();
  if (!key) {
    return null;
  }

  const mapKey = persistQueueKey(workspaceDir, key);
  const queued = persistQueues.get(mapKey);
  if (queued?.inFlight) {
    await queued.inFlight.catch(() => null);
  }

  await acquirePersistSlot();
  try {
    return await persistWriter(workspaceDir, key, actor, coursewareOrgId, options);
  } finally {
    releasePersistSlot();
  }
}

/**
 * End-of-turn safety net for chats without live preview (home AI courseware).
 * Persists non-empty on-disk scenes even if the agent forgot / host-flush missed `ainobi save`.
 * Skips blank scenes so plan-mode workspaces cannot wipe generated content.
 */
export async function flushNonEmptyPersistenceAfterAgentTurn(args: {
  workspaceDir: string;
  coursewareKey?: string | null;
  coursewareOrgId?: string | null;
  coursewareActor?: CoursewareActorContext;
}): Promise<AgentPersistenceFlushResult | null> {
  const coursewareKey = args.coursewareKey?.trim();
  if (!coursewareKey) {
    return null;
  }
  try {
    const saved = await flushAgentWorkspacePersistenceWhenIdle(
      args.workspaceDir,
      coursewareKey,
      args.coursewareActor,
      args.coursewareOrgId,
      { skipIfEmpty: true },
    );
    if (saved) {
      console.info('[persistence] end-of-turn host flush saved', {
        workspace: args.workspaceDir,
        coursewareKey: saved.key,
        versionCount: saved.versionCount,
      });
    }
    return saved;
  } catch (error) {
    console.warn(
      '[persistence] end-of-turn host flush failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
