// SPDX-License-Identifier: AGPL-3.0-only
import {
  checkVideoRenderRuntimeDependencies,
  isRunningOnAliyunFc,
  isVideoRenderOssUploadEnabled,
  resolveBrowserExecutablePath,
  resolveBrowserUseGpu,
  resolveCoursewarePrepareTimeoutMs,
  resolveDefaultVideoFps,
  resolveDefaultVideoHeight,
  resolveDefaultVideoWidth,
  RENDER_TASK_AFFINITY_HEADER_NAME,
  resolveFunctionRole,
  resolveOutputDir,
  resolveRenderBaseUrl,
  resolveRenderTaskFcTimeoutMs,
  resolveRenderTaskMaxRetries,
  resolveRenderTaskSoftTimeoutMs,
  resolveRenderTaskStaleHeartbeatMs,
  resolveDistributedChunkSize,
  resolveDistributedChunkWorkers,
  resolveDistributedMaxParallelChunks,
  resolveDistributedMinFrames,
  resolveDistributedRenderEnabled,
  resolveVideoRenderOssBucket,
} from "./config/video-render.ts";
import { shouldExitFcRenderInstanceAfterTask } from "./fc-instance-lifecycle.ts";

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function envSummary(name: string): string {
  const value = process.env[name]?.trim();
  return value ? "set" : "unset";
}

/** Masks `render_token` before logging task URLs. */
export function redactSensitiveRenderUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("render_token")) {
      url.searchParams.set("render_token", "[redacted]");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function logLine(message: string): void {
  console.log(`[startup] ${message}`);
}

function logWarn(message: string): void {
  console.warn(`[startup] ${message}`);
}

/**
 * One-shot startup banner: env-derived config that affects render success/failure.
 * Intended for local integration testing — surfaces SSRF guard, task pool deps, browser path, etc.
 */
export function logVideoRenderStartupDiagnostics(port: number): void {
  const runtime = checkVideoRenderRuntimeDependencies();
  const browserPath = resolveBrowserExecutablePath();
  const allowedHosts = process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS?.trim();
  const allowPrivate = envFlag("AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS");
  const dbHost = process.env.DB_HOST?.trim();
  const dbName = process.env.DB_DATABASE?.trim();

  const functionRole = resolveFunctionRole();
  logLine("=== ainobi-video-render-service ===");
  logLine(`listen: http://localhost:${port}`);
  logLine(`functionRole: ${functionRole}`);
  if (functionRole === "render" || functionRole === "all") {
    logLine(`renderBaseUrl: ${resolveRenderBaseUrl(`http://localhost:${port}`)}`);
  }
  if (functionRole === "render") {
    logLine(`fcRenderExitAfterRun: ${shouldExitFcRenderInstanceAfterTask()}`);
  }
  if (functionRole === "query" && isRunningOnAliyunFc()) {
    const renderBase = process.env.AINOBI_VIDEO_RENDER_RENDER_BASE_URL?.trim();
    if (!renderBase) {
      logWarn(
        "query: AINOBI_VIDEO_RENDER_RENDER_BASE_URL unset — create/retry cannot Async-invoke the render function on FC",
      );
    } else {
      logLine(`renderInvokeBaseUrl: ${resolveRenderBaseUrl()}`);
    }
  }
  logLine(`outputDir: ${resolveOutputDir()}`);
  logLine(`auth: AINOBI_VIDEO_RENDER_INTERNAL_TOKEN=${envSummary("AINOBI_VIDEO_RENDER_INTERNAL_TOKEN")}`);
  logLine(
    `ssrf: allowPrivateUrls=${allowPrivate}` +
      (allowedHosts ? `, allowedHosts=${allowedHosts}` : ", allowedHosts=(any public host)"),
  );
  if (!allowPrivate) {
    logWarn(
      "ssrf: localhost/private URLs are blocked — local dev needs AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS=true",
    );
  }
  logLine(
    `taskPool: postgres=${dbHost && dbName ? `${dbHost}/${dbName}` : "unset"}` +
      `, dispatch=create→/run` +
      `, affinityHeader=${RENDER_TASK_AFFINITY_HEADER_NAME}` +
      `, maxRetries=${resolveRenderTaskMaxRetries()}` +
      `, staleHeartbeatMs=${resolveRenderTaskStaleHeartbeatMs()}` +
      `, fcTimeoutMs=${resolveRenderTaskFcTimeoutMs()}` +
      `, softTimeoutMs=${resolveRenderTaskSoftTimeoutMs()}`,
  );
  if (!dbHost) {
    logWarn("taskPool: DB_HOST unset — /render/tasks* persistence will fail");
  }
  logLine(
    `render: browser=${browserPath ?? "(auto-detect / Hyperframes bundled)"}` +
      `, useGpu=${resolveBrowserUseGpu()}` +
      `, default=${resolveDefaultVideoWidth()}x${resolveDefaultVideoHeight()}@${resolveDefaultVideoFps()}fps` +
      `, coursewarePrepareTimeoutMs=${resolveCoursewarePrepareTimeoutMs()}`,
  );
  logLine(
    `distributed: enabled=${resolveDistributedRenderEnabled()}` +
      `, minFrames=${resolveDistributedMinFrames()}` +
      `, chunkSize=${resolveDistributedChunkSize()}` +
      `, maxParallel=${resolveDistributedMaxParallelChunks()}` +
      `, chunkWorkers=${resolveDistributedChunkWorkers()}`,
  );
  logLine(
    `oss: upload=${isVideoRenderOssUploadEnabled()}, bucket=${resolveVideoRenderOssBucket()}`,
  );
  logLine(
    "courseware-renderer checklist (local): student-view (Vite) + courseware-agent must be reachable from the headless browser;" +
      " page must load GET /courseware via VITE_ORIGIN_COURSEWARE_API and reach ready (window.__hf)",
  );

  for (const warning of runtime.warnings) {
    logWarn(warning);
  }
  for (const error of runtime.errors) {
    console.error(`[startup] ${error}`);
  }
}
