// SPDX-License-Identifier: AGPL-3.0-only
import { redisClient } from '../db/db.ts';
import {
  confirmOrganizationStorage,
  decrementOrganizationStorage,
  isOrgStorageIntegrationEnabled,
  lockOrganizationStorage,
  releaseOrganizationStorageLock,
} from './ainobi-org-storage.ts';

/** Minimal task shape needed to account for exported OSS objects. */
export type StoragedRenderTask = {
  id: string;
  status: string;
  orgId?: string | null;
  result?: {
    oss?: { sizeBytes?: number } | null;
    cover?: { sizeBytes?: number } | null;
  } | null;
};

export type VideoRenderStorageOutcome =
  | { kind: 'committed'; sizeBytes: number }
  | { kind: 'released'; sizeBytes: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string };

const renderTaskStorageCommittedKey = (taskId: string): string =>
  `ainobi:render-task-storage:committed:${taskId.trim()}`;

/** Keep committed markers around for as long as a completed export might still be deleted. */
const COMMITTED_STORAGE_TTL_SECONDS = 90 * 24 * 60 * 60;

function isRedisAvailable(): boolean {
  return Boolean(process.env.REDIS_HOST?.trim());
}

/** Sum of video + cover bytes recorded on the render-service task result. */
export function resolveRenderTaskStorageBytes(task: StoragedRenderTask): number {
  const video = Number(task.result?.oss?.sizeBytes ?? 0);
  const cover = Number(task.result?.cover?.sizeBytes ?? 0);
  const total = (Number.isFinite(video) && video > 0 ? video : 0) + (Number.isFinite(cover) && cover > 0 ? cover : 0);
  return total;
}

async function markRenderTaskStorageCommitted(taskId: string, sizeBytes: number): Promise<void> {
  if (!isRedisAvailable() || sizeBytes <= 0) {
    return;
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    await redisClient.set(
      renderTaskStorageCommittedKey(taskId),
      String(Math.floor(sizeBytes)),
      'EX',
      COMMITTED_STORAGE_TTL_SECONDS,
    );
  } catch (error) {
    console.warn(
      `[org-storage] failed to mark render storage committed task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function takeRenderTaskStorageCommitted(taskId: string): Promise<number | null> {
  if (!isRedisAvailable()) {
    return null;
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    const raw = (await redisClient.eval(
      `local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`,
      1,
      renderTaskStorageCommittedKey(taskId),
    )) as string | null;
    if (!raw) {
      return null;
    }
    const sizeBytes = Number(raw);
    return Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.floor(sizeBytes) : null;
  } catch (error) {
    console.warn(
      `[org-storage] failed to take render storage committed marker task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * After a render completes and lands on OSS: lock + confirm org storage for the
 * actual video (+ cover) byte size. Never throws.
 *
 * Idempotency: callers should only invoke this once per task (via the shared
 * pending-settlement take). A Redis committed marker is written so delete can
 * release only what was actually charged.
 */
export async function commitRenderTaskOrganizationStorage(args: {
  task: StoragedRenderTask;
  accessToken: string;
  orgId: string | null | undefined;
}): Promise<VideoRenderStorageOutcome> {
  const { task, accessToken, orgId } = args;
  if (task.status !== 'completed') {
    return { kind: 'skipped', reason: 'task is not completed' };
  }
  if (!isOrgStorageIntegrationEnabled(orgId) || !accessToken.trim()) {
    return { kind: 'skipped', reason: 'org storage disabled or missing credentials' };
  }

  const sizeBytes = resolveRenderTaskStorageBytes(task);
  if (sizeBytes <= 0) {
    console.warn(
      `[org-storage] render task=${task.id} completed with no usable OSS sizeBytes; skipping storage commit`,
    );
    return { kind: 'skipped', reason: 'missing oss sizeBytes' };
  }

  const effectiveOrgId = orgId!.trim();
  let lockId: string | null = null;
  try {
    const lock = await lockOrganizationStorage(
      accessToken,
      effectiveOrgId,
      sizeBytes,
      `video-render:${task.id}`,
    );
    lockId = lock.lockId;
    const result = await confirmOrganizationStorage(
      accessToken,
      effectiveOrgId,
      lock.lockId,
      sizeBytes,
    );
    await markRenderTaskStorageCommitted(task.id, result.committedBytes || sizeBytes);
    console.info(
      `[org-storage] render storage committed task=${task.id} orgId=${result.orgId} ` +
        `sizeBytes=${result.committedBytes || sizeBytes} used=${result.storage.usedBytes} ` +
        `available=${result.storage.availableBytes}`,
    );
    return { kind: 'committed', sizeBytes: result.committedBytes || sizeBytes };
  } catch (error) {
    if (lockId) {
      try {
        await releaseOrganizationStorageLock(accessToken, effectiveOrgId, lockId);
      } catch {
        /* lock TTL will clear it */
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[org-storage] render storage commit failed task=${task.id} orgId=${effectiveOrgId} ` +
        `sizeBytes=${sizeBytes}: ${message}`,
    );
    return { kind: 'failed', error: message };
  }
}

/**
 * On delete: release previously committed org storage for this export.
 * Only decrements when a Redis committed marker exists (written after a successful
 * lock+confirm), so soft-failed commits (e.g. quota exceeded) never over-release.
 */
export async function releaseRenderTaskOrganizationStorage(args: {
  task: StoragedRenderTask;
  accessToken: string;
  orgId: string | null | undefined;
}): Promise<VideoRenderStorageOutcome> {
  const { task, accessToken, orgId } = args;
  if (!isOrgStorageIntegrationEnabled(orgId) || !accessToken.trim()) {
    return { kind: 'skipped', reason: 'org storage disabled or missing credentials' };
  }

  const markedBytes = await takeRenderTaskStorageCommitted(task.id);
  if (markedBytes == null || markedBytes <= 0) {
    return { kind: 'skipped', reason: 'no committed storage marker' };
  }

  const effectiveOrgId = orgId!.trim();
  try {
    const result = await decrementOrganizationStorage(accessToken, effectiveOrgId, markedBytes);
    console.info(
      `[org-storage] render storage released task=${task.id} orgId=${result.orgId} ` +
        `sizeBytes=${result.decrementedBytes} used=${result.storage.usedBytes} ` +
        `available=${result.storage.availableBytes}`,
    );
    return { kind: 'released', sizeBytes: result.decrementedBytes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[org-storage] render storage release failed task=${task.id} orgId=${effectiveOrgId} ` +
        `sizeBytes=${markedBytes}: ${message}`,
    );
    // Re-arm marker so a later retry can still release.
    await markRenderTaskStorageCommitted(task.id, markedBytes);
    return { kind: 'failed', error: message };
  }
}
