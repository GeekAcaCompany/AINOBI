// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";
import { Effects } from "./enums/effects.ts";
import {
  computeElementEnterExitEffectVisual,
  ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS,
  getEnterEffectCompletionTime,
  getElementEnterExitEffectTimelineBounds,
  resolveEnterExitEffectDurationsMs,
} from "./elements.ts";
import type { SlideElement, TextElement } from "./elements.ts";

const baseSlide = (): SlideElement =>
  ({
    element_type: "slide",
    element_id: "el_slide_test",
    name: "",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    timeline: { start_at: 0, end_at: 10_000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 0 },
    enter_effect: Effects.NONE,
    exit_effect: Effects.NONE,
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: {},
    background_color: "#000000",
    background_image_url: undefined,
    background_image_fit: "cover",
    children_elements: [],
  }) as SlideElement;

const textElement = (over: Partial<TextElement>): TextElement =>
  ({
    element_type: "text",
    element_id: "el_text_fx",
    name: "",
    html: "",
    fps: 30,
    position: { x: 100, y: 100 },
    size: { width: 400, height: 80 },
    timeline: { start_at: 1000, end_at: 9000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 1 },
    enter_effect: Effects.NONE,
    exit_effect: Effects.NONE,
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: {},
    text: "Hi",
    font_family: "sans-serif",
    font_size: 32,
    color: "#ffffff",
    align: "left",
    ...over,
  }) as TextElement;

test("resolveEnterExitEffectDurationsMs allocates up to default per side when span allows", () => {
  assert.deepEqual(
    resolveEnterExitEffectDurationsMs(10_000, Effects.FADE_IN, Effects.FADE_OUT),
    {
      enterMs: ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS,
      exitMs: ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS,
    },
  );
});

test("resolveEnterExitEffectDurationsMs splits span when both effects and span is short", () => {
  assert.deepEqual(resolveEnterExitEffectDurationsMs(400, Effects.FADE_IN, Effects.FADE_OUT), {
    enterMs: 200,
    exitMs: 200,
  });
});

test("computeElementEnterExitEffectVisual fade_in ramps opacity at timeline start", () => {
  const slide = baseSlide();
  const el = textElement({ enter_effect: Effects.FADE_IN, exit_effect: Effects.NONE });
  slide.children_elements = [el];
  const atStart = computeElementEnterExitEffectVisual(el, slide, el.timeline.start_at);
  assert.equal(atStart.opacityFactor, 0);
  const midEnter = computeElementEnterExitEffectVisual(
    el,
    slide,
    el.timeline.start_at + ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS / 2,
  );
  assert.ok(midEnter.opacityFactor > 0.2);
  assert.ok(midEnter.opacityFactor < 1);
  const afterEnter = computeElementEnterExitEffectVisual(
    el,
    slide,
    el.timeline.start_at + ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS + 50,
  );
  assert.equal(afterEnter.opacityFactor, 1);
});

test("computeElementEnterExitEffectVisual fade_out ramps opacity down near timeline end", () => {
  const slide = baseSlide();
  const el = textElement({ enter_effect: Effects.NONE, exit_effect: Effects.FADE_OUT });
  slide.children_elements = [el];
  const beforeExit = computeElementEnterExitEffectVisual(
    el,
    slide,
    el.timeline.end_at - ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS - 50,
  );
  assert.equal(beforeExit.opacityFactor, 1);
  const end = computeElementEnterExitEffectVisual(el, slide, el.timeline.end_at);
  assert.ok(end.opacityFactor <= 0.001);
});

test("computeElementEnterExitEffectVisual scale_in reduces uniformScale at start", () => {
  const slide = baseSlide();
  const el = textElement({ enter_effect: Effects.SCALE_IN, exit_effect: Effects.NONE });
  slide.children_elements = [el];
  const v = computeElementEnterExitEffectVisual(el, slide, el.timeline.start_at);
  assert.ok(v.uniformScale < 0.1);
  assert.equal(v.prefersInstantOpacity, true);
});

test("getEnterEffectCompletionTime matches timeline start when no enter effect", () => {
  const slide = baseSlide();
  const el = textElement({ enter_effect: Effects.NONE });
  slide.children_elements = [el];
  assert.equal(getEnterEffectCompletionTime(el, slide), el.timeline.start_at);
});

test("getEnterEffectCompletionTime is start + enter duration for fade_in", () => {
  const slide = baseSlide();
  const el = textElement({ enter_effect: Effects.FADE_IN });
  slide.children_elements = [el];
  assert.equal(
    getEnterEffectCompletionTime(el, slide),
    el.timeline.start_at + ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS,
  );
});

test("getElementEnterExitEffectTimelineBounds returns the element's own timeline", () => {
  const slide = baseSlide();
  const el = textElement({ timeline: { start_at: 500, end_at: 6000 } });
  slide.children_elements = [el];
  const b = getElementEnterExitEffectTimelineBounds(el, slide);
  assert.deepEqual(b, { start: 500, end: 6000 });
});
