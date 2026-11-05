// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import type { Element } from "@ainobi/courseware-core/elements.ts";
import { collectContentOverlapWarnings } from "./content-overlap-warnings.ts";

const el = (
  id: string,
  type: string,
  x: number,
  y: number,
  w: number,
  h: number,
  start = 0,
  end = 10000,
  extra: { opacity?: number; keyframes?: unknown[]; enter?: string; exit?: string } = {},
): Element =>
  ({
    element_id: id,
    element_type: type,
    name: id,
    position: { x, y },
    size: { width: w, height: h },
    style: { opacity: extra.opacity ?? 1, rotation_deg: 0, z_index: 0 },
    keyframes: extra.keyframes ?? [],
    enter_effect: extra.enter ?? "none",
    exit_effect: extra.exit ?? "none",
    timeline: { start_at: start, end_at: end },
  }) as unknown as Element;

const kf = (at: number, x: number, y: number, w: number, h: number, opacity = 1) => ({
  at,
  position: { x, y },
  size: { width: w, height: h },
  rotation_deg: 0,
  opacity,
  easing: "linear",
});

const slide = (children: Element[]) => [{ element_id: "el_slide_1", children_elements: children }];

test("flags content elements that collide while both are visible", () => {
  const warnings = collectContentOverlapWarnings(
    slide([el("title", "text", 140, 158, 1200, 84), el("hint", "text", 1280, 230, 400, 40)]),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /"title" \(title\) and "hint" \(hint\) intersect by 60×12px/);
});

test("ignores intended layering, disjoint timelines and touching boxes", () => {
  assert.deepEqual(collectContentOverlapWarnings(slide([el("card", "rectangle", 100, 100, 500, 300), el("t", "text", 120, 120, 400, 60)])), []);
  assert.deepEqual(collectContentOverlapWarnings(slide([el("a", "text", 0, 0, 500, 100, 0, 3000), el("b", "text", 0, 0, 500, 100, 3000, 6000)])), []);
  assert.deepEqual(collectContentOverlapWarnings(slide([el("a", "text", 0, 0, 500, 100), el("b", "text", 0, 98, 500, 100)])), []);
  assert.deepEqual(collectContentOverlapWarnings(slide([el("q", "quiz", 0, 0, 500, 500), el("v", "vtuber", 100, 100, 300, 600)])), []);
});

test("keyframed elements are judged by their interpolated boxes, not the static base", () => {
  // Base boxes overlap, but keyframes keep the two apart for the whole playback.
  const apart = collectContentOverlapWarnings(
    slide([
      el("a", "text", 0, 0, 500, 100, 0, 10000, { keyframes: [kf(0, 0, 0, 500, 100), kf(10000, 0, 0, 500, 100)] }),
      el("b", "text", 0, 0, 500, 100, 0, 10000, { keyframes: [kf(0, 0, 600, 500, 100), kf(10000, 0, 600, 500, 100)] }),
    ]),
  );
  assert.deepEqual(apart, []);

  // Static boxes are disjoint, but "b" slides through "a" mid-segment (collision only around 5000ms).
  const passing = collectContentOverlapWarnings(
    slide([
      el("a", "text", 800, 0, 300, 100),
      el("b", "text", 0, 0, 300, 100, 0, 10000, { keyframes: [kf(0, 0, 0, 300, 100), kf(10000, 1600, 0, 300, 100)] }),
    ]),
  );
  assert.equal(passing.length, 1);
  // "b" (300px wide) overlaps "a" (x 800–1100) while b.x ∈ (500, 1100) → t ∈ (3125, 6875)ms.
  const at = (passing[0]!.value as { at: number }).at;
  assert.ok(at > 3125 && at < 6875, `collision time ${at}`);
});

test("never-visible elements (opacity 0 in style and every keyframe) are skipped", () => {
  const hidden = collectContentOverlapWarnings(
    slide([
      el("a", "text", 0, 0, 500, 100),
      el("ghost", "input", 0, 0, 500, 100, 0, 10000, { opacity: 0 }),
      el("ghost2", "text", 0, 0, 500, 100, 0, 10000, { opacity: 0, keyframes: [kf(0, 0, 0, 500, 100, 0), kf(5000, 0, 0, 500, 100, 0)] }),
    ]),
  );
  assert.deepEqual(hidden, []);
  // Fades in later: overlaps only once it becomes visible.
  const fading = collectContentOverlapWarnings(
    slide([
      el("a", "text", 0, 0, 500, 100),
      el("b", "text", 0, 0, 500, 100, 0, 10000, { opacity: 0, keyframes: [kf(0, 0, 0, 500, 100, 0), kf(4000, 0, 0, 500, 100, 1)] }),
    ]),
  );
  assert.equal(fading.length, 1);
});

test("a small box crossing another during a long segment is caught (adaptive sampling)", () => {
  // Review #147 example: 10px text moving 0→2000px over 10s crosses a 10px text at x=1100
  // for ~60ms; fixed interior samples (every 250px) never landed on it.
  const warnings = collectContentOverlapWarnings(
    slide([
      el("still", "text", 1100, 0, 10, 40),
      el("mover", "text", 0, 0, 10, 40, 0, 10000, { keyframes: [kf(0, 0, 0, 10, 40), kf(10000, 2000, 0, 10, 40)] }),
    ]),
  );
  assert.equal(warnings.length, 1);
  const at = (warnings[0]!.value as { at: number }).at;
  assert.ok(at > 5400 && at < 5600, `collision time ${at}`);

  // Same motion one row lower: never intersects, stays clean.
  assert.deepEqual(
    collectContentOverlapWarnings(
      slide([
        el("still", "text", 1100, 100, 10, 40),
        el("mover", "text", 0, 0, 10, 40, 0, 10000, { keyframes: [kf(0, 0, 0, 10, 40), kf(10000, 2000, 0, 10, 40)] }),
      ]),
    ),
    [],
  );
});

test("score-summary panels take part in the content-overlap check", () => {
  const warnings = collectContentOverlapWarnings(
    slide([el("summary", "quiz_score_summary", 100, 100, 800, 500), el("note", "text", 600, 500, 400, 60)]),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /"summary" \(summary\) and "note" \(note\)/);
});

test("enter/exit effects move the box: a translate_out that slides through another text is caught", () => {
  // "a" (1000×100 at y=0) exits with translate_out (moves down up to 200px while fading);
  // "b" sits at y=150. Static and keyframe boxes never meet, the rendered exit does.
  const warnings = collectContentOverlapWarnings(
    slide([el("a", "text", 0, 0, 1000, 100, 0, 10000, { exit: "translate_out" }), el("b", "text", 0, 150, 1000, 50)]),
  );
  assert.equal(warnings.length, 1);
  assert.ok((warnings[0]!.value as { at: number }).at > 9000);
  // Without the exit effect they never touch.
  assert.deepEqual(
    collectContentOverlapWarnings(slide([el("a", "text", 0, 0, 1000, 100), el("b", "text", 0, 150, 1000, 50)])),
    [],
  );
});

test("a 0-size base box that grows in through keyframes still takes part", () => {
  const warnings = collectContentOverlapWarnings(
    slide([
      el("still", "text", 0, 0, 500, 100),
      el("grow", "input", 0, 0, 0, 0, 0, 10000, { keyframes: [kf(0, 0, 0, 0, 0), kf(2000, 0, 0, 500, 100)] }),
    ]),
  );
  assert.equal(warnings.length, 1);
});
