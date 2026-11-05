// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  isCoursewareRendererUrl,
  withCoursewareRendererRenderParams,
} from "./courseware-renderer-prepare.ts";

test("isCoursewareRendererUrl detects renderer path", () => {
  assert.equal(
    isCoursewareRendererUrl("http://localhost:5173/courseware-renderer?courseware_id=abc"),
    true,
  );
  assert.equal(isCoursewareRendererUrl("http://localhost:5173/courseware-preview"), false);
});

test("withCoursewareRendererRenderParams sets Hyperframes render params", () => {
  const url = withCoursewareRendererRenderParams(
    "http://localhost:5173/courseware-renderer?courseware_id=abc&autoplay=1",
    { width: 1920, height: 1080 },
  );
  assert.match(url, /autoplay=0/);
  assert.match(url, /hf=1/);
  assert.match(url, /hf_width=1920/);
  assert.match(url, /hf_height=1080/);
  assert.doesNotMatch(url, /hf_duration_ms=/);
});

test("withCoursewareRendererRenderParams honors explicit duration override", () => {
  const url = withCoursewareRendererRenderParams(
    "http://localhost:5173/courseware-renderer?courseware_id=abc",
    { width: 1280, height: 720, durationMs: 15_000 },
  );
  assert.match(url, /hf_duration_ms=15000/);
});
