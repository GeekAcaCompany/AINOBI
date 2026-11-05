// SPDX-License-Identifier: AGPL-3.0-only
import { toRenderTaskResponse } from "../http/handlers/render-tasks.ts";
import type { RenderTaskEntity } from "../models/render-task-entity.ts";
import { redisClient } from "../db/db.ts";
import { ensureSharedRedisConnected } from "../db/redis-shared.ts";

function resolveInternalToken(): string | null {
  return process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN?.trim() || null;
}

const CALLBACK_ATTEMPTS = 3;
const CALLBACK_RETRY_BASE_MS = 300;
const CALLBACK_TIMEOUT_MS = 10_000;

/** Per-process dedupe: terminal-outcome webhooks are best-effort and must not spam every dispatch tick. */
const notifiedCallbackTaskIds = new Set<string>();

/** In-process fallback when Redis is unavailable. */
const progressCallbackState = new Map<string, { lastAt: number; lastProgress: number }>();

export const PROGRESS_CALLBACK_MIN_INTERVAL_MS = 15_000;
export const PROGRESS_CALLBACK_MIN_DELTA = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postCallbackOnce(url: string, body: string, token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ainobi-internal-token": token },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`callback responded ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Best-effort webhook fired when a task reaches `completed`/`failed`/`interrupted`. Never throws —
 * callers (dispatcher tick, reconciliation sweep) must not have their own control flow blocked or
 * broken by a flaky receiver. Delivery isn't guaranteed (process could die mid-retry), so this is
 * a latency optimization on top of, not a replacement for, the receiver's own lazy reconciliation
 * (e.g. billing the first time it observes `status=completed` while polling/listing tasks).
 *
 * While `status=running`, see {@link notifyRenderTaskProgressCallback} (throttled progress pushes).
 */
export async function notifyRenderTaskCallback(task: RenderTaskEntity): Promise<void> {
  const callbackUrl = task.request.callbackUrl?.trim();
  if (!callbackUrl) {
    return;
  }
  if (notifiedCallbackTaskIds.has(task.id)) {
    return;
  }
  const token = resolveInternalToken();
  if (!token) {
    console.warn(
      `[render-task-callback] task=${task.id} has a callbackUrl but AINOBI_VIDEO_RENDER_INTERNAL_TOKEN ` +
        "is not configured; skipping (receiver couldn't verify us anyway).",
    );
    return;
  }

  const body = JSON.stringify({ task: toRenderTaskResponse(task) });

  for (let attempt = 1; attempt <= CALLBACK_ATTEMPTS; attempt += 1) {
    try {
      await postCallbackOnce(callbackUrl, body, token);
      notifiedCallbackTaskIds.add(task.id);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= CALLBACK_ATTEMPTS) {
        console.warn(
          `[render-task-callback] task=${task.id} status=${task.status} callback=${callbackUrl} ` +
            `gave up after ${attempt} attempt(s): ${message}`,
        );
        // Still mark notified so a stuck unreachable callback doesn't retry every reconcile tick.
        notifiedCallbackTaskIds.add(task.id);
        return;
      }
      console.warn(
        `[render-task-callback] task=${task.id} callback=${callbackUrl} ` +
          `attempt ${attempt}/${CALLBACK_ATTEMPTS} failed, retrying: ${message}`,
      );
      await sleep(CALLBACK_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
}

function progressCallbackLockKey(taskId: string): string {
  return `render-task:progress-cb:lock:${taskId}`;
}

function progressCallbackLastKey(taskId: string): string {
  return `render-task:progress-cb:last:${taskId}`;
}

/**
 * Cross-instance claim via Redis (lock TTL = min interval; last progress for delta).
 * Returns `null` when Redis is unavailable so callers can fall back locally.
 */
export async function tryClaimProgressCallbackSlot(
  taskId: string,
  progress: number,
  options: {
    minIntervalMs?: number;
    minDelta?: number;
  } = {},
): Promise<boolean | null> {
  const minIntervalMs = options.minIntervalMs ?? PROGRESS_CALLBACK_MIN_INTERVAL_MS;
  const minDelta = options.minDelta ?? PROGRESS_CALLBACK_MIN_DELTA;
  const connected = await ensureSharedRedisConnected();
  if (!connected) {
    return null;
  }

  try {
    const lastRaw = await redisClient.get(progressCallbackLastKey(taskId));
    if (lastRaw != null) {
      const lastProgress = Number(lastRaw);
      if (Number.isFinite(lastProgress) && progress - lastProgress < minDelta) {
        return false;
      }
    }

    const lockTtlSec = Math.max(1, Math.ceil(minIntervalMs / 1000));
    const locked = await redisClient.set(
      progressCallbackLockKey(taskId),
      "1",
      "EX",
      lockTtlSec,
      "NX",
    );
    if (locked !== "OK") {
      return false;
    }

    await redisClient.set(
      progressCallbackLastKey(taskId),
      String(progress),
      "EX",
      60 * 60,
    );
    return true;
  } catch (error) {
    console.warn(
      `[render-task-callback] redis progress claim failed for task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function tryClaimProgressCallbackLocally(taskId: string, progress: number): boolean {
  const now = Date.now();
  const prev = progressCallbackState.get(taskId);
  if (prev) {
    if (now - prev.lastAt < PROGRESS_CALLBACK_MIN_INTERVAL_MS) {
      return false;
    }
    if (progress - prev.lastProgress < PROGRESS_CALLBACK_MIN_DELTA) {
      return false;
    }
  }
  progressCallbackState.set(taskId, { lastAt: now, lastProgress: progress });
  return true;
}

/**
 * Best-effort progress webhook while `status=running`.
 * Cross-instance throttled via Redis (falls back to in-process). Never throws.
 */
export async function notifyRenderTaskProgressCallback(task: RenderTaskEntity): Promise<void> {
  if (task.status !== "running") {
    return;
  }
  const callbackUrl = task.request.callbackUrl?.trim();
  if (!callbackUrl) {
    return;
  }
  if (notifiedCallbackTaskIds.has(task.id)) {
    return;
  }
  const progress = task.progress ?? 0;
  const redisClaim = await tryClaimProgressCallbackSlot(task.id, progress);
  if (redisClaim === false) {
    return;
  }
  if (redisClaim === null && !tryClaimProgressCallbackLocally(task.id, progress)) {
    return;
  }

  const token = resolveInternalToken();
  if (!token) {
    return;
  }

  try {
    await postCallbackOnce(callbackUrl, JSON.stringify({ task: toRenderTaskResponse(task) }), token);
  } catch (error) {
    console.warn(
      `[render-task-callback] task=${task.id} progress callback failed:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Test-only: reset per-process callback dedupe state. */
export function _resetRenderTaskCallbackDedupeForTests(): void {
  notifiedCallbackTaskIds.clear();
  progressCallbackState.clear();
}
