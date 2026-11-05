// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCoursewareVersionNotStale,
  CoursewareVersionConflictError,
} from "./courseware-service.ts";

test("assertCoursewareVersionNotStale allows save when server is not newer than base", () => {
  const cw = { updatedAt: new Date("2026-05-20T10:00:00.000Z") };
  assert.doesNotThrow(() =>
    assertCoursewareVersionNotStale(cw, "2026-05-20T10:00:00.000Z"),
  );
  assert.doesNotThrow(() =>
    assertCoursewareVersionNotStale(cw, "2026-05-20T11:00:00.000Z"),
  );
});

test("assertCoursewareVersionNotStale rejects when server updated_at is newer than base", () => {
  const cw = { updatedAt: new Date("2026-05-20T12:00:00.000Z") };
  assert.throws(
    () => assertCoursewareVersionNotStale(cw, "2026-05-20T10:00:00.000Z"),
    CoursewareVersionConflictError,
  );
});

test("assertCoursewareVersionNotStale rejects invalid baseUpdatedAt", () => {
  const cw = { updatedAt: new Date("2026-05-20T12:00:00.000Z") };
  assert.throws(() => assertCoursewareVersionNotStale(cw, "not-a-date"), /invalid baseUpdatedAt/);
});
