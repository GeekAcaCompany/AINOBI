// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { collectElementLayoutIssues } from "./element-layout-warnings.ts";

const ctx = { path: "test", slideWidth: 1920, slideHeight: 1080 };

const el = (overrides: Partial<Parameters<typeof collectElementLayoutIssues>[0]> = {}) => ({
  element_id: "el_text_test",
  element_type: "text",
  position: { x: 960, y: 120 },
  size: { width: 1200, height: 140 },
  align: "center",
  ...overrides,
});

test("warns on 960 trap with center align and overflow", () => {
  const issues = collectElementLayoutIssues(el(), ctx);
  assert.ok(issues.some((i) => i.path.endsWith("position.x")));
  const trap = issues.find((i) => i.path.endsWith("position.x"));
  assert.ok(trap);
  assert.equal((trap!.value as { suggested_x?: number }).suggested_x, 360);
});

test("warns when box extends past slide canvas", () => {
  const issues = collectElementLayoutIssues(el(), ctx);
  assert.ok(issues.some((i) => i.message.includes("extends past the slide canvas")));
});

test("no center-line warning when position is correctly centered", () => {
  const issues = collectElementLayoutIssues(el({ position: { x: 360, y: 120 } }), ctx);
  assert.equal(issues.filter((i) => i.path.endsWith("position.x")).length, 0);
});
