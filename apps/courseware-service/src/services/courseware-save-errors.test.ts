// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  CoursewareKeyConflictError,
  CoursewareNotFoundError,
} from "./courseware-service.ts";

test("CoursewareNotFoundError maps to 404 and keeps the 'not found' marker", () => {
  const error = new CoursewareNotFoundError("cw-1");
  assert.equal(error.status, 404);
  // Sibling handlers (GET/versions/rollback) decide 404 with message.includes("not found"),
  // so changing the text would silently degrade them to 400/500
  assert.ok(error.message.includes("not found"), error.message);
  assert.ok(error instanceof Error);
});

test("CoursewareKeyConflictError maps to 409 and carries the offending key", () => {
  const error = new CoursewareKeyConflictError("key-1");
  assert.equal(error.status, 409);
  assert.equal(error.key, "key-1");
  // Must be distinguishable from the 404 branch, or concurrent row creation would be misjudged as "courseware not found"
  assert.ok(!error.message.includes("not found"), error.message);
});

test("CoursewareKeyConflictError keeps a custom message for the id-collision case", () => {
  const error = new CoursewareKeyConflictError("key-1", "collides with an existing courseware id");
  assert.equal(error.status, 409);
  assert.equal(error.key, "key-1");
  assert.match(error.message, /collides with an existing courseware id/);
});
