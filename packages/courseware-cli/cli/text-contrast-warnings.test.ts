// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio, parseCssColor } from "@ainobi/courseware-core/css-color.ts";
import type { Scene, SlideElement, TextElement } from "@ainobi/courseware-core";
import {
  collectLowTextContrastWarnings,
  LOW_TEXT_CONTRAST_RATIO_THRESHOLD,
} from "./text-contrast-warnings.ts";

const textChild = (elementId: string, color: string, overrides: Partial<TextElement> = {}): TextElement => ({
  element_type: "text",
  element_id: elementId,
  name: elementId,
  html: "",
  text: "Sample",
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
  color,
  align: "left",
  bold: false,
  italic: false,
  text_background_color: "transparent",
  enter_effect: "none",
  exit_effect: "none",
  ...overrides,
});

const slide = (
  elementId: string,
  backgroundColor: string,
  children: TextElement[] = [],
): SlideElement => ({
  element_type: "slide",
  element_id: elementId,
  name: elementId,
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
  background_color: backgroundColor,
  children_elements: children,
});

const minimalScene = (slides: SlideElement[]): Scene => ({
  scene_id: "sc_contrast_test",
  name: "contrast test",
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

test("parseCssColor and contrastRatio detect near-identical dark colors", () => {
  const text = parseCssColor("#1E293B");
  const bg = parseCssColor("#0F172A");
  assert.ok(text && bg);
  const ratio = contrastRatio(text, bg);
  assert.ok(ratio < LOW_TEXT_CONTRAST_RATIO_THRESHOLD);
});

test("collectLowTextContrastWarnings flags low-contrast text on slide background", () => {
  const scene = minimalScene([
    slide("el_slide_low", "#0F172A", [textChild("el_text_low", "#1E293B")]),
    slide("el_slide_ok", "#0F172A", [textChild("el_text_ok", "#F8FAFC")]),
  ]);

  const warnings = collectLowTextContrastWarnings(scene);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]?.path ?? "", /el_text_low/);
  assert.match(warnings[0]?.message ?? "", /low contrast/i);
});

test("collectLowTextContrastWarnings composites rgba text over background", () => {
  const scene = minimalScene([
    slide("el_slide_rgba", "#0b1420", [
      textChild("el_text_rgba", "rgba(15, 23, 42, 0.9)"),
    ]),
  ]);

  const warnings = collectLowTextContrastWarnings(scene);
  assert.equal(warnings.length, 1);
});

test("collectLowTextContrastWarnings skips empty text", () => {
  const scene = minimalScene([
    slide("el_slide_empty", "#0F172A", [textChild("el_text_empty", "#1E293B", { text: "  " })]),
  ]);
  assert.equal(collectLowTextContrastWarnings(scene).length, 0);
});

test("collectLowTextContrastWarnings uses metadata.background_color for option-style rows", () => {
  const scene = minimalScene([
    slide("el_slide_quiz", "#FFFFFF", [
      textChild("el_text_option", "#E2E8F0", {
        metadata: { background_color: "#1E293B" },
      }),
    ]),
  ]);
  assert.equal(collectLowTextContrastWarnings(scene).length, 0);
});
