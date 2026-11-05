// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSceneDiffReport,
  formatSceneDiffReportPage,
  summarizeSceneDiff,
} from "./scene-sync-diff.ts";

const sceneWithText = (x: number, y: number, fontSize: number) => ({
  scene_id: "sc_diff",
  name: "Test",
  slide_elements: [
    {
      element_id: "el_slide_1",
      element_type: "slide",
      name: "封面",
      timeline: { start_at: 0, end_at: 5000 },
      children_elements: [
        {
          element_id: "el_text_1",
          element_type: "text",
          name: "文本1",
          position: { x, y },
          size: { width: 1200, height: 100 },
          font_size: fontSize,
          text: "HelloWorld",
          align: "center",
          color: "#333333",
          timeline: { start_at: 0, end_at: 5000 },
          keyframes: [],
        },
      ],
    },
  ],
  vtuber_elements: [],
});

test("summarizeSceneDiff reports position and font_size via json patch", () => {
  const before = sceneWithText(360, 480, 72);
  const after = sceneWithText(120, 80, 144);
  const summary = summarizeSceneDiff(before, after);

  assert.match(summary, /position\.x: 360 → 120|position:.*360.*120/s);
  assert.match(summary, /font_size: 72 → 144/);
  assert.match(summary, /Slide 1 "封面"/);
  assert.match(summary, /el_text_1/);
  assert.match(summary, /inspect scene-sync --page 2|This is the last page/);
});

test("buildSceneDiffReport paginates many changes", () => {
  const before = sceneWithText(0, 0, 24);
  const children = Array.from({ length: 55 }, (_, i) => ({
    element_id: `el_${i}`,
    element_type: "text",
    name: `T${i}`,
    position: { x: i, y: i },
    size: { width: 100, height: 40 },
    font_size: 24,
    text: `line ${i}`,
  }));
  const after = {
    ...before,
    slide_elements: [
      {
        ...before.slide_elements[0],
        children_elements: children,
      },
    ],
  };

  const report = buildSceneDiffReport(before, after, { pageSize: 40 });
  assert.ok(report.total_changes >= 55);
  assert.equal(report.total_pages, Math.ceil(report.total_changes / 40));

  const page1 = formatSceneDiffReportPage(report, 1);
  const page2 = formatSceneDiffReportPage(report, 2);
  assert.match(page1, /page 1\/2/);
  assert.match(page1, /inspect scene-sync --page 2/);
  assert.match(page2, /page 2\/2/);
});

test("summarizeSceneDiff reports timeline changes", () => {
  const before = sceneWithText(0, 0, 24);
  const after = {
    ...before,
    slide_elements: [
      {
        ...before.slide_elements[0],
        timeline: { start_at: 0, end_at: 8000 },
      },
    ],
  };
  const summary = summarizeSceneDiff(before, after);
  assert.match(summary, /end_at: 5000 → 8000/);
});
