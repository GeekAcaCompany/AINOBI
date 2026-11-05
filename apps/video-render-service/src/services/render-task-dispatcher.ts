// SPDX-License-Identifier: AGPL-3.0-only
import { ensureDataSource } from "../db/ensure-data-source.ts";
import {
  formatFcTimeoutErrorMessage,
  resolveOrphanReconcileIntervalMs,
  resolveRenderBaseUrl,
  resolveRenderTaskFcTimeoutMs,
  resolveRenderTaskSoftTimeoutMs,
  resolveRenderTaskStaleHeartbeatMs,
} from "../config/video-render.ts";
import type { RenderTaskEntity } from "../models/render-task-entity.ts";
import {
  abortRenderTaskExecution,
  isRenderTaskAbortRegistered,
  registerRenderTaskAbortController,
  unregisterRenderTaskAbortController,
} from "./render-task-abort.ts";
import { notifyRenderTaskCallback } from "./render-task-callback.ts";
import {
  healDistributedRenderTasks,
  runDistributedOrSingleRender,
  runDistributedAssembleExecution,
  runDistributedChunkExecution,
} from "./distributed-orchestrator.ts";
import { stopDistributedRenderWorkers } from "./distributed-cancel.ts";
import {
  getRenderTaskById,
  isRenderTaskCancelled,
  listStaleRunningRenderTasks,
  markRenderTaskCancelled,
  markRenderTaskCompleted,
  markRenderTaskFailed,
  markRenderTaskInterrupted,
  markRenderTaskRunning,
  updateRenderTaskProgress,
} from "./render-task-store.ts";
import { markRenderTaskChunkFailed } from "./render-task-chunk-store.ts";
import type { RenderFrameProgress, VideoRenderResponse } from "./video-render.ts";
import { RenderCancelledError } from "@hyperframes/producer";
import { redactSensitiveRenderUrl } from "../startup-log.ts";

/** Refetches the row and fires the best-effort completion webhook; swallows all errors. */
async function notifyTaskOutcome(taskId: string): Promise<void> {
  try {
    const task = await getRenderTaskById(taskId);
    if (task) {
      await notifyRenderTaskCallback(task);
    }
  } catch (error) {
    console.warn(
      `[render-task] failed to notify callback for task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Task ids currently executing on *this* instance. */
const localRunningTaskIds = new Set<string>();

/** Poll DB while rendering so cancel works even if FC affinity routes cancel elsewhere. */
const CANCEL_DB_POLL_INTERVAL_MS = 3_000;

let orphanReconcileTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Classify an abort/error after `renderUrlToVideo` rejects.
 * Soft timeout must win over `abortSignal.aborted`, otherwise we'd mark `cancelled`.
 */
export function resolveRenderAbortTerminal(
  timedOut: boolean,
  cancelledOrAborted: boolean,
): "failed_timeout" | "cancelled" | "error" {
  if (timedOut) {
    return "failed_timeout";
  }
  if (cancelledOrAborted) {
    return "cancelled";
  }
  return "error";
}

/** Whether wall-clock runtime since `startedAt` already meets/exceeds the FC invoke budget. */
export function isRenderTaskPastFcTimeout(
  task: { startedAt: Date | null },
  fcTimeoutMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!task.startedAt) {
    return false;
  }
  return nowMs - task.startedAt.getTime() >= fcTimeoutMs;
}

/** Heartbeat (or startedAt fallback) older than the stale threshold. */
export function isRenderTaskHeartbeatStale(
  task: { heartbeatAt: Date | null; startedAt: Date | null },
  staleThresholdMs: number,
  nowMs: number = Date.now(),
): boolean {
  const anchor = task.heartbeatAt ?? task.startedAt;
  if (!anchor) {
    return false;
  }
  return nowMs - anchor.getTime() >= staleThresholdMs;
}

/**
 * If Postgres already shows `cancelled`, abort the in-flight render on this instance.
 * Returns `true` when an abort was signaled.
 */
export async function abortRenderTaskIfCancelledInDb(
  taskId: string,
  abortSignal?: AbortSignal,
  isCancelledCheck: (id: string) => Promise<boolean> = isRenderTaskCancelled,
): Promise<boolean> {
  if (abortSignal?.aborted) {
    return true;
  }
  try {
    if (!(await isCancelledCheck(taskId))) {
      return false;
    }
    const aborted = abortRenderTaskExecution(taskId);
    if (aborted) {
      console.info(`[render-task] task=${taskId} aborted after DB cancel (affinity-independent)`);
    }
    return aborted;
  } catch (error) {
    console.warn(
      `[render-task] failed to poll cancel status for task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

function startRenderTaskCancelWatchdog(taskId: string, abortSignal: AbortSignal): () => void {
  const timer = setInterval(() => {
    void abortRenderTaskIfCancelledInDb(taskId, abortSignal);
  }, CANCEL_DB_POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Only persist a progress update when it actually moved the needle — the
 * Hyperframes callback can fire many times per second, and every write is a
 * Postgres round trip. Always writes on stage changes (cheap, rare) so the UI
 * reflects stage transitions promptly even if progress didn't move much.
 */
function createProgressThrottle(taskId: string, abortSignal: AbortSignal) {
  let lastStage: string | null = null;
  let lastProgress = -1;
  let lastFramesRendered = -1;
  let lastTotalFrames = -1;
  let lastWriteAt = 0;
  const MIN_PROGRESS_DELTA = 2;
  const MIN_INTERVAL_MS = 2000;

  return async (
    stage: string,
    progress: number,
    frames?: RenderFrameProgress | null,
  ): Promise<void> => {
    const now = Date.now();
    const stageChanged = stage !== lastStage;
    const progressJumped = Math.abs(progress - lastProgress) >= MIN_PROGRESS_DELTA;
    const intervalElapsed = now - lastWriteAt >= MIN_INTERVAL_MS;
    const framesChanged =
      frames === null
        ? lastFramesRendered !== -1 || lastTotalFrames !== -1
        : frames != null &&
          (frames.rendered !== lastFramesRendered || frames.total !== lastTotalFrames);
    if (!stageChanged && !progressJumped && !intervalElapsed && !framesChanged) {
      return;
    }
    lastStage = stage;
    lastProgress = progress;
    lastWriteAt = now;
    if (frames === null) {
      lastFramesRendered = -1;
      lastTotalFrames = -1;
    } else if (frames != null) {
      lastFramesRendered = frames.rendered;
      lastTotalFrames = frames.total;
    }
    try {
      await updateRenderTaskProgress(taskId, {
        stage,
        progress,
        ...(frames === null
          ? { framesRendered: null, totalFrames: null }
          : frames != null
            ? { framesRendered: frames.rendered, totalFrames: frames.total }
            : {}),
      });
      void abortRenderTaskIfCancelledInDb(taskId, abortSignal);
    } catch (error) {
      console.warn(
        `[render-task] failed to persist progress for task=${taskId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  };
}

/**
 * Run a queued render to completion on *this* instance.
 *
 * Must be awaited from the create/retry HTTP handler — FC freezes the process
 * after the request ends, so a detached background job will not make progress.
 * Concurrent cancel can abort via AbortController on the same instance (HeaderField
 * affinity) or via periodic DB polling when cancel landed on a different instance.
 */
export async function runRenderTaskExecution(taskId: string): Promise<void> {
  if (localRunningTaskIds.has(taskId) || isRenderTaskAbortRegistered(taskId)) {
    return;
  }
  localRunningTaskIds.add(taskId);
  const abortSignal = registerRenderTaskAbortController(taskId);
  const stopCancelWatchdog = startRenderTaskCancelWatchdog(taskId, abortSignal);
  let shouldNotifyOutcome = false;
  let timedOut = false;

  // Abort before Aliyun FC hard-kills the invoke so we can still write failed + callback.
  const softTimeoutMs = resolveRenderTaskSoftTimeoutMs();
  const softTimer = setTimeout(() => {
    timedOut = true;
    console.warn(
      `[render-task] task=${taskId} soft timeout after ${softTimeoutMs}ms; aborting before FC kill`,
    );
    abortRenderTaskExecution(taskId);
  }, softTimeoutMs);
  softTimer.unref();

  try {
    await ensureDataSource();
    const task = await getRenderTaskById(taskId);
    if (!task) {
      console.warn(`[render-task] task=${taskId} not found; dropping.`);
      return;
    }

    const becameRunning = await markRenderTaskRunning(taskId);
    if (!becameRunning) {
      shouldNotifyOutcome = true;
      return;
    }

    const renderUrl = redactSensitiveRenderUrl(task.request.url);
    const callbackUrl = task.request.callbackUrl?.trim();
    console.info(
      `[render-task] task=${taskId} starting` +
        ` url=${renderUrl}` +
        (task.coursewareId ? ` coursewareId=${task.coursewareId}` : "") +
        (callbackUrl ? ` callback=${callbackUrl}` : ""),
    );

    const onProgress = createProgressThrottle(taskId, abortSignal);
    try {
      const outcome = await runDistributedOrSingleRender({
        taskId,
        request: task.request,
        onProgress: (stage, progress, frames) => {
          void onProgress(stage, progress, frames);
        },
        abortSignal,
        renderBaseUrl: resolveRenderBaseUrl(),
      });
      if (outcome.kind === "fanout") {
        // Parent stays `running` in chunking; assemble worker notifies on completion.
        console.info(
          `[render-task] task=${taskId} distributed fan-out ` +
            `chunks=${outcome.chunkCount} frames=${outcome.totalFrames}`,
        );
        shouldNotifyOutcome = false;
        return;
      }
      const result: VideoRenderResponse = outcome.result;
      const completed = await markRenderTaskCompleted(taskId, {
        localPath: result.localPath,
        outputPath: result.outputPath,
        render: result.render,
        oss: result.oss,
        cover: result.cover,
      });
      if (!completed) {
        const latest = await getRenderTaskById(taskId);
        if (latest?.status === "cancelled") {
          console.info(`[render-task] task=${taskId} finished render but was cancelled; dropping result`);
        }
      }
      shouldNotifyOutcome = true;
    } catch (error) {
      const terminal = resolveRenderAbortTerminal(
        timedOut,
        error instanceof RenderCancelledError || abortSignal.aborted,
      );
      if (terminal === "failed_timeout") {
        const message = formatFcTimeoutErrorMessage();
        console.error(`[render-task] task=${taskId} failed:`, message);
        const failed = await markRenderTaskFailed(taskId, message);
        if (!failed) {
          const latest = await getRenderTaskById(taskId);
          if (latest?.status === "cancelled") {
            console.info(`[render-task] task=${taskId} timeout after cancel; keeping cancelled`);
          }
        }
        shouldNotifyOutcome = true;
        return;
      }
      if (terminal === "cancelled") {
        const latest = await getRenderTaskById(taskId);
        if (latest?.status === "running") {
          await markRenderTaskCancelled(taskId);
        }
        shouldNotifyOutcome = true;
        console.info(`[render-task] task=${taskId} cancelled`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[render-task] task=${taskId} failed:`, message);
      const failed = await markRenderTaskFailed(taskId, message);
      if (!failed) {
        const latest = await getRenderTaskById(taskId);
        if (latest?.status === "cancelled") {
          console.info(`[render-task] task=${taskId} error after cancel; keeping cancelled`);
        }
      }
      shouldNotifyOutcome = true;
    }
  } finally {
    clearTimeout(softTimer);
    stopCancelWatchdog();
    unregisterRenderTaskAbortController(taskId);
    localRunningTaskIds.delete(taskId);
  }

  if (shouldNotifyOutcome) {
    await notifyTaskOutcome(taskId);
  }
}

/** Abort a running task on this instance (no-op if it isn't local). */
export async function stopRunningRenderTask(taskId: string): Promise<boolean> {
  return abortRenderTaskExecution(taskId);
}

/** Chunk worker entry (FC Async / local). Registers abort under `taskId:chunk:N`. */
export async function runRenderTaskChunkWorker(
  taskId: string,
  chunkIndex: number,
): Promise<void> {
  const abortKey = `${taskId}:chunk:${chunkIndex}`;
  if (localRunningTaskIds.has(abortKey) || isRenderTaskAbortRegistered(abortKey)) {
    return;
  }
  localRunningTaskIds.add(abortKey);
  const abortSignal = registerRenderTaskAbortController(abortKey);
  const stopCancelWatchdog = startRenderTaskCancelWatchdog(taskId, abortSignal);
  let shouldNotifyOutcome = false;
  let timedOut = false;

  const softTimeoutMs = resolveRenderTaskSoftTimeoutMs();
  const softTimer = setTimeout(() => {
    timedOut = true;
    console.warn(
      `[render-task] task=${taskId} chunk=${chunkIndex} soft timeout after ${softTimeoutMs}ms; aborting before FC kill`,
    );
    abortRenderTaskExecution(taskId);
  }, softTimeoutMs);
  softTimer.unref();

  try {
    await runDistributedChunkExecution({
      taskId,
      chunkIndex,
      abortSignal,
      renderBaseUrl: resolveRenderBaseUrl(),
    });
    // Safety net: orchestrator may return after swallow races; timedOut must still fail the task.
    if (timedOut) {
      const timeoutMessage = formatFcTimeoutErrorMessage();
      console.error(`[render-task] task=${taskId} chunk=${chunkIndex} failed:`, timeoutMessage);
      const failed = await markRenderTaskFailed(taskId, timeoutMessage);
      if (failed) {
        await markRenderTaskChunkFailed(taskId, chunkIndex, "cancelled:timeout").catch(() => false);
        await stopDistributedRenderWorkers(taskId, {
          reason: "cancelled:timeout",
          renderBaseUrl: resolveRenderBaseUrl(),
        });
        shouldNotifyOutcome = true;
      }
    } else {
      const task = await getRenderTaskById(taskId);
      if (task && (task.status === "failed" || task.status === "cancelled")) {
        shouldNotifyOutcome = true;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (timedOut || message === "cancelled:timeout") {
      const timeoutMessage = formatFcTimeoutErrorMessage();
      console.error(`[render-task] task=${taskId} chunk=${chunkIndex} failed:`, timeoutMessage);
      const failed = await markRenderTaskFailed(taskId, timeoutMessage);
      if (failed) {
        await stopDistributedRenderWorkers(taskId, {
          reason: "cancelled:timeout",
          renderBaseUrl: resolveRenderBaseUrl(),
        });
        shouldNotifyOutcome = true;
      } else {
        const task = await getRenderTaskById(taskId);
        if (task?.status === "failed") {
          shouldNotifyOutcome = true;
        }
      }
    } else if (message === "cancelled:user") {
      // User cancel — orchestrator already returned quietly in most paths.
    } else {
      const task = await getRenderTaskById(taskId);
      if (task?.status === "failed") {
        shouldNotifyOutcome = true;
      }
    }
  } finally {
    clearTimeout(softTimer);
    stopCancelWatchdog();
    unregisterRenderTaskAbortController(abortKey);
    localRunningTaskIds.delete(abortKey);
  }

  if (shouldNotifyOutcome) {
    await notifyTaskOutcome(taskId);
  }
}

/** Assemble worker entry (FC Async / local). */
export async function runRenderTaskAssembleWorker(taskId: string): Promise<void> {
  const abortKey = `${taskId}:assemble`;
  if (localRunningTaskIds.has(abortKey) || isRenderTaskAbortRegistered(abortKey)) {
    return;
  }
  localRunningTaskIds.add(abortKey);
  const abortSignal = registerRenderTaskAbortController(abortKey);
  const stopCancelWatchdog = startRenderTaskCancelWatchdog(taskId, abortSignal);
  let shouldNotifyOutcome = false;
  let timedOut = false;

  const softTimeoutMs = resolveRenderTaskSoftTimeoutMs();
  const softTimer = setTimeout(() => {
    timedOut = true;
    console.warn(
      `[render-task] task=${taskId} assemble soft timeout after ${softTimeoutMs}ms; aborting before FC kill`,
    );
    abortRenderTaskExecution(taskId);
  }, softTimeoutMs);
  softTimer.unref();

  try {
    await runDistributedAssembleExecution({ taskId, abortSignal });
    shouldNotifyOutcome = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (timedOut || message === "cancelled:timeout") {
      const timeoutMessage = formatFcTimeoutErrorMessage();
      console.error(`[render-task] task=${taskId} assemble failed:`, timeoutMessage);
      await markRenderTaskFailed(taskId, timeoutMessage);
      shouldNotifyOutcome = true;
    } else if (message === "cancelled:user" || message.startsWith("cancelled:")) {
      const latest = await getRenderTaskById(taskId);
      if (latest?.status === "running") {
        await markRenderTaskCancelled(taskId);
      }
      shouldNotifyOutcome = true;
    } else {
      console.error(`[render-task] task=${taskId} assemble failed:`, message);
      await markRenderTaskFailed(taskId, `distributed assemble failed: ${message}`);
      shouldNotifyOutcome = true;
    }
  } finally {
    clearTimeout(softTimer);
    stopCancelWatchdog();
    unregisterRenderTaskAbortController(abortKey);
    localRunningTaskIds.delete(abortKey);
  }

  if (shouldNotifyOutcome) {
    await notifyTaskOutcome(taskId);
  }
}

/**
 * Mark one orphaned `running` task terminal + notify callback.
 *
 * Past FC wall-clock budget → `failed` (timeout). Otherwise heartbeat-stale → `interrupted`.
 * Skips tasks still executing on this instance.
 * Distributed chunking/assembling parents are only failed on FC timeout — lost Async
 * invokes are healed by {@link healDistributedRenderTasks} instead of interrupt.
 */
export async function reconcileOrphanedRenderTask(
  task: RenderTaskEntity,
  nowMs: number = Date.now(),
): Promise<"failed" | "interrupted" | null> {
  if (localRunningTaskIds.has(task.id)) {
    return null;
  }

  const fcTimeoutMs = resolveRenderTaskFcTimeoutMs();
  const distributedActive =
    task.renderMode === "distributed" &&
    (task.distributedPhase === "planning" ||
      task.distributedPhase === "chunking" ||
      task.distributedPhase === "assembling");

  if (isRenderTaskPastFcTimeout(task, fcTimeoutMs, nowMs)) {
    const message = formatFcTimeoutErrorMessage(fcTimeoutMs);
    const failed = await markRenderTaskFailed(task.id, message);
    if (failed) {
      console.warn(
        `[render-task] task=${task.id} past FC timeout (started=${task.startedAt?.toISOString() ?? "never"}); marked failed.`,
      );
      if (distributedActive) {
        await stopDistributedRenderWorkers(task.id, {
          reason: "cancelled:timeout",
          renderBaseUrl: resolveRenderBaseUrl(),
        }).catch(() => undefined);
      }
      void notifyTaskOutcome(task.id);
      return "failed";
    }
    return null;
  }

  if (distributedActive) {
    // Heartbeat may go quiet between chunk completes / before assemble starts — heal, don't interrupt.
    return null;
  }

  const interrupted = await markRenderTaskInterrupted(task.id, "stale_heartbeat");
  if (interrupted) {
    console.warn(
      `[render-task] task=${task.id} heartbeat stale (last=${task.heartbeatAt?.toISOString() ?? "never"}); marked interrupted.`,
    );
    void notifyTaskOutcome(task.id);
    return "interrupted";
  }
  return null;
}

/**
 * Sweep `running` tasks whose heartbeat went stale (and/or past FC timeout via list filter).
 *
 * Do **not** sweep all `running` rows — with FC session affinity each task gets its own
 * instance; a cold start for task B must not interrupt task A still rendering elsewhere.
 */
export async function recoverOrphanedRenderTasksOnStartup(): Promise<void> {
  await ensureDataSource();

  try {
    const healed = await healDistributedRenderTasks();
    if (healed.rescheduledChunks > 0 || healed.rescheduledAssemble > 0) {
      console.info(
        `[render-task] distributed heal rescheduled chunks=${healed.rescheduledChunks} assemble=${healed.rescheduledAssemble}`,
      );
    }
  } catch (error) {
    console.warn(
      "[render-task] distributed heal failed:",
      error instanceof Error ? error.message : error,
    );
  }

  const staleThresholdMs = resolveRenderTaskStaleHeartbeatMs();
  const fcTimeoutMs = resolveRenderTaskFcTimeoutMs();
  const staleTasks = await listStaleRunningRenderTasks(staleThresholdMs, fcTimeoutMs);
  const nowMs = Date.now();
  for (const task of staleTasks) {
    await reconcileOrphanedRenderTask(task, nowMs);
  }
}

/**
 * If a `running` task is heartbeat-stale or past FC timeout, reconcile then re-fetch.
 * Used by GET so callers see a terminal status without waiting for a periodic sweep.
 */
export async function reconcileRunningRenderTaskIfOrphaned(
  task: RenderTaskEntity,
  nowMs: number = Date.now(),
): Promise<RenderTaskEntity> {
  if (task.status !== "running" || localRunningTaskIds.has(task.id)) {
    return task;
  }

  const staleThresholdMs = resolveRenderTaskStaleHeartbeatMs();
  const fcTimeoutMs = resolveRenderTaskFcTimeoutMs();
  const needsReconcile =
    isRenderTaskHeartbeatStale(task, staleThresholdMs, nowMs) ||
    isRenderTaskPastFcTimeout(task, fcTimeoutMs, nowMs);
  if (!needsReconcile) {
    return task;
  }

  await reconcileOrphanedRenderTask(task, nowMs);
  return (await getRenderTaskById(task.id)) ?? task;
}

/** Periodic orphan sweep for long-lived query (or `all`) instances. */
export function startOrphanReconcileLoop(
  intervalMs: number = resolveOrphanReconcileIntervalMs(),
): () => void {
  if (orphanReconcileTimer) {
    clearInterval(orphanReconcileTimer);
    orphanReconcileTimer = null;
  }
  orphanReconcileTimer = setInterval(() => {
    void recoverOrphanedRenderTasksOnStartup().catch((error) => {
      console.warn(
        "[render-task] orphan reconcile tick failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }, intervalMs);
  orphanReconcileTimer.unref();
  return () => {
    if (orphanReconcileTimer) {
      clearInterval(orphanReconcileTimer);
      orphanReconcileTimer = null;
    }
  };
}

/** Number of tasks currently executing on this instance (test/observability hook). */
export function localRunningRenderTaskCount(): number {
  return localRunningTaskIds.size;
}
