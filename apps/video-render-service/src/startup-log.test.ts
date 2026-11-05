// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { redactSensitiveRenderUrl } from "./startup-log.ts";

test("redactSensitiveRenderUrl masks render_token query param", () => {
  const redacted = redactSensitiveRenderUrl(
    "http://localhost:5173/courseware-renderer?courseware_id=cw-1&render_token=secret&hf=1",
  );
  const url = new URL(redacted);
  assert.equal(url.searchParams.get("render_token"), "[redacted]");
  assert.equal(url.searchParams.get("courseware_id"), "cw-1");
  assert.equal(url.searchParams.get("hf"), "1");
});

test("redactSensitiveRenderUrl leaves URLs without render_token unchanged", () => {
  const input = "http://example.com/page?foo=bar";
  assert.equal(redactSensitiveRenderUrl(input), input);
});
