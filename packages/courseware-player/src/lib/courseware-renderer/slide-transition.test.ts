// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Scene, SlideElement } from "../courseware/index.ts";
import {
  getHeadlessTransitionLayerStyle,
  resolveHeadlessSlideTransition,
  SLIDE_TRANSITION_MS,
} from "./slide-transition.ts";

const makeSlide = (id: string, durationMs: number): SlideElement =>
  ({
    element_id: id,
    element_type: "slide",
    name: id,
    timeline: { start_at: 0, end_at: durationMs },
    children_elements: [],
    background_color: "#000",
    background_image_url: "",
    metadata: {},
  }) as unknown as SlideElement;

const makeScene = (slides: SlideElement[], transitions: Scene["transitions"]): Scene =>
  ({
    scene_id: "scene_1",
    name: "Test",
    controller: {
      play: false,
      next: false,
      back: false,
      seekBar: false,
      time: false,
      slideNumber: false,
      volume: false,
      fullScreen: false,
      brand: false,
      playbackRate: false,
    },
    audio_elements: [],
    slide_elements: slides,
    transitions,
    preset_script: "",
    metadata: {},
    vtuber_elements: [],
  }) as Scene;

describe("resolveHeadlessSlideTransition", () => {
  const slides = [makeSlide("slide_a", 5000), makeSlide("slide_b", 5000)];
  const scene = makeScene(slides, ["fade"]);

  it("returns null on first slide", () => {
    expect(resolveHeadlessSlideTransition(scene, slides, 0, 100)).toBeNull();
  });

  it("returns null after transition window", () => {
    expect(resolveHeadlessSlideTransition(scene, slides, 1, SLIDE_TRANSITION_MS)).toBeNull();
  });

  it("returns transition state during first 450ms of target slide", () => {
    const resolved = resolveHeadlessSlideTransition(scene, slides, 1, 200);
    expect(resolved).toMatchObject({
      toSlideId: "slide_b",
      transition: "fade",
      direction: 1,
      seekProgress: 200 / SLIDE_TRANSITION_MS,
    });
    expect(resolved?.fromSlide.element_id).toBe("slide_a");
    expect(resolved?.fromTime).toBe(5000);
  });
});

describe("getHeadlessTransitionLayerStyle", () => {
  it("fades target slide in over progress", () => {
    expect(getHeadlessTransitionLayerStyle("fade", "to", 1, 0)).toEqual({ opacity: 0 });
    expect(getHeadlessTransitionLayerStyle("fade", "to", 1, 1).opacity).toBe(1);
    expect(getHeadlessTransitionLayerStyle("fade", "from", 1, 0.5)).toEqual({});
  });

  it("cross-fades both layers", () => {
    const from = getHeadlessTransitionLayerStyle("cross_fade", "from", 1, 0.5);
    const to = getHeadlessTransitionLayerStyle("cross_fade", "to", 1, 0.5);
    expect(from.opacity).toBeGreaterThan(0);
    expect(to.opacity).toBeGreaterThan(0);
    expect(Number(from.opacity ?? 0) + Number(to.opacity ?? 0)).toBeCloseTo(1, 1);
  });
});
