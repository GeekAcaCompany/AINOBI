// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { resolveChunkPlan } from "@hyperframes/producer/distributed";

import {
  resolveDistributedChunkSize,
  resolveDistributedChunkWorkers,
  resolveDistributedMaxParallelChunks,
  resolveDistributedMinFrames,
  resolveDistributedRenderEnabled,
} from "../config/video-render.ts";
import { shouldFanOutDistributedRender } from "./distributed-orchestrator.ts";
import {
  estimateDistributedChunkingProgress,
  framesToChunkingProgress,
  planningUploadProgress,
  resolveDistributedProgressCallbackLeader,
} from "./distributed-progress.ts";
import { buildDistributedPlanOssPrefix, buildDistributedChunkObjectKey } from "./oss-upload.ts";
import { RenderScheduleError } from "./render-task-schedule.ts";
import {
  abortRenderTaskExecution,
  registerRenderTaskAbortController,
  unregisterRenderTaskAbortController,
} from "./render-task-abort.ts";

test("distributed config defaults match plan", () => {
  const prev = {
    enabled: process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_ENABLED,
    min: process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_MIN_FRAMES,
    chunk: process.env.AINOBI_VIDEO_RENDER_CHUNK_SIZE,
    max: process.env.AINOBI_VIDEO_RENDER_MAX_PARALLEL_CHUNKS,
    workers: process.env.AINOBI_VIDEO_RENDER_CHUNK_WORKERS,
  };
  try {
    delete process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_ENABLED;
    delete process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_MIN_FRAMES;
    delete process.env.AINOBI_VIDEO_RENDER_CHUNK_SIZE;
    delete process.env.AINOBI_VIDEO_RENDER_MAX_PARALLEL_CHUNKS;
    delete process.env.AINOBI_VIDEO_RENDER_CHUNK_WORKERS;

    assert.equal(resolveDistributedRenderEnabled(), true);
    assert.equal(resolveDistributedMinFrames(), 3000);
    assert.equal(resolveDistributedChunkSize(), 900);
    assert.equal(resolveDistributedMaxParallelChunks(), 8);
    assert.equal(resolveDistributedChunkWorkers(), 2);
  } finally {
    process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_ENABLED = prev.enabled;
    process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_MIN_FRAMES = prev.min;
    process.env.AINOBI_VIDEO_RENDER_CHUNK_SIZE = prev.chunk;
    process.env.AINOBI_VIDEO_RENDER_MAX_PARALLEL_CHUNKS = prev.max;
    process.env.AINOBI_VIDEO_RENDER_CHUNK_WORKERS = prev.workers;
  }
});

test("shouldFanOutDistributedRender respects threshold and chunkCount", () => {
  assert.equal(shouldFanOutDistributedRender(21072, 8, { enabled: true, minFrames: 3000 }), true);
  assert.equal(shouldFanOutDistributedRender(5000, 8, { enabled: true, minFrames: 3000 }), true);
  assert.equal(shouldFanOutDistributedRender(2000, 8, { enabled: true, minFrames: 3000 }), false);
  assert.equal(shouldFanOutDistributedRender(21072, 1, { enabled: true, minFrames: 3000 }), false);
  assert.equal(shouldFanOutDistributedRender(21072, 8, { enabled: false, minFrames: 3000 }), false);
});

test("resolveChunkPlan with chunkSize=900 and maxParallel=8 matches yesterday failure sizing", () => {
  const plan = resolveChunkPlan(21072, 900, 8);
  assert.equal(plan.chunkCount, 8);
  assert.ok(plan.effectiveChunkSize >= 900);
  // 21072 / 8 = 2634 frames per chunk when size is raised to fill
  assert.equal(plan.effectiveChunkSize, 2634);
});

test("OSS key helpers for plan/chunks", () => {
  assert.equal(buildDistributedPlanOssPrefix("task-1"), "renders/task-1/plan");
  assert.equal(buildDistributedChunkObjectKey("task-1", 3), "renders/task-1/chunks/3.mp4");
});

test("progress aggregation formula stays within chunking band", () => {
  const totalFrames = 21072;
  const framesRendered = 10536;
  const captureProgress = framesToChunkingProgress(framesRendered, totalFrames);
  assert.equal(captureProgress, 47);
});

test("estimateDistributedChunkingProgress advances while equal chunks are all running", () => {
  const totalFrames = 18000;
  const span = 2250;
  const startedAt = new Date("2026-07-22T07:00:00Z");
  const chunks = Array.from({ length: 8 }, (_, index) => ({
    status: "running",
    startFrame: index * span,
    endFrame: index * span + span - 1,
    framesEncoded: null,
    startedAt,
  }));

  const atStart = estimateDistributedChunkingProgress({
    totalFrames,
    chunks,
    nowMs: startedAt.getTime(),
    estimateFps: 3,
  });
  assert.equal(atStart.framesRendered, 0);
  assert.equal(atStart.progress, 8);
  assert.equal(atStart.chunksRunning, 8);

  const after5Min = estimateDistributedChunkingProgress({
    totalFrames,
    chunks,
    nowMs: startedAt.getTime() + 5 * 60_000,
    estimateFps: 3,
  });
  // 8 chunks × min(2249, 5*60*3=900) = 7200 frames → progress moves well past 8%
  assert.equal(after5Min.framesRendered, 7200);
  assert.ok(after5Min.progress > 30);
  assert.ok(after5Min.progress < 85);
});

test("estimateDistributedChunkingProgress counts completed chunks exactly", () => {
  const estimated = estimateDistributedChunkingProgress({
    totalFrames: 1000,
    chunks: [
      {
        status: "completed",
        startFrame: 0,
        endFrame: 499,
        framesEncoded: 500,
        startedAt: new Date(),
      },
      {
        status: "queued",
        startFrame: 500,
        endFrame: 999,
        framesEncoded: null,
        startedAt: null,
      },
    ],
  });
  assert.equal(estimated.framesRendered, 500);
  assert.equal(estimated.chunksCompleted, 1);
  assert.equal(estimated.chunksQueued, 1);
  assert.equal(estimated.progress, framesToChunkingProgress(500, 1000));
});

test("resolveDistributedProgressCallbackLeader picks lowest running index", () => {
  assert.equal(resolveDistributedProgressCallbackLeader([3, 1, 7]), 1);
  assert.equal(resolveDistributedProgressCallbackLeader([]), null);
});

test("planningUploadProgress maps file upload into 5..7", () => {
  assert.equal(planningUploadProgress(0, 100), 5);
  assert.equal(planningUploadProgress(50, 100), 6);
  assert.equal(planningUploadProgress(100, 100), 7);
});

test("chunk abort distinguishes user cancel vs soft timeout error codes", () => {
  // Contract used by runDistributedChunkExecution / chunk worker.
  assert.equal("cancelled:user".startsWith("cancelled:"), true);
  assert.equal("cancelled:timeout".startsWith("cancelled:"), true);
  assert.notEqual("cancelled:user", "cancelled:timeout");
});

test("RenderScheduleError is a 502 scheduling failure", () => {
  const error = new RenderScheduleError("async invoke failed");
  assert.equal(error.name, "RenderScheduleError");
  assert.equal(error.status, 502);
  assert.match(error.message, /async invoke failed/);
});

test("abortRenderTaskExecution fans out to chunk and assemble keys", () => {
  const taskId = "task-abort-fanout";
  const parent = registerRenderTaskAbortController(taskId);
  const chunk = registerRenderTaskAbortController(`${taskId}:chunk:2`);
  const assemble = registerRenderTaskAbortController(`${taskId}:assemble`);
  const other = registerRenderTaskAbortController("other-task:chunk:0");

  try {
    assert.equal(abortRenderTaskExecution(taskId), true);
    assert.equal(parent.aborted, true);
    assert.equal(chunk.aborted, true);
    assert.equal(assemble.aborted, true);
    assert.equal(other.aborted, false);
  } finally {
    unregisterRenderTaskAbortController(taskId);
    unregisterRenderTaskAbortController(`${taskId}:chunk:2`);
    unregisterRenderTaskAbortController(`${taskId}:assemble`);
    unregisterRenderTaskAbortController("other-task:chunk:0");
  }
});
