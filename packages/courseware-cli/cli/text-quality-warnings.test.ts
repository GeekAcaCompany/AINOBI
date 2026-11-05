// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  collectTextElementQualityIssues,
  estimateTextLineCount,
  MIN_TEACHING_FONT_SIZE_PX,
} from "./text-quality-warnings.ts";

const textEl = (over: Partial<Parameters<typeof collectTextElementQualityIssues>[0]> = {}) => ({
  element_id: "el_1",
  element_type: "text",
  name: "t",
  text: "默认教学正文内容用于测试",
  font_size: 36,
  line_height: 1.2,
  size: { width: 1200, height: 200 },
  ...over,
});

test("warns when teaching text font_size is below the minimum", () => {
  const issues = collectTextElementQualityIssues(
    textEl({ font_size: 20, text: "这是一段较长的教学正文用于触发小字号告警" }),
    { path: "p" },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "p.font_size");
  assert.equal((issues[0].value as { recommended_min: number }).recommended_min, MIN_TEACHING_FONT_SIZE_PX);
});

test("does not warn about small fonts on short labels", () => {
  const issues = collectTextElementQualityIssues(
    textEl({ font_size: 20, text: "OK" }),
    { path: "p" },
  );
  assert.deepEqual(issues, []);
});

test("does not warn on large title fonts in a tall box", () => {
  const issues = collectTextElementQualityIssues(
    textEl({ font_size: 72, text: "标题", size: { width: 1200, height: 400 } }),
    { path: "p" },
  );
  assert.deepEqual(issues, []);
});

test("warns when text overflows a short box", () => {
  const issues = collectTextElementQualityIssues(
    textEl({ font_size: 40, text: "A".repeat(400), size: { width: 600, height: 60 } }),
    { path: "p" },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "p.size.height");
});

test("ignores non-text elements and empty text", () => {
  assert.deepEqual(
    collectTextElementQualityIssues(textEl({ element_type: "rectangle" }), { path: "p" }),
    [],
  );
  assert.deepEqual(collectTextElementQualityIssues(textEl({ text: "   " }), { path: "p" }), []);
});

test("estimateTextLineCount counts explicit newlines and wrapping", () => {
  assert.equal(estimateTextLineCount("a\nb\nc", 36, 1200), 3);
  // 40 wide CJK glyphs at 40px each = 1600px; box 800 → 2 lines.
  assert.equal(estimateTextLineCount("字".repeat(40), 40, 800), 2);
  assert.equal(estimateTextLineCount("", 36, 1200), 0);
});
