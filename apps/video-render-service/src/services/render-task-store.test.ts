// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { isRenderTaskDeletable, isRenderTaskRetryable } from "./render-task-store.ts";

test("isRenderTaskDeletable allows terminal statuses only", () => {
  assert.equal(isRenderTaskDeletable("completed"), true);
  assert.equal(isRenderTaskDeletable("failed"), true);
  assert.equal(isRenderTaskDeletable("interrupted"), true);
  assert.equal(isRenderTaskDeletable("cancelled"), true);
  assert.equal(isRenderTaskDeletable("queued"), false);
  assert.equal(isRenderTaskDeletable("running"), false);
});

test("isRenderTaskRetryable allows failed and interrupted", () => {
  assert.equal(isRenderTaskRetryable("failed"), true);
  assert.equal(isRenderTaskRetryable("interrupted"), true);
});

test("isRenderTaskRetryable rejects other statuses", () => {
  for (const status of ["queued", "running", "completed", "cancelled"] as const) {
    assert.equal(isRenderTaskRetryable(status), false);
  }
});
