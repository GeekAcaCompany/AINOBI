// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeInlineSvgSource,
  collectSvgElementIssues,
  isInlineSvgSource,
} from "./svg-bounds.ts";

const el = (source: string, size = { width: 12, height: 12 }) => ({
  element_id: "el_svg_test",
  element_type: "svg",
  source,
  position: { x: 0, y: 0 },
  size,
  preserve_aspect_ratio: true,
});

const ctx = { path: "test", slideWidth: 1920, slideHeight: 1080 };

test("isInlineSvgSource detects markup", () => {
  assert.equal(isInlineSvgSource('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), true);
  assert.equal(isInlineSvgSource("https://example.com/a.svg"), false);
});

test("warns when viewBox is missing", () => {
  const issues = collectSvgElementIssues(
    el('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="6"/></svg>'),
    ctx,
  );
  assert.ok(issues.some((i) => i.message.includes("missing viewBox")));
});

test("warns when content exceeds viewBox", () => {
  const issues = collectSvgElementIssues(
    el(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><circle cx="6" cy="6" r="7"/></svg>',
      { width: 12, height: 12 },
    ),
    ctx,
  );
  assert.ok(issues.some((i) => i.message.includes("extends")));
});

test("warns on viewBox vs element size mismatch", () => {
  const issues = collectSvgElementIssues(
    el(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140"><circle cx="70" cy="70" r="60"/></svg>',
      { width: 700, height: 700 },
    ),
    ctx,
  );
  assert.ok(issues.some((i) => i.message.includes("does not match element size")));
});

test("no overflow warning when viewBox and geometry align", () => {
  const issues = collectSvgElementIssues(
    el(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 520"><circle cx="260" cy="260" r="210"/></svg>',
      { width: 520, height: 520 },
    ),
    ctx,
  );
  assert.equal(issues.filter((i) => i.message.includes("extends")).length, 0);
});

test("analyzeInlineSvgSource parses viewBox", () => {
  const a = analyzeInlineSvgSource(
    '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
  );
  assert.deepEqual(a.viewBox, { x: 0, y: 0, width: 100, height: 50 });
  assert.ok(a.contentBBox);
});
