// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { pickCoursewareListOrgId } from "./courseware-service.ts";

test("pickCoursewareListOrgId returns the explicitly requested org", () => {
  assert.equal(pickCoursewareListOrgId("org-requested"), "org-requested");
  assert.equal(pickCoursewareListOrgId("  org-requested  "), "org-requested");
});

test("pickCoursewareListOrgId never falls back to session current org", () => {
  assert.throws(
    () => pickCoursewareListOrgId(undefined),
    /Organization context is required|current_org_id is not used/,
  );
  assert.throws(() => pickCoursewareListOrgId(""), /Organization context is required/);
  assert.throws(() => pickCoursewareListOrgId("   "), /Organization context is required/);
});
