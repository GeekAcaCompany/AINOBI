// SPDX-License-Identifier: AGPL-3.0-only
import {
  computeElementEnterExitEffectVisual,
  interpolateElementTransform,
  resolveEnterExitEffectDurationsMs,
  type Element,
  type SlideElement,
} from "@ainobi/courseware-core/elements.ts";
import { hasVisiblePixels } from "./element-visibility.ts";
import type { CliIssue } from "./errors.ts";

/**
 * Content collisions for `ainobi validate`: two content-bearing elements (text, quiz,
 * score summary, rich, inputs, buttons) whose on-screen boxes intersect at some moment
 * while both are visible. Unlike the raw `inspect overlaps` (every intersecting static
 * pair, including intended text-over-card and teacher-over-background), these are almost
 * always layout defects — an agent reported "no overlaps" off a clean `validate --publish`
 * while `inspect overlaps` showed exactly this kind of text/text collision.
 *
 * Boxes are computed like the renderer: keyframe interpolation, then the enter/exit effect
 * layer (translate / scale around the center / opacity factor). Rotation is ignored
 * (axis-aligned boxes). Only direct slide children are compared: the player does not
 * render `group` children.
 */

const CONTENT_TYPES = new Set(["text", "quiz", "quiz_score_summary", "rich", "textarea", "input", "button"]);
/** Ignore slivers from boxes that merely touch. */
const MIN_OVERLAP_PX = 4;
/**
 * Max slope of every curve that moves a box: keyframe easings peak at 2× linear, the
 * enter/exit effects (easeOutCubic / easeInCubic) at 3×.
 */
const CURVE_MAX_SLOPE = 3;
/** Hard cap per segment so a pathological scene cannot stall validate. */
const MAX_SAMPLES_PER_SEGMENT = 5000;

type SlideLike = { element_id: string; children_elements: Element[] };

type Collision = { at: number; width: number; height: number };

type RenderedBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  /** Keyframe-only box and effect parameters, for the per-segment motion bound. */
  kf: { x: number; y: number; width: number; height: number };
  scale: number;
  translateX: number;
  translateY: number;
};

const label = (element: Element): string => `"${element.name || element.element_type}" (${element.element_id})`;

/** Box and opacity the renderer draws at `at` (keyframes, then enter/exit effects). */
const renderedBox = (element: Element, slide: SlideLike, at: number): RenderedBox => {
  const t = interpolateElementTransform(element, at);
  const fx = computeElementEnterExitEffectVisual(element, slide as unknown as SlideElement, at);
  const scale = fx.uniformScale;
  return {
    x: t.position.x + (t.size.width * (1 - scale)) / 2 + fx.translateLogicalX,
    y: t.position.y + (t.size.height * (1 - scale)) / 2 + fx.translateLogicalY,
    width: t.size.width * scale,
    height: t.size.height * scale,
    opacity: t.opacity * fx.opacityFactor,
    kf: { x: t.position.x, y: t.position.y, width: t.size.width, height: t.size.height },
    scale,
    translateX: fx.translateLogicalX,
    translateY: fx.translateLogicalY,
  };
};

/** Times where an element's motion curve changes piece: keyframes and effect window edges. */
const motionAnchors = (element: Element): number[] => {
  const anchors = element.keyframes.map((frame) => frame.at);
  const { start_at: start, end_at: end } = element.timeline;
  const { enterMs, exitMs } = resolveEnterExitEffectDurationsMs(end - start, element.enter_effect, element.exit_effect);
  if (enterMs > 0) anchors.push(start, start + enterMs);
  if (exitMs > 0) anchors.push(end - exitMs, end);
  return anchors;
};

/** Upper bound on how far any edge of the rendered box moves between two monotone samples. */
const edgeTravelBound = (from: RenderedBox, to: RenderedBox): number => {
  const kfTravel =
    Math.max(Math.abs(to.kf.x - from.kf.x), Math.abs(to.kf.x + to.kf.width - from.kf.x - from.kf.width)) +
    Math.max(Math.abs(to.kf.y - from.kf.y), Math.abs(to.kf.y + to.kf.height - from.kf.y - from.kf.height));
  const maxDim = Math.max(from.kf.width, to.kf.width, from.kf.height, to.kf.height);
  const effectTravel =
    Math.abs(to.translateX - from.translateX) +
    Math.abs(to.translateY - from.translateY) +
    Math.abs(to.scale - from.scale) * maxDim;
  return kfTravel + effectTravel;
};

/**
 * Sample times in [start, end]. Anchors are both ends plus every keyframe and enter/exit
 * window edge of either element, so inside each segment every curve is monotone and moves
 * at ≤ CURVE_MAX_SLOPE × its average speed. Each segment is subdivided so relative edge
 * travel between samples stays below the smallest window in which the boxes overlap by
 * ≥ MIN_OVERLAP_PX — such an overlap cannot fall between two samples.
 */
const sampleTimes = (a: Element, b: Element, slide: SlideLike, start: number, end: number): number[] => {
  const anchors = new Set<number>([start, end]);
  for (const at of [...motionAnchors(a), ...motionAnchors(b)]) {
    if (at > start && at < end) anchors.add(at);
  }
  const sorted = [...anchors].sort((x, y) => x - y);
  const times: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const t0 = sorted[i]!;
    times.push(t0);
    const t1 = sorted[i + 1];
    if (t1 === undefined) continue;
    const a0 = renderedBox(a, slide, t0);
    const a1 = renderedBox(a, slide, t1);
    const b0 = renderedBox(b, slide, t0);
    const b1 = renderedBox(b, slide, t1);
    const travel = edgeTravelBound(a0, a1) + edgeTravelBound(b0, b1);
    if (travel === 0) continue;
    const minSpan = (key: "width" | "height") =>
      Math.min(a0[key], a1[key]) + Math.min(b0[key], b1[key]);
    // A box narrower than MIN_OVERLAP_PX cannot produce a reportable overlap anyway.
    const window = Math.max(MIN_OVERLAP_PX, Math.min(minSpan("width"), minSpan("height")) - 2 * MIN_OVERLAP_PX);
    const steps = Math.min(MAX_SAMPLES_PER_SEGMENT, Math.ceil((CURVE_MAX_SLOPE * travel) / window));
    for (let k = 1; k < steps; k += 1) times.push(t0 + ((t1 - t0) * k) / steps);
  }
  return times;
};

const largestCollision = (a: Element, b: Element, slide: SlideLike, start: number, end: number): Collision | null => {
  let best: Collision | null = null;
  for (const at of sampleTimes(a, b, slide, start, end)) {
    const ra = renderedBox(a, slide, at);
    const rb = renderedBox(b, slide, at);
    if (ra.opacity <= 0 || rb.opacity <= 0) continue;
    const width = Math.min(ra.x + ra.width, rb.x + rb.width) - Math.max(ra.x, rb.x);
    const height = Math.min(ra.y + ra.height, rb.y + rb.height) - Math.max(ra.y, rb.y);
    if (width < MIN_OVERLAP_PX || height < MIN_OVERLAP_PX) continue;
    if (!best || width * height > best.width * best.height) best = { at: Math.round(at), width, height };
  }
  return best;
};

export const collectContentOverlapWarnings = (slides: readonly SlideLike[]): CliIssue[] => {
  const warnings: CliIssue[] = [];
  slides.forEach((slide, slideIndex) => {
    const content = slide.children_elements.filter(
      (element) => CONTENT_TYPES.has(element.element_type) && hasVisiblePixels(element),
    );
    for (let i = 0; i < content.length; i += 1) {
      for (let j = i + 1; j < content.length; j += 1) {
        const a = content[i]!;
        const b = content[j]!;
        const start = Math.max(a.timeline.start_at, b.timeline.start_at);
        const end = Math.min(a.timeline.end_at, b.timeline.end_at);
        if (end <= start) continue; // never on screen together
        const hit = largestCollision(a, b, slide, start, end);
        if (!hit) continue;
        warnings.push({
          path: `slide_elements[${slideIndex}].children_elements`,
          message:
            `Content overlap: ${label(a)} and ${label(b)} intersect by ${Math.round(hit.width)}×${Math.round(hit.height)}px ` +
            `at ${hit.at}ms (both visible ${start}–${end}ms). Move or resize one of them.`,
          value: { a: a.element_id, b: b.element_id, at: hit.at, width: Math.round(hit.width), height: Math.round(hit.height) },
        });
      }
    }
  });
  return warnings;
};
