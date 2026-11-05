// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  checkVideoRenderRuntimeDependencies,
  DEFAULT_ORPHAN_RECONCILE_INTERVAL_MS,
  DEFAULT_RENDER_TASK_FC_TIMEOUT_MS,
  DEFAULT_RENDER_TASK_MAX_RETRIES,
  DEFAULT_RENDER_TASK_SOFT_TIMEOUT_BUFFER_MS,
  DEFAULT_RENDER_TASK_STALE_HEARTBEAT_MS,
  formatFcTimeoutErrorMessage,
  isVideoRenderOssUploadEnabled,
  RENDER_TASK_AFFINITY_HEADER_NAME,
  resolveBrowserExecutablePath,
  resolveBrowserVersion,
  resolveFfmpegExecutablePath,
  resolveFfprobeExecutablePath,
  resolveOrphanReconcileIntervalMs,
  resolveOutputDir,
  resolveRenderTaskFcTimeoutMs,
  resolveRenderTaskMaxRetries,
  resolveRenderTaskSoftTimeoutBufferMs,
  resolveRenderTaskSoftTimeoutMs,
  resolveRenderTaskStaleHeartbeatMs,
  resolveRenderBaseUrl,
  resolveSelfBaseUrl,
  resolveVideoRenderOssBucket,
} from "./video-render.ts";

test("resolveOutputDir defaults to project output folder", () => {
  const previous = process.env.AINOBI_OUTPUT_DIR;
  delete process.env.AINOBI_OUTPUT_DIR;

  try {
    assert.match(resolveOutputDir(), /output$/);
  } finally {
    process.env.AINOBI_OUTPUT_DIR = previous;
  }
});

test("isVideoRenderOssUploadEnabled parses boolean env", () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_OSS_UPLOAD;

  process.env.AINOBI_VIDEO_RENDER_OSS_UPLOAD = "false";
  assert.equal(isVideoRenderOssUploadEnabled(), false);

  process.env.AINOBI_VIDEO_RENDER_OSS_UPLOAD = "true";
  assert.equal(isVideoRenderOssUploadEnabled(), true);

  process.env.AINOBI_VIDEO_RENDER_OSS_UPLOAD = previous;
});

test("resolveVideoRenderOssBucket prefers dedicated env", () => {
  const previous = {
    dedicated: process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET,
    shared: process.env.OSS_BUCKET,
    backend: process.env.STORAGE_BACKEND,
    ociBucket: process.env.OCI_S3_BUCKET,
  };

  process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET = "example-video-render-output";
  process.env.OSS_BUCKET = "other-bucket";

  try {
    assert.equal(resolveVideoRenderOssBucket(), "example-video-render-output");
  } finally {
    process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET = previous.dedicated;
    process.env.OSS_BUCKET = previous.shared;
    if (previous.backend === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = previous.backend;
    if (previous.ociBucket === undefined) delete process.env.OCI_S3_BUCKET;
    else process.env.OCI_S3_BUCKET = previous.ociBucket;
  }
});

test("resolveVideoRenderOssBucket switches to the OCI bucket under STORAGE_BACKEND=oci_s3", () => {
  const previous = {
    dedicated: process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET,
    shared: process.env.OSS_BUCKET,
    backend: process.env.STORAGE_BACKEND,
    ociBucket: process.env.OCI_S3_BUCKET,
  };

  // Grayscale payload may still carry the aliyun-only bucket envs — under
  // oci_s3 the OCI bucket must win (the OCI client cannot write to the old one).
  process.env.STORAGE_BACKEND = "oci_s3";
  process.env.OCI_S3_BUCKET = "example-storage";
  process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET = "example-video-render-output";
  process.env.OSS_BUCKET = "other-bucket";

  try {
    assert.equal(resolveVideoRenderOssBucket(), "example-storage");
    // Non-oci_s3 values never switch.
    process.env.STORAGE_BACKEND = "aliyun_oss";
    assert.equal(resolveVideoRenderOssBucket(), "example-video-render-output");
    // OCI bucket falls through to the aliyun envs when unset.
    delete process.env.OCI_S3_BUCKET;
    process.env.STORAGE_BACKEND = "oci_s3";
    assert.equal(resolveVideoRenderOssBucket(), "example-video-render-output");
  } finally {
    if (previous.backend === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = previous.backend;
    if (previous.ociBucket === undefined) delete process.env.OCI_S3_BUCKET;
    else process.env.OCI_S3_BUCKET = previous.ociBucket;
    process.env.AINOBI_VIDEO_RENDER_OSS_BUCKET = previous.dedicated;
    process.env.OSS_BUCKET = previous.shared;
  }
});

test("resolveBrowserExecutablePath honors explicit env", () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE;
  process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE = "/custom/chrome";

  try {
    assert.equal(resolveBrowserExecutablePath(), "/custom/chrome");
  } finally {
    process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE = previous;
  }
});

test("resolveBrowserVersion honors explicit env", () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_BROWSER_VERSION;
  process.env.AINOBI_VIDEO_RENDER_BROWSER_VERSION = "131.0.6778.204";

  try {
    assert.equal(resolveBrowserVersion(), "131.0.6778.204");
  } finally {
    process.env.AINOBI_VIDEO_RENDER_BROWSER_VERSION = previous;
  }
});

test("resolveBrowserExecutablePath falls back to PRODUCER_HEADLESS_SHELL_PATH", () => {
  const previous = {
    dedicated: process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE,
    producer: process.env.PRODUCER_HEADLESS_SHELL_PATH,
  };
  delete process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE;
  process.env.PRODUCER_HEADLESS_SHELL_PATH = "/opt/chrome-headless-shell/chrome-headless-shell";

  try {
    assert.equal(
      resolveBrowserExecutablePath(),
      "/opt/chrome-headless-shell/chrome-headless-shell",
    );
  } finally {
    process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE = previous.dedicated;
    process.env.PRODUCER_HEADLESS_SHELL_PATH = previous.producer;
  }
});

test("resolveFfmpegExecutablePath / resolveFfprobeExecutablePath honor explicit env", () => {
  const previous = {
    ffmpeg: process.env.HYPERFRAMES_FFMPEG_PATH,
    ffprobe: process.env.HYPERFRAMES_FFPROBE_PATH,
  };
  process.env.HYPERFRAMES_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
  process.env.HYPERFRAMES_FFPROBE_PATH = "/opt/ffmpeg/ffprobe";

  try {
    assert.equal(resolveFfmpegExecutablePath(), "/opt/ffmpeg/ffmpeg");
    assert.equal(resolveFfprobeExecutablePath(), "/opt/ffmpeg/ffprobe");
  } finally {
    process.env.HYPERFRAMES_FFMPEG_PATH = previous.ffmpeg;
    process.env.HYPERFRAMES_FFPROBE_PATH = previous.ffprobe;
  }
});

test("RENDER_TASK_AFFINITY_HEADER_NAME is a valid FC HeaderField name", () => {
  assert.match(RENDER_TASK_AFFINITY_HEADER_NAME, /^[A-Za-z][A-Za-z0-9_-]{4,39}$/);
  assert.equal(RENDER_TASK_AFFINITY_HEADER_NAME.toLowerCase().startsWith("x-fc-"), false);
});

test("resolveSelfBaseUrl prefers explicit env then host hint", () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL;
  try {
    process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL = "https://render.example.com/";
    assert.equal(resolveSelfBaseUrl("http://ignored"), "https://render.example.com");

    delete process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL;
    assert.equal(resolveSelfBaseUrl("https://from-request.example.com"), "https://from-request.example.com");
  } finally {
    if (previous === undefined) delete process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL;
    else process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL = previous;
  }
});

test("resolveRenderBaseUrl prefers render-specific env over self base url", () => {
  const previous = {
    render: process.env.AINOBI_VIDEO_RENDER_RENDER_BASE_URL,
    self: process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL,
  };
  try {
    process.env.AINOBI_VIDEO_RENDER_RENDER_BASE_URL = "https://render-fn.example.com/";
    process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL = "https://query-fn.example.com/";
    assert.equal(resolveRenderBaseUrl("http://ignored"), "https://render-fn.example.com");

    delete process.env.AINOBI_VIDEO_RENDER_RENDER_BASE_URL;
    assert.equal(resolveRenderBaseUrl("http://ignored"), "https://query-fn.example.com");
  } finally {
    if (previous.render === undefined) delete process.env.AINOBI_VIDEO_RENDER_RENDER_BASE_URL;
    else process.env.AINOBI_VIDEO_RENDER_RENDER_BASE_URL = previous.render;
    if (previous.self === undefined) delete process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL;
    else process.env.AINOBI_VIDEO_RENDER_SELF_BASE_URL = previous.self;
  }
});

test("resolveRenderTaskMaxRetries honors env and falls back to default", () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_TASK_MAX_RETRIES;
  try {
    delete process.env.AINOBI_VIDEO_RENDER_TASK_MAX_RETRIES;
    assert.equal(resolveRenderTaskMaxRetries(), DEFAULT_RENDER_TASK_MAX_RETRIES);

    process.env.AINOBI_VIDEO_RENDER_TASK_MAX_RETRIES = "1";
    assert.equal(resolveRenderTaskMaxRetries(), 1);
  } finally {
    if (previous === undefined) delete process.env.AINOBI_VIDEO_RENDER_TASK_MAX_RETRIES;
    else process.env.AINOBI_VIDEO_RENDER_TASK_MAX_RETRIES = previous;
  }
});

test("resolveRenderTaskStaleHeartbeatMs honors env and falls back to default", () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_STALE_HEARTBEAT_MS;
  try {
    delete process.env.AINOBI_VIDEO_RENDER_STALE_HEARTBEAT_MS;
    assert.equal(resolveRenderTaskStaleHeartbeatMs(), DEFAULT_RENDER_TASK_STALE_HEARTBEAT_MS);

    process.env.AINOBI_VIDEO_RENDER_STALE_HEARTBEAT_MS = "60000";
    assert.equal(resolveRenderTaskStaleHeartbeatMs(), 60000);
  } finally {
    if (previous === undefined) delete process.env.AINOBI_VIDEO_RENDER_STALE_HEARTBEAT_MS;
    else process.env.AINOBI_VIDEO_RENDER_STALE_HEARTBEAT_MS = previous;
  }
});

test("resolveRenderTaskFcTimeoutMs / soft timeout defaults match FC 28800s budget", () => {
  const previous = {
    fc: process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS,
    buffer: process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS,
    interval: process.env.AINOBI_VIDEO_RENDER_ORPHAN_RECONCILE_INTERVAL_MS,
  };
  try {
    delete process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS;
    delete process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS;
    delete process.env.AINOBI_VIDEO_RENDER_ORPHAN_RECONCILE_INTERVAL_MS;

    assert.equal(resolveRenderTaskFcTimeoutMs(), DEFAULT_RENDER_TASK_FC_TIMEOUT_MS);
    assert.equal(resolveRenderTaskSoftTimeoutBufferMs(), DEFAULT_RENDER_TASK_SOFT_TIMEOUT_BUFFER_MS);
    assert.equal(
      resolveRenderTaskSoftTimeoutMs(),
      DEFAULT_RENDER_TASK_FC_TIMEOUT_MS - DEFAULT_RENDER_TASK_SOFT_TIMEOUT_BUFFER_MS,
    );
    assert.equal(resolveOrphanReconcileIntervalMs(), DEFAULT_ORPHAN_RECONCILE_INTERVAL_MS);
    assert.equal(formatFcTimeoutErrorMessage(), "Function timed out after 28800 seconds");
  } finally {
    if (previous.fc === undefined) delete process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS;
    else process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS = previous.fc;
    if (previous.buffer === undefined) delete process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS;
    else process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS = previous.buffer;
    if (previous.interval === undefined) delete process.env.AINOBI_VIDEO_RENDER_ORPHAN_RECONCILE_INTERVAL_MS;
    else process.env.AINOBI_VIDEO_RENDER_ORPHAN_RECONCILE_INTERVAL_MS = previous.interval;
  }
});

test("checkVideoRenderRuntimeDependencies errors on a configured-but-missing browser path", () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE;
  process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE = "/nonexistent/chrome-headless-shell";

  try {
    const result = checkVideoRenderRuntimeDependencies({ force: true });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("/nonexistent/chrome-headless-shell")));
  } finally {
    process.env.AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE = previous;
    // Drop the cached (intentionally-broken) result so other tests/consumers re-evaluate.
    checkVideoRenderRuntimeDependencies({ force: true });
  }
});
