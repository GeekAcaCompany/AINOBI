// SPDX-License-Identifier: AGPL-3.0-only
import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isOciS3StorageEnabled } from "../services/oci-s3-storage.ts";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, "../..");

/**
 * Aliyun FC custom runtime injects these; used only to pick a safe default
 * output dir (the code package directory is typically read-only on FC).
 */
export function isRunningOnAliyunFc(): boolean {
  return Boolean(
    process.env.FC_FUNCTION_NAME?.trim() ||
      process.env.FC_SERVICE_NAME?.trim() ||
      process.env.FC_REGION?.trim(),
  );
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function resolveOutputDir(): string {
  const raw = process.env.AINOBI_OUTPUT_DIR?.trim();
  if (!raw) {
    // On Aliyun FC the code package directory is typically read-only;
    // fall back to /tmp instead of silently failing to write the MP4.
    // Always set AINOBI_OUTPUT_DIR explicitly in s.*.yaml for FC deploys.
    if (isRunningOnAliyunFc()) {
      return resolve(tmpdir(), "example-video-render-output");
    }
    return resolve(projectRoot, "output");
  }

  // `resolve()` treats an absolute `raw` as authoritative (ignores projectRoot),
  // so both relative (local dev) and absolute (e.g. /tmp/output on FC) work.
  return resolve(projectRoot, raw);
}

export function isVideoRenderOssUploadEnabled(): boolean {
  return parseBoolean(process.env.AINOBI_VIDEO_RENDER_OSS_UPLOAD, true);
}

/**
 * Bucket render artifacts are uploaded to.
 *
 * `STORAGE_BACKEND=oci_s3` routes every upload to OCI Object Storage, so the
 * bucket must be the OCI one (`OCI_S3_BUCKET`, e.g. example-storage) — the
 * aliyun-only envs (`AINOBI_VIDEO_RENDER_OSS_BUCKET` / `OSS_BUCKET`, still
 * present in deploy payloads during the grayscale) would point at a bucket the
 * OCI client can't write to. Default backend keeps the aliyun resolution
 * unchanged.
 */
export function resolveVideoRenderOssBucket(): string {
  if (isOciS3StorageEnabled()) {
    return (
      process.env.OCI_S3_BUCKET?.trim() ||
      process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET?.trim() ||
      process.env.OSS_BUCKET?.trim() ||
      "example-storage"
    );
  }
  return (
    process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET?.trim() ||
    process.env.OSS_BUCKET?.trim() ||
    "example-video-render-output"
  );
}

/**
 * Optional override for Hyperframes Chromium.
 *
 * Also mirrored onto `PRODUCER_HEADLESS_SHELL_PATH` (see `ensureHyperframesBrowserEnv`)
 * so Hyperframes' own env-based resolution (which validates the path exists)
 * stays in sync with this service's config. On Aliyun FC this MUST point at a
 * browser binary shipped in a custom layer (e.g. `/opt/chrome-headless-shell/...`) —
 * there is no bundled/downloadable Chromium in the deploy package.
 */
export function resolveBrowserExecutablePath(): string | undefined {
  const explicit =
    process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE?.trim() ||
    process.env.PRODUCER_HEADLESS_SHELL_PATH?.trim();
  return explicit || undefined;
}

export function resolveBrowserVersion(): string | undefined {
  const explicit = process.env.AINOBI_VIDEO_RENDER_BROWSER_VERSION?.trim();
  return explicit || undefined;
}

/** Optional override for the ffmpeg/ffprobe binaries Hyperframes shells out to. */
export function resolveFfmpegExecutablePath(): string | undefined {
  return process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || undefined;
}

export function resolveFfprobeExecutablePath(): string | undefined {
  return process.env.HYPERFRAMES_FFPROBE_PATH?.trim() || undefined;
}

/**
 * Propagate `AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE` onto the env var
 * Hyperframes itself reads (`PRODUCER_HEADLESS_SHELL_PATH`), so a single
 * config knob works whether the browser is resolved via `producerConfig.chromePath`
 * (this service) or Hyperframes' own fallback path. Call once at startup.
 */
export function ensureHyperframesBrowserEnv(): void {
  const path = resolveBrowserExecutablePath();
  if (path && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    process.env.PRODUCER_HEADLESS_SHELL_PATH = path;
  }
}

export const DEFAULT_VIDEO_WIDTH = 1920;
export const DEFAULT_VIDEO_HEIGHT = 1080;
export const DEFAULT_VIDEO_FPS = 30;
export const DEFAULT_VIDEO_DURATION_MS = 10_000;

export function resolveDefaultVideoWidth(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_WIDTH, DEFAULT_VIDEO_WIDTH);
}

export function resolveDefaultVideoHeight(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_HEIGHT, DEFAULT_VIDEO_HEIGHT);
}

export function resolveDefaultVideoFps(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_FPS, DEFAULT_VIDEO_FPS);
}

export function resolveDefaultVideoDurationMs(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_DURATION_MS, DEFAULT_VIDEO_DURATION_MS);
}

export function resolveBrowserUseGpu(): boolean {
  return parseBoolean(process.env.AINOBI_VIDEO_RENDER_BROWSER_USE_GPU, false);
}

export function resolveCoursewarePrepareTimeoutMs(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_PREPARE_TIMEOUT_MS, 10000);
}

export const DEFAULT_RENDER_TASK_MAX_RETRIES = 3;
export const DEFAULT_RENDER_TASK_STALE_HEARTBEAT_MS = 5 * 60_000;
/** Matches Aliyun FC render function `timeout: 28800` in s.prod.yaml / s.test.yaml. */
export const DEFAULT_RENDER_TASK_FC_TIMEOUT_MS = 28_800_000;
/** Abort in-process this long before FC hard-kills, so we can mark failed + callback. */
export const DEFAULT_RENDER_TASK_SOFT_TIMEOUT_BUFFER_MS = 120_000;
/** Query-side orphan sweep interval (heartbeat-stale / FC-timeout running tasks). */
export const DEFAULT_ORPHAN_RECONCILE_INTERVAL_MS = 60_000;

/**
 * FC HeaderField session-affinity header. Clients generate a UUID and send it on
 * create (becomes the task id) and on subsequent cancel/get/retry/run so FC routes
 * those requests to the same instance. Must not use the `x-fc-` prefix.
 * Keep in sync with `sessionAffinityConfig.affinityHeaderFieldName` in s.*.yaml.
 */
export const RENDER_TASK_AFFINITY_HEADER_NAME = "ainobi-render-task-id";

/** FC split deploy: `render` (exclusive instance) vs `query` (stateless). Local dev defaults to `all`. */
export type VideoRenderFunctionRole = "all" | "render" | "query";

export function resolveFunctionRole(): VideoRenderFunctionRole {
  const raw = process.env.AINOBI_VIDEO_RENDER_FUNCTION_ROLE?.trim().toLowerCase();
  if (raw === "render" || raw === "query") {
    return raw;
  }
  return "all";
}

export function isRenderFunctionRole(): boolean {
  const role = resolveFunctionRole();
  return role === "all" || role === "render";
}

export function isQueryFunctionRole(): boolean {
  const role = resolveFunctionRole();
  return role === "all" || role === "query";
}

/**
 * Base URL this process uses to call itself (FC HTTP trigger / custom domain, or
 * local listen address). Used to kick off `POST /render/tasks/:id/run`.
 * Prefer an explicit env on FC; otherwise fall back to the create request's host.
 */
export function resolveSelfBaseUrl(reqHostHint?: string | null): string {
  const explicit = process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  if (reqHostHint?.trim()) {
    return reqHostHint.trim().replace(/\/+$/, "");
  }
  const port = process.env.PORT?.trim() || "5633";
  return `http://127.0.0.1:${port}`;
}

/**
 * Render-function base URL for Async `POST /render/tasks/:id/run` self-invoke.
 * On the split FC deploy this must target the render function (session affinity),
 * not the query function.
 */
export function resolveRenderBaseUrl(reqHostHint?: string | null): string {
  const explicit =
    process.env.AINOBI_VIDEO_RENDER_RENDER_BASE_URL?.trim() ||
    process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  if (reqHostHint?.trim()) {
    return reqHostHint.trim().replace(/\/+$/, "");
  }
  const port = process.env.PORT?.trim() || "5633";
  return `http://127.0.0.1:${port}`;
}
/** Caps how many times a single task can be retried, so a permanently-broken render doesn't loop forever. */
export function resolveRenderTaskMaxRetries(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_TASK_MAX_RETRIES, DEFAULT_RENDER_TASK_MAX_RETRIES);
}

/** A `running` task whose heartbeat is older than this is assumed interrupted (its worker instance died). */
export function resolveRenderTaskStaleHeartbeatMs(): number {
  return parsePositiveInt(
    process.env.AINOBI_VIDEO_RENDER_STALE_HEARTBEAT_MS,
    DEFAULT_RENDER_TASK_STALE_HEARTBEAT_MS,
  );
}

/** Enable Hyperframes plan → fan-out renderChunk → assemble for long renders. Default on. */
export function resolveDistributedRenderEnabled(): boolean {
  return parseBoolean(process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_ENABLED, true);
}

/** Minimum total frames before a task fans out across FC chunk workers. */
export function resolveDistributedMinFrames(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_DISTRIBUTED_MIN_FRAMES, 3000);
}

/** Explicit frames per chunk (HF closed-GOP size). Default 900 ≈ 30s @30fps. */
export function resolveDistributedChunkSize(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_CHUNK_SIZE, 900);
}

/** Cap on parallel chunk FC instances per task. */
export function resolveDistributedMaxParallelChunks(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_MAX_PARALLEL_CHUNKS, 8);
}

/**
 * In-process Hyperframes workers inside each chunk instance.
 * Kept low to avoid blowing the 8GB FC memory envelope (6 workers previously hit ~7GB).
 */
export function resolveDistributedChunkWorkers(): number {
  return parsePositiveInt(process.env.AINOBI_VIDEO_RENDER_CHUNK_WORKERS, 2);
}

/**
 * Wall-clock budget for a single FC invoke (must stay ≤ the function's `timeout` in s.*.yaml).
 * Used for soft-timeout abort and for marking orphans as FC timeout failures.
 */
export function resolveRenderTaskFcTimeoutMs(): number {
  return parsePositiveInt(
    process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS,
    DEFAULT_RENDER_TASK_FC_TIMEOUT_MS,
  );
}

/** How far ahead of the FC hard kill we abort so status + callback can still be written. */
export function resolveRenderTaskSoftTimeoutBufferMs(): number {
  return parsePositiveInt(
    process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS,
    DEFAULT_RENDER_TASK_SOFT_TIMEOUT_BUFFER_MS,
  );
}

/**
 * In-process abort deadline: `fcTimeout - buffer`, floored at 1ms and always
 * strictly less than the FC timeout when both are positive.
 */
export function resolveRenderTaskSoftTimeoutMs(): number {
  const fcTimeoutMs = resolveRenderTaskFcTimeoutMs();
  const bufferMs = resolveRenderTaskSoftTimeoutBufferMs();
  return Math.max(1, fcTimeoutMs - Math.min(bufferMs, Math.max(0, fcTimeoutMs - 1)));
}

/** Query instances periodically sweep orphans left by killed render workers. */
export function resolveOrphanReconcileIntervalMs(): number {
  return parsePositiveInt(
    process.env.AINOBI_VIDEO_RENDER_ORPHAN_RECONCILE_INTERVAL_MS,
    DEFAULT_ORPHAN_RECONCILE_INTERVAL_MS,
  );
}

/** Stable error string so product mapping (`timeout` → render timeout) stays consistent. */
export function formatFcTimeoutErrorMessage(timeoutMs: number = resolveRenderTaskFcTimeoutMs()): string {
  const seconds = Math.max(1, Math.floor(timeoutMs / 1000));
  return `Function timed out after ${seconds} seconds`;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isBinaryOnPath(binary: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [binary], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export interface VideoRenderRuntimeCheck {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

let cachedRuntimeCheck: VideoRenderRuntimeCheck | null = null;

/**
 * Verify the native binaries Hyperframes shells out to (Chromium + ffmpeg/ffprobe)
 * are actually reachable. Errors are hard misconfigurations (an explicit path was
 * given but doesn't exist/isn't executable) — warnings mean we'll fall back to
 * auto-detection, which fails at render time on FC if the browser/ffmpeg layer
 * wasn't attached.
 *
 * Result is memoized for the process lifetime: binary paths/env don't change
 * while running, and this is called on the hot `/health` path where the
 * unconfigured fallback would otherwise spawn a synchronous `which` per hit.
 * Pass `{ force: true }` to re-evaluate (tests).
 */
export function checkVideoRenderRuntimeDependencies(
  options: { force?: boolean } = {},
): VideoRenderRuntimeCheck {
  if (cachedRuntimeCheck && !options.force) {
    return cachedRuntimeCheck;
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  const browserPath = resolveBrowserExecutablePath();
  if (browserPath) {
    if (!isExecutableFile(browserPath)) {
      errors.push(
        `Browser executable not found or not executable at "${browserPath}" (AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE / PRODUCER_HEADLESS_SHELL_PATH)`,
      );
    }
  } else {
    warnings.push(
      "No browser executable path configured (AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE); relying on Hyperframes' auto-detected/bundled Chromium — on Aliyun FC this requires a custom layer providing the browser binary.",
    );
  }

  const ffmpegPath = resolveFfmpegExecutablePath();
  if (ffmpegPath) {
    if (!isExecutableFile(ffmpegPath)) {
      errors.push(`ffmpeg not found or not executable at "${ffmpegPath}" (HYPERFRAMES_FFMPEG_PATH)`);
    }
  } else if (!isBinaryOnPath("ffmpeg")) {
    warnings.push(
      "HYPERFRAMES_FFMPEG_PATH not set and 'ffmpeg' not found on PATH; video encoding will fail. On Aliyun FC provide ffmpeg via a custom layer.",
    );
  }

  const ffprobePath = resolveFfprobeExecutablePath();
  if (ffprobePath) {
    if (!isExecutableFile(ffprobePath)) {
      errors.push(`ffprobe not found or not executable at "${ffprobePath}" (HYPERFRAMES_FFPROBE_PATH)`);
    }
  } else if (!isBinaryOnPath("ffprobe")) {
    warnings.push(
      "HYPERFRAMES_FFPROBE_PATH not set and 'ffprobe' not found on PATH; audio/duration probing will fail. On Aliyun FC provide ffprobe via a custom layer.",
    );
  }

  cachedRuntimeCheck = { ok: errors.length === 0, warnings, errors };
  return cachedRuntimeCheck;
}
