// SPDX-License-Identifier: AGPL-3.0-only
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { RenderTaskEntity } from "../models/render-task-entity.ts";
import {
  formatFcTimeoutErrorMessage,
  isVideoRenderOssUploadEnabled,
  resolveDistributedMinFrames,
  resolveDistributedRenderEnabled,
  resolveOutputDir,
  resolveRenderBaseUrl,
  resolveRenderTaskStaleHeartbeatMs,
  resolveVideoRenderOssBucket,
} from "../config/video-render.ts";
import {
  assembleDistributed,
  cleanupDistributedWorkRoot,
  planDistributedForRequest,
  renderDistributedChunk,
} from "./distributed-render.ts";
import {
  buildDistributedChunkObjectKey,
  buildDistributedPlanOssPrefix,
  buildVideoRenderCoverObjectKey,
  buildVideoRenderObjectKey,
  deleteOssPrefix,
  downloadDirectoryFromOss,
  downloadOssObjectToFile,
  uploadDirectoryToOss,
  uploadFileToOss,
  uploadImageToOss,
} from "./oss-upload.ts";
import {
  areAllChunksCompleted,
  createRenderTaskChunks,
  deleteRenderTaskChunks,
  getRenderTaskChunk,
  listQueuedRenderTaskChunks,
  listRenderTaskChunks,
  listRunningRenderTaskChunks,
  markRenderTaskChunkCompleted,
  markRenderTaskChunkFailed,
  markRenderTaskChunkRunning,
  requeueStaleRunningRenderTaskChunks,
  sumCompletedChunkDurationsMs,
  sumCompletedChunkFrames,
  touchRenderTaskChunkHeartbeat,
} from "./render-task-chunk-store.ts";
import {
  getRenderTaskById,
  isRenderTaskCancelled,
  listRunningDistributedRenderTasks,
  markRenderTaskCompleted,
  markRenderTaskFailed,
  updateRenderTaskDistributedMeta,
  updateRenderTaskProgress,
} from "./render-task-store.ts";
import {
  scheduleRenderTaskAssemble,
  scheduleRenderTaskChunkRun,
  RenderScheduleError,
} from "./render-task-schedule.ts";
import { stopDistributedRenderWorkers } from "./distributed-cancel.ts";
import { resolveRenderJobDispatchEnabled } from "./k8s-jobs.ts";
import {
  estimateDistributedChunkingProgress,
  framesToChunkingProgress,
  planningUploadProgress,
  resolveDistributedProgressCallbackLeader,
} from "./distributed-progress.ts";
import { extractVideoCoverJpeg } from "./video-cover.ts";
import type { VideoRenderRequest, VideoRenderResponse } from "./video-render.ts";
import { renderUrlToVideo } from "./video-render.ts";

export type DistributedRunOutcome =
  | { kind: "completed"; result: VideoRenderResponse }
  | { kind: "fanout"; chunkCount: number; totalFrames: number };

function resolveUploadToOss(requested?: boolean): boolean {
  if (requested !== undefined) {
    return requested;
  }
  return isVideoRenderOssUploadEnabled();
}

/**
 * Recompute parent task progress from all chunk rows (completed + time-based running estimates).
 * Monotonic vs the current row so parallel workers don't regress the UI.
 *
 * Progress webhooks are only emitted by the lowest-index running chunk (or unrestricted
 * when `forceProgressCallback` is set — e.g. chunk completion / planning).
 */
export async function persistDistributedChunkingProgress(
  taskId: string,
  options: {
    chunkIndex?: number;
    forceProgressCallback?: boolean;
  } = {},
): Promise<void> {
  const task = await getRenderTaskById(taskId);
  if (!task || task.status !== "running") {
    return;
  }
  if (task.distributedPhase !== "chunking" && task.distributedPhase !== "planning") {
    return;
  }
  const chunks = await listRenderTaskChunks(taskId);
  if (chunks.length === 0) {
    return;
  }
  const totalFrames =
    task.totalFrames ??
    chunks.reduce((sum, c) => sum + Math.max(0, c.endFrame - c.startFrame + 1), 0);
  const estimated = estimateDistributedChunkingProgress({ totalFrames, chunks });
  const progress = Math.max(task.progress ?? 0, estimated.progress);
  const framesRendered = Math.max(task.framesRendered ?? 0, estimated.framesRendered);
  if (progress === (task.progress ?? 0) && framesRendered === (task.framesRendered ?? 0)) {
    // Still refresh heartbeat so reconcile doesn't treat the parent as orphaned.
    await updateRenderTaskProgress(taskId, { stage: "chunking" });
    return;
  }
  await updateRenderTaskProgress(taskId, {
    stage: "chunking",
    progress,
    framesRendered,
    totalFrames,
  });

  const shouldNotify = await shouldEmitDistributedProgressCallback(taskId, options);
  if (!shouldNotify) {
    return;
  }
  // Dynamic import avoids orchestrator ↔ handlers ↔ dispatcher cycles via callback.
  void import("./render-task-callback.ts")
    .then(async ({ notifyRenderTaskProgressCallback }) => {
      const latest = await getRenderTaskById(taskId);
      if (latest) {
        await notifyRenderTaskProgressCallback(latest);
      }
    })
    .catch(() => undefined);
}

async function shouldEmitDistributedProgressCallback(
  taskId: string,
  options: { chunkIndex?: number; forceProgressCallback?: boolean },
): Promise<boolean> {
  if (options.forceProgressCallback) {
    return true;
  }
  if (options.chunkIndex === undefined) {
    return true;
  }
  const running = await listRunningRenderTaskChunks(taskId);
  const leader = resolveDistributedProgressCallbackLeader(running.map((c) => c.chunkIndex));
  // Nobody running yet (or only this worker just started): allow.
  if (leader === null) {
    return true;
  }
  return options.chunkIndex === leader;
}

async function bumpPlanningProgress(taskId: string, progress: number): Promise<void> {
  const task = await getRenderTaskById(taskId);
  if (!task || task.status !== "running") {
    return;
  }
  if (task.distributedPhase !== "planning" && task.stage !== "planning") {
    return;
  }
  const next = Math.max(task.progress ?? 0, progress);
  if (next === (task.progress ?? 0)) {
    await updateRenderTaskProgress(taskId, { stage: "planning" });
    return;
  }
  await updateRenderTaskProgress(taskId, { stage: "planning", progress: next });
  void import("./render-task-callback.ts")
    .then(async ({ notifyRenderTaskProgressCallback }) => {
      const latest = await getRenderTaskById(taskId);
      if (latest) {
        await notifyRenderTaskProgressCallback(latest);
      }
    })
    .catch(() => undefined);
}

/** Whether plan() output should fan out across FC chunk workers. */
export function shouldFanOutDistributedRender(
  totalFrames: number,
  chunkCount: number,
  options: {
    enabled?: boolean;
    minFrames?: number;
  } = {},
): boolean {
  const enabled = options.enabled ?? resolveDistributedRenderEnabled();
  if (!enabled) {
    return false;
  }
  if (chunkCount <= 1) {
    return false;
  }
  const minFrames = options.minFrames ?? resolveDistributedMinFrames();
  return totalFrames >= minFrames;
}

function shouldUseDistributed(totalFrames: number, chunkCount: number): boolean {
  return shouldFanOutDistributedRender(totalFrames, chunkCount);
}

/**
 * Plan-phase entry for `/run`: either complete a short single-instance render,
 * or fan out chunk workers and return while the parent task stays `running`.
 */
export async function runDistributedOrSingleRender(options: {
  taskId: string;
  request: VideoRenderRequest;
  onProgress?: (stage: string, progress: number, frames?: { rendered: number; total: number } | null) => void;
  abortSignal?: AbortSignal;
  renderBaseUrl: string;
}): Promise<DistributedRunOutcome> {
  const { taskId, request, onProgress, abortSignal, renderBaseUrl } = options;

  if (!resolveDistributedRenderEnabled()) {
    const result = await renderUrlToVideo(request, onProgress, abortSignal);
    return { kind: "completed", result };
  }

  await updateRenderTaskDistributedMeta(taskId, {
    distributedPhase: "planning",
    stage: "planning",
    progress: 2,
  });
  onProgress?.("planning", 2, null);

  const planStartedAt = Date.now();
  const planningHeartbeat = setInterval(() => {
    // Crawl 2→4 while Hyperframes plan() runs (can take minutes on long comps).
    const elapsedMin = (Date.now() - planStartedAt) / 60_000;
    const crawled = Math.min(4, 2 + Math.floor(elapsedMin));
    void bumpPlanningProgress(taskId, crawled);
  }, 10_000);
  planningHeartbeat.unref();

  let artifacts: Awaited<ReturnType<typeof planDistributedForRequest>>;
  try {
    artifacts = await planDistributedForRequest(request, abortSignal);
  } finally {
    clearInterval(planningHeartbeat);
  }
  const { planResult, planDir, projectDir, chunks, workRoot } = artifacts;
  await bumpPlanningProgress(taskId, 4);
  onProgress?.("planning", 4, null);

  try {
    if (abortSignal?.aborted || (await isRenderTaskCancelled(taskId))) {
      throw new Error("cancelled:user");
    }

    if (!shouldUseDistributed(planResult.totalFrames, planResult.chunkCount)) {
      console.info(
        `[distributed] task=${taskId} below threshold ` +
          `(frames=${planResult.totalFrames} chunks=${planResult.chunkCount}); falling back to single-instance render`,
      );
      await cleanupDistributedWorkRoot(workRoot, projectDir);
      await updateRenderTaskDistributedMeta(taskId, {
        renderMode: "single",
        distributedPhase: null,
        planOssPrefix: null,
        planHash: null,
        chunkCount: null,
      });
      const result = await renderUrlToVideo(request, onProgress, abortSignal);
      return { kind: "completed", result };
    }

    const bucket = resolveVideoRenderOssBucket();
    if (!resolveUploadToOss(request.uploadToOss)) {
      throw new Error(
        "Distributed render requires OSS upload (set AINOBI_VIDEO_RENDER_OSS_UPLOAD=true or uploadToOss: true).",
      );
    }

    const planOssPrefix = buildDistributedPlanOssPrefix(taskId);
    await updateRenderTaskDistributedMeta(taskId, {
      renderMode: "distributed",
      distributedPhase: "planning",
      stage: "planning",
      progress: 5,
      totalFrames: planResult.totalFrames,
      framesRendered: 0,
      planHash: planResult.planHash,
      planOssPrefix,
      chunkCount: planResult.chunkCount,
    });

    console.info(
      `[distributed] task=${taskId} uploading planDir hash=${planResult.planHash} ` +
        `frames=${planResult.totalFrames} chunks=${planResult.chunkCount}`,
    );
    let lastUploadProgress = 5;
    const uploaded = await uploadDirectoryToOss(
      planDir,
      planOssPrefix,
      bucket,
      async (done, total) => {
        const next = planningUploadProgress(done, total);
        if (next > lastUploadProgress) {
          lastUploadProgress = next;
          await bumpPlanningProgress(taskId, next);
        }
      },
    );
    console.info(`[distributed] task=${taskId} uploaded ${uploaded} plan objects to ${planOssPrefix}`);
    await bumpPlanningProgress(taskId, 7);

    await deletePendingDistributedChunks(taskId, bucket);
    const chunkRows = await createRenderTaskChunks(
      chunks.map((c) => ({
        taskId,
        chunkIndex: c.index,
        startFrame: c.startFrame,
        endFrame: c.endFrame,
      })),
    );

    await updateRenderTaskDistributedMeta(taskId, {
      distributedPhase: "chunking",
      stage: "chunking",
      progress: 8,
      totalFrames: planResult.totalFrames,
      framesRendered: 0,
      planTakesMs: Date.now() - planStartedAt,
    });

    const scheduleErrors: string[] = [];
    for (const chunk of chunkRows) {
      try {
        await scheduleRenderTaskChunkRun({
          taskId,
          chunkIndex: chunk.chunkIndex,
          affinityId: chunk.affinityId,
          renderBaseUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        scheduleErrors.push(`chunk ${chunk.chunkIndex}: ${message}`);
        console.warn(
          `[distributed] task=${taskId} failed to schedule chunk=${chunk.chunkIndex}:`,
          message,
        );
      }
    }

    if (scheduleErrors.length > 0) {
      // Partial fan-out is worse than failing fast — remaining queued chunks would hang.
      const detail = scheduleErrors.join("; ");
      await stopDistributedRenderWorkers(taskId, {
        reason: "cancelled:dispatch_failed",
        renderBaseUrl,
      });
      throw new RenderScheduleError(
        `distributed fan-out incomplete (${scheduleErrors.length}/${chunkRows.length} failed): ${detail}`,
      );
    }

    console.info(
      `[distributed] task=${taskId} fan-out scheduled for ${chunkRows.length} chunks; plan instance releasing`,
    );
    return {
      kind: "fanout",
      chunkCount: planResult.chunkCount,
      totalFrames: planResult.totalFrames,
    };
  } finally {
    await cleanupDistributedWorkRoot(workRoot, projectDir);
  }
}

async function deletePendingDistributedChunks(taskId: string, bucket: string): Promise<void> {
  await deleteRenderTaskChunks(taskId);
  try {
    await deleteOssPrefix(bucket, `renders/${taskId}/chunks`);
  } catch (error) {
    console.warn(
      `[distributed] task=${taskId} failed to clear old chunk OSS prefix:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Chunk worker: download planDir, renderChunk, upload mp4, maybe schedule assemble.
 */
export async function runDistributedChunkExecution(options: {
  taskId: string;
  chunkIndex: number;
  abortSignal?: AbortSignal;
  renderBaseUrl: string;
}): Promise<void> {
  const { taskId, chunkIndex, abortSignal, renderBaseUrl } = options;
  const task = await getRenderTaskById(taskId);
  if (!task) {
    throw new Error(`Render task ${taskId} not found`);
  }
  if (task.status === "cancelled") {
    return;
  }
  if (task.renderMode !== "distributed" || !task.planOssPrefix) {
    throw new Error(`Task ${taskId} is not in distributed chunking mode`);
  }

  const chunk = await getRenderTaskChunk(taskId, chunkIndex);
  if (!chunk) {
    throw new Error(`Chunk ${chunkIndex} for task ${taskId} not found`);
  }
  if (chunk.status === "completed") {
    return;
  }
  if (chunk.status === "cancelled" || chunk.status === "failed") {
    return;
  }

  const becameRunning = await markRenderTaskChunkRunning(taskId, chunkIndex);
  if (!becameRunning) {
    return;
  }

  const chunkWorkStartedAt = Date.now();
  const bucket = resolveVideoRenderOssBucket();
  const workRoot = join(resolveOutputDir(), `chunk-${taskId}-${chunkIndex}-${randomUUID()}`);
  const planDir = join(workRoot, "plan");
  const chunkPath = join(workRoot, `${chunkIndex}.mp4`);
  // Immediate write so UI moves before the first 5s heartbeat.
  void persistDistributedChunkingProgress(taskId, { chunkIndex });
  const heartbeat = setInterval(() => {
    void touchRenderTaskChunkHeartbeat(taskId, chunkIndex);
    void persistDistributedChunkingProgress(taskId, { chunkIndex });
  }, 5_000);
  heartbeat.unref();

  try {
    if (await isRenderTaskCancelled(taskId)) {
      throw new Error("cancelled:user");
    }
    if (abortSignal?.aborted) {
      throw new Error("cancelled:timeout");
    }

    await mkdir(planDir, { recursive: true });
    const downloaded = await downloadDirectoryFromOss(task.planOssPrefix, planDir, bucket);
    console.info(
      `[distributed] task=${taskId} chunk=${chunkIndex} downloaded ${downloaded} plan objects`,
    );

    const result = await renderDistributedChunk(planDir, chunkIndex, chunkPath);
    if (await isRenderTaskCancelled(taskId)) {
      throw new Error("cancelled:user");
    }
    if (abortSignal?.aborted) {
      throw new Error("cancelled:timeout");
    }

    const ossKey = buildDistributedChunkObjectKey(taskId, chunkIndex);
    await uploadFileToOss(chunkPath, ossKey, bucket);
    const durationMs = Math.max(1, Date.now() - chunkWorkStartedAt);
    const completedChunk = await markRenderTaskChunkCompleted(taskId, chunkIndex, {
      ossKey,
      framesEncoded: result.framesEncoded,
      durationMs,
    });
    if (!completedChunk) {
      console.info(
        `[distributed] task=${taskId} chunk=${chunkIndex} finish raced (no longer running); skipping progress`,
      );
      return;
    }

    const framesRendered = await sumCompletedChunkFrames(taskId);
    const totalFrames = task.totalFrames ?? framesRendered;
    const captureProgress = framesToChunkingProgress(framesRendered, totalFrames);
    const latestForProgress = await getRenderTaskById(taskId);
    await updateRenderTaskProgress(taskId, {
      stage: "chunking",
      progress: Math.max(latestForProgress?.progress ?? 0, captureProgress),
      framesRendered: Math.max(latestForProgress?.framesRendered ?? 0, framesRendered),
      totalFrames,
    });
    void import("./render-task-callback.ts")
      .then(async ({ notifyRenderTaskProgressCallback }) => {
        // Completion may race across chunks; Redis claim still dedupes the webhook.
        const latestAfterChunk = await getRenderTaskById(taskId);
        if (latestAfterChunk) {
          await notifyRenderTaskProgressCallback(latestAfterChunk);
        }
      })
      .catch(() => undefined);

    console.info(
      `[distributed] task=${taskId} chunk=${chunkIndex} completed frames=${result.framesEncoded} key=${ossKey}`,
    );

    if (await areAllChunksCompleted(taskId)) {
      const claimed = await tryClaimAssemblePhase(taskId);
      if (claimed) {
        try {
          await scheduleRenderTaskAssemble({
            taskId,
            affinityId: randomUUID(),
            renderBaseUrl,
          });
          console.info(`[distributed] task=${taskId} all chunks done; assemble scheduled`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Leave phase=assembling so reconcile can re-dispatch assemble.
          console.warn(
            `[distributed] task=${taskId} assemble schedule failed (will reconcile):`,
            message,
          );
          await updateRenderTaskProgress(taskId, {
            stage: "assembling",
            progress: 88,
          });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "cancelled:user") {
      return;
    }
    // Soft-timeout / sibling abort: fail the chunk + parent (unless already terminal).
    await markRenderTaskChunkFailed(taskId, chunkIndex, message);
    const parentMessage =
      message === "cancelled:timeout"
        ? formatFcTimeoutErrorMessage()
        : `distributed chunk ${chunkIndex} failed: ${message}`;
    const failed = await markRenderTaskFailed(taskId, parentMessage);
    if (failed) {
      console.error(`[distributed] task=${taskId} chunk=${chunkIndex} failed:`, parentMessage);
      await stopDistributedRenderWorkers(taskId, {
        reason:
          message === "cancelled:timeout" ? "cancelled:timeout" : "cancelled:sibling_failed",
        renderBaseUrl,
      });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Transition distributedPhase → assembling atomically; returns false if already assembling/done. */
async function tryClaimAssemblePhase(taskId: string): Promise<boolean> {
  await ensureDataSource();
  const repo = dataSource.getRepository(RenderTaskEntity);
  const result = await repo
    .createQueryBuilder()
    .update(RenderTaskEntity)
    .set({
      distributedPhase: "assembling",
      stage: "assembling",
      progress: 88,
      heartbeatAt: new Date(),
    })
    .where("id = :taskId", { taskId })
    .andWhere("status = :status", { status: "running" })
    .andWhere("(distributed_phase IS NULL OR distributed_phase <> :assembling)", {
      assembling: "assembling",
    })
    .execute();
  return (result.affected ?? 0) > 0;
}

/**
 * Exclusive lease to re-dispatch assemble when phase is already `assembling` but heartbeat is stale.
 * Bumps heartbeat so concurrent heal ticks / workers lose the race.
 */
async function tryClaimStaleAssembleReschedule(
  taskId: string,
  staleMs: number,
  nowMs: number = Date.now(),
): Promise<boolean> {
  await ensureDataSource();
  const repo = dataSource.getRepository(RenderTaskEntity);
  const threshold = new Date(nowMs - staleMs);
  const result = await repo
    .createQueryBuilder()
    .update(RenderTaskEntity)
    .set({
      heartbeatAt: new Date(nowMs),
      stage: "assembling",
      progress: 88,
    })
    .where("id = :taskId", { taskId })
    .andWhere("status = :status", { status: "running" })
    .andWhere("distributed_phase = :phase", { phase: "assembling" })
    .andWhere("(heartbeat_at IS NULL OR heartbeat_at < :threshold)", { threshold })
    .execute();
  return (result.affected ?? 0) > 0;
}

/**
 * Assemble worker: download chunks + plan meta/audio, stitch, upload final + cover.
 */
export async function runDistributedAssembleExecution(options: {
  taskId: string;
  abortSignal?: AbortSignal;
}): Promise<VideoRenderResponse> {
  const { taskId, abortSignal } = options;
  const task = await getRenderTaskById(taskId);
  if (!task) {
    throw new Error(`Render task ${taskId} not found`);
  }
  if (task.status === "cancelled") {
    throw new Error("cancelled:user");
  }
  if (task.renderMode !== "distributed" || !task.planOssPrefix) {
    throw new Error(`Task ${taskId} is not ready for assemble`);
  }

  await updateRenderTaskDistributedMeta(taskId, {
    distributedPhase: "assembling",
    stage: "assembling",
    progress: 88,
  });

  const bucket = resolveVideoRenderOssBucket();
  const chunks = await listRenderTaskChunks(taskId);
  if (chunks.length === 0 || !chunks.every((c) => c.status === "completed" && c.ossKey)) {
    throw new Error(`Task ${taskId} has incomplete chunks; cannot assemble`);
  }

  const workRoot = join(resolveOutputDir(), `assemble-${taskId}-${randomUUID()}`);
  const planDir = join(workRoot, "plan");
  const chunksDir = join(workRoot, "chunks");
  const jobId = randomUUID();
  const outputPath = join(workRoot, `${jobId}.mp4`);

  const heartbeat = setInterval(() => {
    void updateRenderTaskProgress(taskId, { stage: "assembling", progress: 88 });
  }, 15_000);
  heartbeat.unref();

  const assembleStartedAt = Date.now();

  try {
    await mkdir(planDir, { recursive: true });
    await mkdir(chunksDir, { recursive: true });
    await downloadDirectoryFromOss(task.planOssPrefix, planDir, bucket);

    const chunkPaths: string[] = [];
    for (const chunk of chunks) {
      const local = join(chunksDir, `${chunk.chunkIndex}.mp4`);
      await downloadOssObjectToFile(bucket, chunk.ossKey!, local);
      chunkPaths.push(local);
    }

    const hasAudio = await fileExists(join(planDir, "audio.aac"));
    await assembleDistributed({
      planDir,
      chunkPaths,
      outputPath,
      hasAudio,
      abortSignal,
    });

    if (await isRenderTaskCancelled(taskId)) {
      throw new Error("cancelled:user");
    }
    if (abortSignal?.aborted) {
      throw new Error("cancelled:timeout");
    }

    await updateRenderTaskProgress(taskId, { stage: "uploading", progress: 92, framesRendered: null, totalFrames: null });

    const planJson = JSON.parse(await readFile(join(planDir, "plan.json"), "utf8")) as {
      totalFrames?: number;
      fps?: number;
    };
    const totalFrames = planJson.totalFrames ?? task.totalFrames ?? 0;
    const fps = planJson.fps ?? 30;
    const renderedDurationMs = Math.round((totalFrames / fps) * 1000);

    const response: VideoRenderResponse = {
      ok: true,
      jobId,
      localPath: outputPath,
      outputPath,
      render: {
        duration: renderedDurationMs,
        takes: 0,
        rtf: 0,
      },
      ossUploadEnabled: true,
    };

    let coverLocalPath = join(workRoot, `${jobId}-cover.jpg`);
    try {
      await extractVideoCoverJpeg(outputPath, coverLocalPath, 1);
      response.cover = await uploadImageToOss(
        coverLocalPath,
        buildVideoRenderCoverObjectKey(jobId),
        bucket,
      );
    } catch (coverError) {
      console.warn(
        `[distributed] task=${taskId} cover failed:`,
        coverError instanceof Error ? coverError.message : coverError,
      );
    }

    response.oss = await uploadFileToOss(
      outputPath,
      buildVideoRenderObjectKey(jobId, outputPath),
      bucket,
    );

    const wallTakes = task.startedAt ? Date.now() - task.startedAt.getTime() : 0;
    const planMs = Math.max(0, task.planTakesMs ?? 0);
    const chunkMs = await sumCompletedChunkDurationsMs(taskId);
    const assembleMs = Math.max(1, Date.now() - assembleStartedAt);
    const computeTakes = Math.max(1, planMs + chunkMs + assembleMs);
    response.render = {
      duration: renderedDurationMs,
      takes: wallTakes,
      computeTakes,
      computeBreakdown: { planMs, chunkMs, assembleMs },
      rtf: renderedDurationMs > 0 ? wallTakes / renderedDurationMs : 0,
    };
    console.info(
      `[distributed] task=${taskId} computeTakes=${computeTakes}ms ` +
        `(plan=${planMs} chunk=${chunkMs} assemble=${assembleMs}) wallTakes=${wallTakes}ms`,
    );

    const completed = await markRenderTaskCompleted(taskId, {
      localPath: response.localPath,
      outputPath: response.outputPath,
      render: response.render,
      oss: response.oss,
      cover: response.cover,
    });
    if (!completed) {
      console.info(`[distributed] task=${taskId} assemble finished but task no longer running`);
      return response;
    }

    // Only the winner of markCompleted may delete intermediates (avoid racing a second assemble).
    try {
      await deleteOssPrefix(bucket, task.planOssPrefix);
      await deleteOssPrefix(bucket, `renders/${taskId}/chunks`);
    } catch (cleanupError) {
      console.warn(
        `[distributed] task=${taskId} intermediate OSS cleanup failed:`,
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
      );
    }

    return response;
  } finally {
    clearInterval(heartbeat);
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Reconcile helper: re-dispatch stale queued/running chunks and re-schedule assemble when
 * all chunks are done but assemble hasn't progressed (lost Async invoke).
 */
export async function healDistributedRenderTasks(
  renderBaseUrl: string = resolveRenderBaseUrl(),
): Promise<{ rescheduledChunks: number; rescheduledAssemble: number }> {
  const STALE_QUEUED_MS = 60_000;
  const STALE_ASSEMBLE_MS = 60_000;
  const staleChunkMs = resolveRenderTaskStaleHeartbeatMs();
  const tasks = await listRunningDistributedRenderTasks();
  let rescheduledChunks = 0;
  let rescheduledAssemble = 0;

  for (const task of tasks) {
    if (await isRenderTaskCancelled(task.id)) {
      continue;
    }

    const phase = task.distributedPhase;
    if (phase === "planning" || phase === "chunking") {
      // Job-mode chunk Jobs restart themselves (restartPolicy: OnFailure) and keep
      // heartbeating; requeueing a chunk under a live Job would break its completion
      // claim. Job loss surfaces as a failed chunk/parent instead.
      const jobDispatch = resolveRenderJobDispatchEnabled();
      const requeued = jobDispatch
        ? []
        : await requeueStaleRunningRenderTaskChunks(task.id, staleChunkMs);
      for (const chunk of requeued) {
        try {
          await scheduleRenderTaskChunkRun({
            taskId: task.id,
            chunkIndex: chunk.chunkIndex,
            affinityId: chunk.affinityId,
            renderBaseUrl,
          });
          rescheduledChunks += 1;
          console.info(
            `[distributed] healed task=${task.id} requeued stale running chunk=${chunk.chunkIndex}`,
          );
        } catch (error) {
          console.warn(
            `[distributed] heal requeued-chunk schedule failed task=${task.id} chunk=${chunk.chunkIndex}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      const queued = await listQueuedRenderTaskChunks(task.id);
      const now = Date.now();
      for (const chunk of queued) {
        if (now - chunk.queuedAt.getTime() < STALE_QUEUED_MS) {
          continue;
        }
        try {
          await scheduleRenderTaskChunkRun({
            taskId: task.id,
            chunkIndex: chunk.chunkIndex,
            affinityId: chunk.affinityId,
            renderBaseUrl,
          });
          rescheduledChunks += 1;
          console.info(
            `[distributed] healed task=${task.id} re-dispatched stale queued chunk=${chunk.chunkIndex}`,
          );
        } catch (error) {
          console.warn(
            `[distributed] heal chunk schedule failed task=${task.id} chunk=${chunk.chunkIndex}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      if (await areAllChunksCompleted(task.id)) {
        const claimed = await tryClaimAssemblePhase(task.id);
        if (claimed) {
          try {
            await scheduleRenderTaskAssemble({
              taskId: task.id,
              affinityId: randomUUID(),
              renderBaseUrl,
            });
            rescheduledAssemble += 1;
            console.info(`[distributed] healed task=${task.id} claimed assemble after all chunks done`);
          } catch (error) {
            console.warn(
              `[distributed] heal assemble schedule failed task=${task.id}:`,
              error instanceof Error ? error.message : error,
            );
          }
        }
      }
    }

    if (phase === "assembling") {
      if (!(await areAllChunksCompleted(task.id))) {
        continue;
      }
      const claimed = await tryClaimStaleAssembleReschedule(task.id, STALE_ASSEMBLE_MS);
      if (!claimed) {
        continue;
      }
      try {
        await scheduleRenderTaskAssemble({
          taskId: task.id,
          affinityId: randomUUID(),
          renderBaseUrl,
        });
        rescheduledAssemble += 1;
        console.info(`[distributed] healed task=${task.id} re-scheduled stale assemble (lease claimed)`);
      } catch (error) {
        console.warn(
          `[distributed] heal assemble reschedule failed task=${task.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return { rescheduledChunks, rescheduledAssemble };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
