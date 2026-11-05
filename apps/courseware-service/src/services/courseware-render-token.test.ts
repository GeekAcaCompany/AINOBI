// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  _mintCoursewareRenderTokenForTests,
  mintCoursewareRenderToken,
  verifyCoursewareRenderToken,
} from "./courseware-render-token.ts";

const COURSEWARE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_COURSEWARE_ID = "22222222-2222-2222-2222-222222222222";

function withRenderTokenSecret<T>(secret: string, fn: () => T): T {
  const previous = process.env.AINOBI_RENDER_TOKEN_SECRET;
  process.env.AINOBI_RENDER_TOKEN_SECRET = secret;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AINOBI_RENDER_TOKEN_SECRET;
    else process.env.AINOBI_RENDER_TOKEN_SECRET = previous;
  }
}

test("mintCoursewareRenderToken/verifyCoursewareRenderToken round trip", () => {
  withRenderTokenSecret("test-secret", () => {
    const token = mintCoursewareRenderToken(COURSEWARE_ID, 3600);
    assert.equal(verifyCoursewareRenderToken(token, COURSEWARE_ID), true);
  });
});

test("verifyCoursewareRenderToken rejects a token minted for a different courseware", () => {
  withRenderTokenSecret("test-secret", () => {
    const token = mintCoursewareRenderToken(COURSEWARE_ID, 3600);
    assert.equal(verifyCoursewareRenderToken(token, OTHER_COURSEWARE_ID), false);
  });
});

test("verifyCoursewareRenderToken rejects an expired token", () => {
  withRenderTokenSecret("test-secret", () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 10;
    const token = _mintCoursewareRenderTokenForTests(COURSEWARE_ID, expiredAt);
    assert.equal(verifyCoursewareRenderToken(token, COURSEWARE_ID), false);
  });
});

test("verifyCoursewareRenderToken rejects a tampered signature", () => {
  withRenderTokenSecret("test-secret", () => {
    const token = mintCoursewareRenderToken(COURSEWARE_ID, 3600);
    const [expiresAt] = token.split(".");
    const tampered = `${expiresAt}.${"0".repeat(64)}`;
    assert.equal(verifyCoursewareRenderToken(tampered, COURSEWARE_ID), false);
  });
});

test("verifyCoursewareRenderToken rejects malformed tokens", () => {
  withRenderTokenSecret("test-secret", () => {
    assert.equal(verifyCoursewareRenderToken("", COURSEWARE_ID), false);
    assert.equal(verifyCoursewareRenderToken(null, COURSEWARE_ID), false);
    assert.equal(verifyCoursewareRenderToken("not-a-token", COURSEWARE_ID), false);
    assert.equal(verifyCoursewareRenderToken("123.", COURSEWARE_ID), false);
  });
});

test("mintCoursewareRenderToken produces different signatures for different secrets", () => {
  const tokenA = withRenderTokenSecret("secret-a", () => mintCoursewareRenderToken(COURSEWARE_ID, 3600));
  const verifiedUnderB = withRenderTokenSecret("secret-b", () =>
    verifyCoursewareRenderToken(tokenA, COURSEWARE_ID),
  );
  assert.equal(verifiedUnderB, false);
});
