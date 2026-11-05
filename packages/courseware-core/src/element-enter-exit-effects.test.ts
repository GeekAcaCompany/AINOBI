// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
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

describe("resolveEnterExitEffectDurationsMs", () => {
  it("allocates up to default per side when span allows", () => {
    expect(
      resolveEnterExitEffectDurationsMs(10_000, Effects.FADE_IN, Effects.FADE_OUT),
    ).toEqual({
      enterMs: ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS,
      exitMs: ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS,
    });
  });

  it("splits span when both effects and span is short", () => {
    expect(resolveEnterExitEffectDurationsMs(400, Effects.FADE_IN, Effects.FADE_OUT)).toEqual({
      enterMs: 200,
      exitMs: 200,
    });
  });
});

describe("computeElementEnterExitEffectVisual", () => {
  it("fade_in ramps opacity at timeline start", () => {
    const slide = baseSlide();
    const el = textElement({ enter_effect: Effects.FADE_IN, exit_effect: Effects.NONE });
    slide.children_elements = [el];
    const atStart = computeElementEnterExitEffectVisual(el, slide, el.timeline.start_at);
    expect(atStart.opacityFactor).toBe(0);
    const midEnter = computeElementEnterExitEffectVisual(
      el,
      slide,
      el.timeline.start_at + ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS / 2,
    );
    expect(midEnter.opacityFactor).toBeGreaterThan(0.2);
    expect(midEnter.opacityFactor).toBeLessThan(1);
    const afterEnter = computeElementEnterExitEffectVisual(
      el,
      slide,
      el.timeline.start_at + ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS + 50,
    );
    expect(afterEnter.opacityFactor).toBe(1);
  });

  it("fade_out ramps opacity down near timeline end", () => {
    const slide = baseSlide();
    const el = textElement({ enter_effect: Effects.NONE, exit_effect: Effects.FADE_OUT });
    slide.children_elements = [el];
    const beforeExit = computeElementEnterExitEffectVisual(
      el,
      slide,
      el.timeline.end_at - ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS - 50,
    );
    expect(beforeExit.opacityFactor).toBe(1);
    const end = computeElementEnterExitEffectVisual(el, slide, el.timeline.end_at);
    expect(end.opacityFactor).toBeLessThanOrEqual(0.001);
  });

  it("scale_in reduces uniformScale at start", () => {
    const slide = baseSlide();
    const el = textElement({ enter_effect: Effects.SCALE_IN, exit_effect: Effects.NONE });
    slide.children_elements = [el];
    const v = computeElementEnterExitEffectVisual(el, slide, el.timeline.start_at);
    expect(v.uniformScale).toBeLessThan(0.1);
    expect(v.prefersInstantOpacity).toBe(true);
  });
});

describe("getEnterEffectCompletionTime", () => {
  it("matches timeline start when no enter effect", () => {
    const slide = baseSlide();
    const el = textElement({ enter_effect: Effects.NONE });
    slide.children_elements = [el];
    expect(getEnterEffectCompletionTime(el, slide)).toBe(el.timeline.start_at);
  });

  it("is start + enter duration for fade_in", () => {
    const slide = baseSlide();
    const el = textElement({ enter_effect: Effects.FADE_IN });
    slide.children_elements = [el];
    expect(getEnterEffectCompletionTime(el, slide)).toBe(
      el.timeline.start_at + ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS,
    );
  });
});

describe("getElementEnterExitEffectTimelineBounds", () => {
  it("returns the element's own timeline by default", () => {
    const slide = baseSlide();
    const el = textElement({
      element_id: "el_text",
      timeline: { start_at: 1000, end_at: 9000 },
    });
    slide.children_elements = [el];
    const b = getElementEnterExitEffectTimelineBounds(el, slide);
    expect(b).toEqual({ start: 1000, end: 9000 });
  });
});
