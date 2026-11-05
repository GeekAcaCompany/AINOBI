// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  _mintCoursewareRenderTokenForTests,
  verifyCoursewareRenderToken,
} from "./courseware-render-token.ts";
import { batchPresignAccessStatus, loadCoursewareForBatchPresign } from "./courseware-assets-http.ts";

const COURSEWARE_ID = "5157de8a-a9a6-4949-989e-e3f53115b0e0";

function withRenderTokenSecret<T>(secret: string, fn: () => T): T {
  const previous = process.env.AINOBI_COURSEWARE_RENDER_TOKEN_SECRET;
  process.env.AINOBI_COURSEWARE_RENDER_TOKEN_SECRET = secret;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AINOBI_COURSEWARE_RENDER_TOKEN_SECRET;
    else process.env.AINOBI_COURSEWARE_RENDER_TOKEN_SECRET = previous;
  }
}

test("batchPresignAccessStatus maps render_token failures", () => {
  assert.equal(batchPresignAccessStatus(new Error("invalid or expired render_token")), 401);
  assert.equal(
    batchPresignAccessStatus(new Error("render_token is required when network is internal")),
    400,
  );
  assert.equal(batchPresignAccessStatus(new Error("courseware not found")), 404);
});

test("loadCoursewareForBatchPresign rejects internal network without render_token", async () => {
  await assert.rejects(
    () =>
      loadCoursewareForBatchPresign({} as import("node:http").IncomingMessage, COURSEWARE_ID, {
        network: "internal",
      }),
    /render_token is required when network is internal/,
  );
});

test("loadCoursewareForBatchPresign accepts valid render_token without session", async () => {
  await withRenderTokenSecret("batch-presign-test-secret", async () => {
    const token = _mintCoursewareRenderTokenForTests(
      COURSEWARE_ID,
      Math.floor(Date.now() / 1000) + 3600,
    );
    assert.equal(verifyCoursewareRenderToken(token, COURSEWARE_ID), true);

    // Integration: requires DB — skip when the courseware row is absent OR
    // the database itself is unreachable (CI runners have no Postgres; the
    // render-token acceptance above is the unit-testable part).
    try {
      const courseware = await loadCoursewareForBatchPresign(
        {} as import("node:http").IncomingMessage,
        COURSEWARE_ID,
        { renderToken: token, network: "internal" },
      );
      assert.equal(courseware.id, COURSEWARE_ID);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string })?.code;
      if (message.includes("not found")) return;
      // Environment-unavailable signatures: no Postgres (CI), no credentials
      // (dev shell without .env), or missing schema — the integration arm
      // cannot run there.
      const infraSignatures = [
        "ECONNREFUSED",
        "ENOTFOUND",
        "ETIMEDOUT",
        "SASL",
        "password authentication failed",
        "does not exist",
      ];
      if (
        (code && infraSignatures.includes(code)) ||
        infraSignatures.some((signature) => message.includes(signature))
      ) {
        return;
      }
      throw error;
    }
  });
});
