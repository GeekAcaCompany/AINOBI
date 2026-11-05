// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  assemble,
  plan,
  renderChunk,
  type AssembleResult,
  type ChunkResult,
  type DistributedRenderConfig,
  type PlanResult,
} from "@hyperframes/producer/distributed";
import { resolveConfig } from "@hyperframes/producer";

import {
  ensureHyperframesBrowserEnv,
  resolveBrowserExecutablePath,
  resolveBrowserUseGpu,
  resolveCoursewarePrepareTimeoutMs,
  resolveDefaultVideoFps,
  resolveDefaultVideoHeight,
  resolveDefaultVideoWidth,
  resolveDistributedChunkSize,
  resolveDistributedChunkWorkers,
  resolveDistributedMaxParallelChunks,
  resolveOutputDir,
} from "../config/video-render.ts";
import {
  isCoursewareRendererUrl,
  withCoursewareRendererRenderParams,
} from "./courseware-renderer-prepare.ts";
import { buildHyperframesRedirectProject } from "./hyperframes-url-project.ts";
import type { VideoRenderRequest } from "./video-render.ts";

export interface ChunkSlice {
  index: number;
  startFrame: number;
  endFrame: number;
}

export interface DistributedPlanArtifacts {
  planResult: PlanResult;
  planDir: string;
  projectDir: string;
  chunks: ChunkSlice[];
  /** Temporary root under outputDir that owns planDir + projectDir; caller should rm. */
  workRoot: string;
}

function resolveDistributedFps(fps: number): 24 | 30 | 60 {
  if (fps === 24 || fps === 30 || fps === 60) {
    return fps;
  }
  // Closest supported integer fps for the distributed pipeline.
  if (fps < 27) {
    return 24;
  }
  if (fps < 45) {
    return 30;
  }
  return 60;
}

export function buildDistributedRenderConfig(options: {
  width: number;
  height: number;
  fps: number;
  abortSignal?: AbortSignal;
}): DistributedRenderConfig {
  ensureHyperframesBrowserEnv();
  const browserExecutablePath = resolveBrowserExecutablePath();
  const browserUseGpu = resolveBrowserUseGpu();
  const prepareTimeoutMs = Math.max(resolveCoursewarePrepareTimeoutMs(), 120_000);

  return {
    fps: resolveDistributedFps(options.fps),
    width: options.width,
    height: options.height,
    format: "mp4",
    codec: "h264",
    quality: "standard",
    hdrMode: "force-sdr",
    chunkSize: resolveDistributedChunkSize(),
    maxParallelChunks: resolveDistributedMaxParallelChunks(),
    rejectOnSystemFonts: false,
    abortSignal: options.abortSignal,
    producerConfig: {
      ...resolveConfig(),
      // Distributed path locks BeginFrame + software GL; still pass chrome path / timeouts.
      disableGpu: !browserUseGpu,
      browserGpuMode: "software",
      playerReadyTimeout: prepareTimeoutMs,
      pageNavigationTimeout: Math.max(prepareTimeoutMs, 60_000),
      concurrency: resolveDistributedChunkWorkers(),
      ...(browserExecutablePath ? { chromePath: browserExecutablePath } : {}),
    },
  };
}

export async function buildProjectDirForRenderRequest(
  input: VideoRenderRequest,
): Promise<{ projectDir: string; width: number; height: number; fps: number }> {
  const width = input.width ?? resolveDefaultVideoWidth();
  const height = input.height ?? resolveDefaultVideoHeight();
  const fps = input.fps ?? resolveDefaultVideoFps();
  const coursewareRenderer = isCoursewareRendererUrl(input.url);
  const durationSecForBridge = coursewareRenderer ? 0 : (input.duration ?? 10_000) / 1000;
  const renderUrl = coursewareRenderer
    ? withCoursewareRendererRenderParams(input.url, {
        width,
        height,
        ...(input.duration != null ? { durationMs: input.duration } : {}),
      })
    : input.url;

  const projectDir = buildHyperframesRedirectProject({
    targetUrl: renderUrl,
    width,
    height,
    durationSec: durationSecForBridge,
    compositionId: coursewareRenderer ? "courseware" : "external-page",
  });

  return { projectDir, width, height, fps };
}

export async function readPlanChunkSlices(planDir: string): Promise<ChunkSlice[]> {
  const raw = await readFile(join(planDir, "meta", "chunks.json"), "utf8");
  const parsed = JSON.parse(raw) as Array<{ index: number; startFrame: number; endFrame: number }>;
  return parsed.map((c) => ({
    index: c.index,
    startFrame: c.startFrame,
    endFrame: c.endFrame,
  }));
}

/**
 * Run Hyperframes `plan()` for a URL-based composition.
 * Caller owns cleanup of `workRoot` (and thus planDir/projectDir).
 */
export async function planDistributedForRequest(
  input: VideoRenderRequest,
  abortSignal?: AbortSignal,
): Promise<DistributedPlanArtifacts> {
  const { projectDir, width, height, fps } = await buildProjectDirForRenderRequest(input);
  const workRoot = join(resolveOutputDir(), `plan-${randomUUID()}`);
  const planDir = join(workRoot, "plan");
  await mkdir(planDir, { recursive: true });

  try {
    const config = buildDistributedRenderConfig({ width, height, fps, abortSignal });
    const planResult = await plan(projectDir, config, planDir);
    const chunks = await readPlanChunkSlices(planDir);
    return { planResult, planDir, projectDir, chunks, workRoot };
  } catch (error) {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function renderDistributedChunk(
  planDir: string,
  chunkIndex: number,
  outputChunkPath: string,
): Promise<ChunkResult> {
  ensureHyperframesBrowserEnv();
  await mkdir(dirname(outputChunkPath), { recursive: true });
  return renderChunk(planDir, chunkIndex, outputChunkPath);
}

export async function assembleDistributed(options: {
  planDir: string;
  chunkPaths: string[];
  outputPath: string;
  hasAudio: boolean;
  abortSignal?: AbortSignal;
}): Promise<AssembleResult> {
  ensureHyperframesBrowserEnv();
  await mkdir(dirname(options.outputPath), { recursive: true });
  const audioPath = options.hasAudio ? join(options.planDir, "audio.aac") : null;
  return assemble(options.planDir, options.chunkPaths, audioPath, options.outputPath, {
    abortSignal: options.abortSignal,
  });
}

export async function cleanupDistributedWorkRoot(workRoot: string, projectDir?: string): Promise<void> {
  await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  if (projectDir) {
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
