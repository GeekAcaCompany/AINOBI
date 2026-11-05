// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { createRenderTaskSchema } from "./render-tasks.ts";

test("createRenderTaskSchema accepts an optional callbackUrl", () => {
  const parsed = createRenderTaskSchema.parse({
    url: "https://example.com/render-target",
    coursewareId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    callbackUrl: "https://agent.example.com/courseware/render/callback",
  });
  assert.equal(parsed.callbackUrl, "https://agent.example.com/courseware/render/callback");
});

test("createRenderTaskSchema works without a callbackUrl", () => {
  const parsed = createRenderTaskSchema.parse({ url: "https://example.com/render-target" });
  assert.equal(parsed.callbackUrl, undefined);
});

test("createRenderTaskSchema rejects a malformed callbackUrl", () => {
  assert.throws(() => {
    createRenderTaskSchema.parse({ url: "https://example.com/render-target", callbackUrl: "not-a-url" });
  });
});
