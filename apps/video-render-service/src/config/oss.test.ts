// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { buildOssObjectUrl, resolveOssClientConfig } from "./oss.ts";

test("resolveOssClientConfig reads bucket and region", () => {
  const previous = {
    region: process.env.OSS_REGION,
    endpoint: process.env.OSS_ENDPOINT,
    bucket: process.env.OSS_BUCKET,
  };

  process.env.OSS_REGION = "ap-northeast-1";
  process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1.aliyuncs.com";
  process.env.OSS_BUCKET = "example-video-render-output";

  try {
    const config = resolveOssClientConfig("example-video-render-output");
    assert.equal(config.region, "ap-northeast-1");
    assert.equal(config.bucket, "example-video-render-output");
    assert.equal(config.secure, true);
  } finally {
    process.env.OSS_REGION = previous.region;
    process.env.OSS_ENDPOINT = previous.endpoint;
    process.env.OSS_BUCKET = previous.bucket;
  }
});

test("resolveOssClientConfig enables intranet endpoint from env", () => {
  const previous = {
    internal: process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL,
    ossInternal: process.env.OSS_INTERNAL,
  };

  process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL = "true";
  delete process.env.OSS_INTERNAL;

  try {
    assert.equal(resolveOssClientConfig("example-video-render-output").internal, true);
  } finally {
    if (previous.internal === undefined) delete process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL;
    else process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL = previous.internal;
    if (previous.ossInternal === undefined) delete process.env.OSS_INTERNAL;
    else process.env.OSS_INTERNAL = previous.ossInternal;
  }
});

test("resolveOssClientConfig defaults intranet endpoint off", () => {
  const previous = {
    internal: process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL,
    ossInternal: process.env.OSS_INTERNAL,
  };

  delete process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL;
  delete process.env.OSS_INTERNAL;

  try {
    assert.equal(resolveOssClientConfig("example-video-render-output").internal, false);
  } finally {
    if (previous.internal !== undefined) process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL = previous.internal;
    if (previous.ossInternal !== undefined) process.env.OSS_INTERNAL = previous.ossInternal;
  }
});

test("buildOssObjectUrl uses public base when configured", () => {
  const config = resolveOssClientConfig("example-video-render-output");
  config.publicBaseUrl = "https://cdn.example.com";

  assert.equal(
    buildOssObjectUrl(config, "renders/job-1/output.mp4"),
    "https://cdn.example.com/renders/job-1/output.mp4",
  );
});

test("buildOssObjectUrl falls back to bucket endpoint", () => {
  const config = resolveOssClientConfig("example-video-render-output");
  config.publicBaseUrl = undefined;
  config.endpoint = "https://oss-ap-northeast-1.aliyuncs.com";

  assert.equal(
    buildOssObjectUrl(config, "renders/job-1/output.mp4"),
    "https://example-video-render-output.oss-ap-northeast-1.aliyuncs.com/renders/job-1/output.mp4",
  );
});
