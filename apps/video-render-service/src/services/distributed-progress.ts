// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Aggregate distributed chunking progress for UI polling.
 *
 * Hyperframes `renderChunk` has no onProgress hook, and equal-sized chunks tend to
 * finish together — so completing-only updates look stuck at ~8% then jump to done.
 * While chunks are `running`, estimate captured frames from wall-clock × fps (capped
 * below the chunk span) so `progress` / `framesRendered` move during the long wait.
 */

export type DistributedProgressChunk = {
  status: string;
  startFrame: number;
  endFrame: number;
  framesEncoded: number | null;
  startedAt: Date | null;
};

/** Default capture rate guess from recent single-instance prod (~3 fps). */
export const DISTRIBUTED_PROGRESS_ESTIMATE_FPS = 3;

export function chunkFrameSpan(chunk: Pick<DistributedProgressChunk, "startFrame" | "endFrame">): number {
  return Math.max(0, chunk.endFrame - chunk.startFrame + 1);
}

/**
 * Map estimated frames into the chunking band used by the orchestrator:
 * planning ends ~8%, assemble starts ~88%, so capture lives in 8..85.
 */
export function framesToChunkingProgress(framesRendered: number, totalFrames: number): number {
  const total = Math.max(totalFrames, 1);
  const capped = Math.min(Math.max(framesRendered, 0), total);
  return Math.min(85, 8 + Math.round((capped / total) * 77));
}

export function estimateDistributedChunkingProgress(options: {
  totalFrames: number;
  chunks: DistributedProgressChunk[];
  nowMs?: number;
  estimateFps?: number;
}): {
  framesRendered: number;
  progress: number;
  chunksCompleted: number;
  chunksRunning: number;
  chunksQueued: number;
} {
  const nowMs = options.nowMs ?? Date.now();
  const estimateFps = options.estimateFps ?? DISTRIBUTED_PROGRESS_ESTIMATE_FPS;
  let framesRendered = 0;
  let chunksCompleted = 0;
  let chunksRunning = 0;
  let chunksQueued = 0;

  for (const chunk of options.chunks) {
    const span = chunkFrameSpan(chunk);
    if (chunk.status === "completed") {
      chunksCompleted += 1;
      framesRendered += chunk.framesEncoded ?? span;
      continue;
    }
    if (chunk.status === "queued") {
      chunksQueued += 1;
      continue;
    }
    if (chunk.status !== "running") {
      continue;
    }
    chunksRunning += 1;
    if (!chunk.startedAt || span <= 0) {
      continue;
    }
    const elapsedSec = Math.max(0, (nowMs - chunk.startedAt.getTime()) / 1000);
    // Stay strictly below `span` so completion (exact framesEncoded) is the only way to 100% of a chunk.
    const estimated = Math.min(span - 1, Math.floor(elapsedSec * estimateFps));
    framesRendered += Math.max(0, estimated);
  }

  const totalFrames = Math.max(options.totalFrames, 1);
  framesRendered = Math.min(framesRendered, totalFrames);
  return {
    framesRendered,
    progress: framesToChunkingProgress(framesRendered, totalFrames),
    chunksCompleted,
    chunksRunning,
    chunksQueued,
  };
}

/**
 * Only the lowest-index *running* chunk should emit progress webhooks, so 8 FC
 * workers don't stampede the callback URL. Returns `null` when nobody is running
 * (caller may notify — e.g. planning / assemble / final chunk completion).
 */
export function resolveDistributedProgressCallbackLeader(
  runningChunkIndexes: number[],
): number | null {
  if (runningChunkIndexes.length === 0) {
    return null;
  }
  return Math.min(...runningChunkIndexes);
}

/** Map planDir upload file count into planning band 5..7. */
export function planningUploadProgress(uploaded: number, total: number): number {
  if (total <= 0) {
    return 5;
  }
  const ratio = Math.min(1, Math.max(0, uploaded / total));
  return Math.min(7, 5 + Math.floor(ratio * 2));
}
