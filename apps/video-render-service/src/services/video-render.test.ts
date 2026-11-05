// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { buildVideoRenderCoverObjectKey, buildVideoRenderObjectKey } from "./oss-upload.ts";
import { normalizePercent, videoRenderRequestSchema } from "./video-render.ts";

test("videoRenderRequestSchema validates render payload", () => {
  const parsed = videoRenderRequestSchema.parse({
    url: "https://example.com/animation.html",
    width: 1280,
    height: 720,
    duration: 5000,
    fps: 30,
    uploadToOss: false,
  });

  assert.equal(parsed.url, "https://example.com/animation.html");
  assert.equal(parsed.uploadToOss, false);
});

test("videoRenderRequestSchema rejects invalid url", () => {
  assert.throws(() => {
    videoRenderRequestSchema.parse({ url: "not-a-url" });
  });
});

test("normalizePercent handles both 0-1 fractions and 0-100 percentages", () => {
  assert.equal(normalizePercent(0.5), 50);
  assert.equal(normalizePercent(1), 100);
  assert.equal(normalizePercent(42), 42);
  assert.equal(normalizePercent(0), 0);
});

test("normalizePercent clamps out-of-range input", () => {
  assert.equal(normalizePercent(-5), 0);
  assert.equal(normalizePercent(150), 100);
});

test("buildVideoRenderObjectKey groups files by job id", () => {
  assert.equal(
    buildVideoRenderObjectKey("job-123", "/tmp/output/job-123.mp4"),
    "renders/job-123/job-123.mp4",
  );
});

test("buildVideoRenderCoverObjectKey stores cover beside the video", () => {
  assert.equal(buildVideoRenderCoverObjectKey("job-123"), "renders/job-123/cover.jpg");
});
