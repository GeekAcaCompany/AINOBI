// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAinobiCliHelpContextCache,
  getAinobiCliHelpContext,
} from "./ainobi-cli-help-context.ts";

test("help context pitfalls are English apart from data literals", () => {
  clearAinobiCliHelpContextCache();
  // Unresolvable PATH: help topics fail, but static pitfalls are still rendered.
  const ctx = getAinobiCliHelpContext({ cwd: process.cwd(), path: "/nonexistent-bin" });
  clearAinobiCliHelpContextCache();

  assert.match(ctx, /Common pitfalls/);
  // Instructional Chinese must be gone.
  assert.doesNotMatch(ctx, /题干配图/);
  assert.doesNotMatch(ctx, /占满幕布时长/);
  // CLI-assigned default element names are literal CLI output — kept as data.
  assert.match(ctx, /图片1, 文本2, 矩形3/);
});
