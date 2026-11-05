// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import type { Scene, SlideElement, TextElement } from "@ainobi/courseware-core";
import { collectSlidesWithNoMotionWarnings } from "./slide-motion-warnings.ts";

const textChild = (elementId: string, overrides: Partial<TextElement> = {}): TextElement => ({
  element_type: "text",
  element_id: elementId,
  name: elementId,
  html: "",
  text: "Hello",
  position: { x: 0, y: 0 },
  size: { width: 400, height: 80 },
  timeline: { start_at: 0, end_at: 5000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  keyframes: [],
  animations: [],
  event_bindings: [],
  fps: 30,
  metadata: {},
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  font_family: "Inter",
  font_size: 36,
  color: "#1E293B",
  align: "left",
  bold: false,
  italic: false,
  text_background_color: "transparent",
  enter_effect: "none",
  exit_effect: "none",
  ...overrides,
});

const slide = (elementId: string, name: string, children: TextElement[] = []): SlideElement => ({
  element_type: "slide",
  element_id: elementId,
  name,
  background_color: "#FFFFFF",
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  timeline: { start_at: 0, end_at: 10000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  keyframes: [],
  animations: [],
  event_bindings: [],
  fps: 30,
  metadata: {},
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  enter_effect: "none",
  exit_effect: "none",
  children_elements: children,
});

const minimalScene = (slides: SlideElement[]): Scene => ({
  scene_id: "sc_motion_test",
  name: "motion test",
  slide_elements: slides,
  vtuber_elements: [],
  audio_elements: [],
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
  transitions: [],
  preset_script: "",
  metadata: {},
});

test("collectSlidesWithNoMotionWarnings flags slides whose children are all static", () => {
  const scene = minimalScene([
    slide("el_slide_a", "Static", [textChild("el_text_a"), textChild("el_text_b")]),
    slide("el_slide_b", "Animated", [textChild("el_text_c", { enter_effect: "fade_in" })]),
  ]);

  const warnings = collectSlidesWithNoMotionWarnings(scene);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.path, "slide_elements[0].children_elements");
  assert.match(warnings[0]?.message ?? "", /Static/);
});

test("collectSlidesWithNoMotionWarnings ignores empty slides", () => {
  const scene = minimalScene([slide("el_slide_empty", "Empty", [])]);
  assert.equal(collectSlidesWithNoMotionWarnings(scene).length, 0);
});

test("collectSlidesWithNoMotionWarnings treats keyframes as motion", () => {
  const scene = minimalScene([
    slide("el_slide_kf", "KF", [
      textChild("el_text_kf", {
        keyframes: [
          {
            at: 0,
            position: { x: 0, y: 0 },
            size: { width: 400, height: 80 },
            rotation_deg: 0,
            opacity: 0,
            easing: "linear",
          },
          {
            at: 800,
            position: { x: 0, y: 0 },
            size: { width: 400, height: 80 },
            rotation_deg: 0,
            opacity: 1,
            easing: "linear",
          },
        ],
      }),
    ]),
  ]);

  assert.equal(collectSlidesWithNoMotionWarnings(scene).length, 0);
});
