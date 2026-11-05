// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { coursewareOrgIdFromEnv } from "./courseware-persistence-org.ts";

test("coursewareOrgIdFromEnv reads AINOBI_COURSEWARE_ORG_ID", () => {
  const prev = process.env.AINOBI_COURSEWARE_ORG_ID;
  process.env.AINOBI_COURSEWARE_ORG_ID = "  org-uuid  ";
  try {
    assert.equal(coursewareOrgIdFromEnv(), "org-uuid");
  } finally {
    if (prev === undefined) delete process.env.AINOBI_COURSEWARE_ORG_ID;
    else process.env.AINOBI_COURSEWARE_ORG_ID = prev;
  }
});
