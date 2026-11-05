// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { createRenderJob, executeRenderJob, resolveConfig } from "@hyperframes/producer";
import { z } from "zod";

import {
  ensureHyperframesBrowserEnv,
  isVideoRenderOssUploadEnabled,
  resolveBrowserExecutablePath,
  resolveBrowserUseGpu,
  resolveCoursewarePrepareTimeoutMs,
  resolveDefaultVideoDurationMs,
  resolveDefaultVideoFps,
  resolveDefaultVideoHeight,
  resolveDefaultVideoWidth,
  resolveOutputDir,
  resolveVideoRenderOssBucket,
} from "../config/video-render.ts";
import {
  isCoursewareRendererUrl,
  withCoursewareRendererRenderParams,
} from "./courseware-renderer-prepare.ts";
import { buildHyperframesRedirectProject } from "./hyperframes-url-project.ts";
import {
  buildVideoRenderCoverObjectKey,
  buildVideoRenderObjectKey,
  uploadFileToOss,
  uploadImageToOss,
  type OssUploadResult,
} from "./oss-upload.ts";
import { extractVideoCoverJpeg } from "./video-cover.ts";
import { assertRenderUrlAllowed } from "./render-url-guard.ts";

const urlSchema = z.string().trim().url();

export const videoRenderRequestSchema = z.object({
  url: urlSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().int().positive().optional(),
  fps: z.number().int().positive().max(120).optional(),
  uploadToOss: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

export type VideoRenderRequest = z.infer<typeof videoRenderRequestSchema>;

export interface VideoRenderResult {
  duration: number;
  /** Parent / single-instance wall-clock ms. */
  takes: number;
  rtf: number;
  /** Sum of per-instance work ms (distributed billing). Defaults to `takes` for single-path. */
  computeTakes?: number;
  computeBreakdown?: {
    planMs: number;
    chunkMs: number;
    assembleMs: number;
  };
}

export interface VideoRenderResponse {
  ok: true;
  jobId: string;
  localPath: string;
  outputPath: string;
  render: VideoRenderResult;
  ossUploadEnabled: boolean;
  oss?: {
    bucket: string;
    key: string;
    url: string;
    sizeBytes: number;
    etag?: string;
  };
  cover?: {
    bucket: string;
    key: string;
    url: string;
    sizeBytes: number;
    etag?: string;
  };
}

/** Hyperframes reports `progress` as either a 0-1 fraction or a 0-100 percentage depending on stage; normalize to a clamped 0-100 int. */
export function normalizePercent(raw: number): number {
  const percent = raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function resolveUploadToOss(requested?: boolean): boolean {
  if (requested !== undefined) {
    return requested;
  }

  return isVideoRenderOssUploadEnabled();
}

/** Optional frame counters while Hyperframes is capturing screenshots. */
export interface RenderFrameProgress {
  rendered: number;
  total: number;
}

/** `progress` is normalized to a 0-100 integer regardless of Hyperframes' own 0-1 vs 0-100 scale. */
export type RenderProgressCallback = (
  stage: string,
  progress: number,
  frames?: RenderFrameProgress | null,
) => void;

export async function renderUrlToVideo(
  input: VideoRenderRequest,
  onProgress?: RenderProgressCallback,
  abortSignal?: AbortSignal,
): Promise<VideoRenderResponse> {
  const parsed = videoRenderRequestSchema.parse(input);
  await assertRenderUrlAllowed(parsed.url);
  ensureHyperframesBrowserEnv();
  const jobId = randomUUID();
  const outputDir = resolveOutputDir();
  await mkdir(outputDir, { recursive: true });

  const outputPath = join(outputDir, `${jobId}.mp4`);
  const width = parsed.width ?? resolveDefaultVideoWidth();
  const height = parsed.height ?? resolveDefaultVideoHeight();
  const fps = parsed.fps ?? resolveDefaultVideoFps();
  const explicitDurationMs = parsed.duration;
  const coursewareRenderer = isCoursewareRendererUrl(parsed.url);
  // Courseware: keep bridge duration at 0 so Hyperframes always runs browser probe
  // (discovers audio + scene duration from window.__hf). Explicit duration flows via hf_duration_ms.
  const durationSecForBridge = coursewareRenderer
    ? 0
    : (explicitDurationMs ?? resolveDefaultVideoDurationMs()) / 1000;
  const prepareTimeoutMs = coursewareRenderer
    ? Math.max(resolveCoursewarePrepareTimeoutMs(), 120_000)
    : resolveCoursewarePrepareTimeoutMs();
  const browserExecutablePath = resolveBrowserExecutablePath();
  const browserUseGpu = resolveBrowserUseGpu();

  const renderUrl = coursewareRenderer
    ? withCoursewareRendererRenderParams(parsed.url, {
        width,
        height,
        ...(explicitDurationMs != null ? { durationMs: explicitDurationMs } : {}),
      })
    : parsed.url;

  const projectDir = buildHyperframesRedirectProject({
    targetUrl: renderUrl,
    width,
    height,
    durationSec: durationSecForBridge,
    compositionId: coursewareRenderer ? "courseware" : "external-page",
  });

  const startedAt = Date.now();

  try {
    const producerConfig = {
      ...resolveConfig(),
      forceScreenshot: true,
      disableGpu: !browserUseGpu,
      browserGpuMode: browserUseGpu ? ("auto" as const) : ("software" as const),
      playerReadyTimeout: prepareTimeoutMs,
      pageNavigationTimeout: Math.max(prepareTimeoutMs, 60_000),
      ...(browserExecutablePath ? { chromePath: browserExecutablePath } : {}),
    };

    const job = createRenderJob({
      fps,
      quality: "standard",
      format: "mp4",
      workers: 6,
      producerConfig,
    });

    await executeRenderJob(job, projectDir, outputPath, (currentJob, message) => {
      const percent = normalizePercent(currentJob.progress);
      if (process.env.AINOBI_VIDEO_RENDER_SHOW_PROGRESS === "true") {
        console.log(`[render] ${percent}% ${currentJob.currentStage}: ${message}`);
      }
      // Reserve the 90-100 tail of the progress bar for the OSS upload phase below.
      // Hyperframes sets `currentStage` to a human message ("Compiling composition") and `status`
      // to the machine key ("preprocessing"). Persist the key so the export UI can translate it.
      const frames =
        currentJob.status === "rendering" &&
        typeof currentJob.framesRendered === "number" &&
        typeof currentJob.totalFrames === "number" &&
        currentJob.totalFrames > 0
          ? { rendered: currentJob.framesRendered, total: currentJob.totalFrames }
          : currentJob.status === "rendering"
            ? undefined
            : null;
      onProgress?.(currentJob.status, Math.round(percent * 0.9), frames);
    }, abortSignal);

    const takes = Date.now() - startedAt;
    const renderedDurationMs = job.perfSummary?.compositionDurationSeconds
      ? Math.round(job.perfSummary.compositionDurationSeconds * 1000)
      : explicitDurationMs ?? resolveDefaultVideoDurationMs();
    const render: VideoRenderResult = {
      duration: renderedDurationMs,
      takes,
      computeTakes: takes,
      rtf: takes / renderedDurationMs,
    };

    const response: VideoRenderResponse = {
      ok: true,
      jobId,
      localPath: outputPath,
      outputPath,
      render,
      ossUploadEnabled: resolveUploadToOss(parsed.uploadToOss),
    };

    if (!response.ossUploadEnabled) {
      return response;
    }

    onProgress?.("uploading", 90, null);
    const bucket = resolveVideoRenderOssBucket();

    let coverOss: OssUploadResult | undefined;
    const coverLocalPath = join(outputDir, `${jobId}-cover.jpg`);
    try {
      await extractVideoCoverJpeg(outputPath, coverLocalPath, 1);
      const coverKey = buildVideoRenderCoverObjectKey(jobId);
      coverOss = await uploadImageToOss(coverLocalPath, coverKey, bucket);
      response.cover = coverOss;
    } catch (coverError) {
      console.warn(
        `[render] cover extraction/upload failed jobId=${jobId}:`,
        coverError instanceof Error ? coverError.message : coverError,
      );
    } finally {
      try {
        await rm(coverLocalPath, { force: true });
      } catch {
        /* noop */
      }
    }

    const objectKey = buildVideoRenderObjectKey(jobId, outputPath);
    const oss = await uploadFileToOss(outputPath, objectKey, bucket);
    response.oss = oss;
    onProgress?.("uploading", 100, null);

    try {
      await rm(outputPath, { force: true });
    } catch (error) {
      console.warn(
        `[render] failed to delete local video after OSS upload jobId=${jobId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    return response;
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}
