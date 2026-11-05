// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import type { SlideElement } from "@ainobi/courseware-core/elements.ts";
import {
  computeFirstSlideFingerprint,
  computeFirstSlideFingerprintFromScene,
  hasFirstSlideChanged,
  shouldRefreshCoursewareCover,
} from "./first-slide-fingerprint.ts";
import type { Scene } from "@ainobi/courseware-core/scene.ts";

const baseSlide = (): SlideElement => ({
  element_type: "slide",
  element_id: "el_slide_1",
  name: "Slide 1",
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  timeline: { start_at: 0, end_at: 10000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  enter_effect: "none",
  exit_effect: "none",
  animations: [],
  keyframes: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  metadata: {},
  background_color: "#ffffff",
  children_elements: [],
});

const baseScene = (slide: SlideElement): Scene => ({
  scene_id: "sc_1",
  name: "Scene",
  preset_script: "",
  metadata: {},
  controller: {
    play: true,
    next: true,
    back: true,
    seekBar: true,
    time: true,
    slideNumber: true,
    volume: true,
    fullScreen: true,
    brand: true,
    playbackRate: true,
  },
  slide_elements: [slide],
  audio_elements: [],
  vtuber_elements: [],
  quiz: null,
  transitions: [],
});

describe("first-slide-fingerprint", () => {
  it("detects background color changes", () => {
    const slideA = baseSlide();
    const slideB = { ...baseSlide(), background_color: "#000000" };
    const fpA = computeFirstSlideFingerprint(slideA);
    const fpB = computeFirstSlideFingerprint(slideB);
    expect(fpA).not.toBe(fpB);
    expect(hasFirstSlideChanged(baseScene(slideB), fpA)).toBe(true);
  });

  it("returns false when slide is unchanged", () => {
    const slide = baseSlide();
    const fp = computeFirstSlideFingerprintFromScene(baseScene(slide));
    expect(hasFirstSlideChanged(baseScene(slide), fp)).toBe(false);
  });

  it("treats missing previous fingerprint as changed", () => {
    expect(hasFirstSlideChanged(baseScene(baseSlide()), null)).toBe(true);
  });

  it("refreshes cover when server has no coverUrl even if slide unchanged", () => {
    const scene = baseScene(baseSlide());
    const fp = computeFirstSlideFingerprintFromScene(scene);
    expect(shouldRefreshCoursewareCover(scene, fp, null)).toBe(true);
    expect(shouldRefreshCoursewareCover(scene, fp, "https://cdn.example/cover.webp")).toBe(false);
  });
});
