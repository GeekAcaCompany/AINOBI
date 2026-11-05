// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import {
  fillElementInputGaps,
  normalizeElementInputRecord,
  resolveChildRefByIdOrName,
  resolveElementTypeAlias,
} from "./element-input-compat.ts";

test("resolveElementTypeAlias keeps rectangle as rectangle", () => {
  const result = resolveElementTypeAlias("rectangle");
  assert.equal(result.elementType, "rectangle");
  assert.equal(result.warnings.length, 0);
});

test("normalizeElementInputRecord hoists root start_at and duration into timeline", () => {
  const normalized = normalizeElementInputRecord({
    start_at: 100,
    duration: 900,
    enter_effect: "fadeIn",
  });
  assert.deepEqual(normalized.timeline, { start_at: 100, end_at: 1000 });
  assert.equal(normalized.enter_effect, "fade_in");
  assert.equal("start_at" in normalized, false);
  assert.equal("duration" in normalized, false);
});

test("fillElementInputGaps completes partial keyframes from the element transform", () => {
  const { record, fixes } = fillElementInputGaps({
    position: { x: 100, y: 200 },
    size: { width: 300, height: 80 },
    style: { opacity: 0.8, rotation_deg: 5, z_index: 1 },
    keyframes: [{ at: 0, opacity: 0 }, { at: 500, position: { x: 150 } }],
  });
  assert.deepEqual(record.keyframes, [
    { at: 0, opacity: 0, position: { x: 100, y: 200 }, size: { width: 300, height: 80 }, rotation_deg: 5, easing: "linear" },
    { at: 500, position: { x: 150, y: 200 }, size: { width: 300, height: 80 }, rotation_deg: 5, opacity: 0.8, easing: "linear" },
  ]);
  assert.match(fixes.join(";"), /keyframes missing easing, opacity, position, rotation_deg, size/);
});

test("fillElementInputGaps coerces numeric text and moves root width/height into size", () => {
  const { record, fixes } = fillElementInputGaps({ text: 25, width: 640, size: { width: 1, height: 90 } });
  assert.equal(record.text, "25");
  assert.deepEqual(record.size, { width: 640, height: 90 });
  assert.equal("width" in record, false);
  assert.equal(fixes.length, 2);
  assert.deepEqual(fillElementInputGaps({ text: "ok" }).fixes, []);
});

test("resolveChildRefByIdOrName: id first, then unique name; misses list the slide", () => {
  const children = [
    { element_id: "el_text_a", element_type: "text", name: "标题" },
    { element_id: "el_text_b", element_type: "text", name: "正文" },
    { element_id: "el_rect_c", element_type: "rectangle", name: "正文" },
  ];
  assert.equal(resolveChildRefByIdOrName(children, "el_text_b"), 1);
  assert.equal(resolveChildRefByIdOrName(children, "标题"), 0);
  assert.throws(() => resolveChildRefByIdOrName(children, "正文"), /ambiguous \(2 matches: indexes 1, 2\)/);
  assert.throws(
    () => resolveChildRefByIdOrName(children, "el_gone"),
    (error: unknown) =>
      error instanceof Error &&
      /element not found/.test(error.message) &&
      /0:el_text_a \(text\) "标题"/.test((error as { hint?: string }).hint ?? ""),
  );
});

test("fillElementInputGaps shifts element-relative keyframe/highlight times into the timeline", () => {
  const { record, fixes } = fillElementInputGaps({
    timeline: { start_at: 3000, end_at: 8000 },
    keyframes: [{ at: 0, opacity: 0 }, { at: 1000, opacity: 1 }],
    highlight_segments: [{ start_at: 500, end_at: 2000 }],
  });
  assert.deepEqual((record.keyframes as Array<{ at: number }>).map((k) => k.at), [3000, 4000]);
  assert.deepEqual(record.highlight_segments, [{ start_at: 3500, end_at: 5000 }]);
  assert.equal(fixes.filter((f) => /shifted by timeline.start_at=3000ms/.test(f)).length, 2);

  // Already absolute, or not fixable by a shift: left alone for validation.
  const absolute = fillElementInputGaps({ timeline: { start_at: 3000, end_at: 8000 }, keyframes: [{ at: 3000 }, { at: 7000 }] });
  assert.deepEqual((absolute.record.keyframes as Array<{ at: number }>).map((k) => k.at), [3000, 7000]);
  const hopeless = fillElementInputGaps({ timeline: { start_at: 3000, end_at: 4000 }, keyframes: [{ at: 0 }, { at: 9000 }] });
  assert.deepEqual((hopeless.record.keyframes as Array<{ at: number }>).map((k) => k.at), [0, 9000]);
});
