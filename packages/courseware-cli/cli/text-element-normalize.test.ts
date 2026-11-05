// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTextTypographyDriftWarnings,
  expandTextTypographySetEntries,
  normalizeTextElementRecord,
  normalizeTextElementsInScene,
  resolveEffectiveTextColor,
} from "./text-element-normalize.ts";
import { buildPatchFromSetEntries } from "./patch.ts";
import type { Scene, SlideElement, TextElement } from "@ainobi/courseware-core";

const textChild = (elementId: string, overrides: Record<string, unknown> = {}): TextElement => ({
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
  color: "#1E293B",
  align: "left",
  bold: false,
  italic: false,
  text_background_color: "transparent",
  enter_effect: "none",
  exit_effect: "none",
  ...overrides,
} as TextElement);

test("expandTextTypographySetEntries mirrors style.color onto root color", () => {
  const expanded = expandTextTypographySetEntries(["style.color=#FFFFFF", "position.x=10"]);
  assert.ok(expanded.includes("style.color=#FFFFFF"));
  assert.ok(expanded.includes("color=#FFFFFF"));
  const patch = buildPatchFromSetEntries(expanded);
  const { record } = normalizeTextElementRecord({
    element_type: "text",
    ...patch,
  });
  assert.equal(record.color, "#FFFFFF");
  assert.equal((record.style as Record<string, unknown>).color, undefined);
});

test("expandTextTypographySetEntries mirrors style.line_height onto root", () => {
  const expanded = expandTextTypographySetEntries(["style.line_height=1.5"]);
  assert.ok(expanded.includes("line_height=1.5"));
  const patch = buildPatchFromSetEntries(expanded);
  const { record } = normalizeTextElementRecord({
    element_type: "text",
    ...patch,
  });
  assert.equal(record.line_height, 1.5);
  assert.equal((record.style as Record<string, unknown>).line_height, undefined);
});

test("normalizeTextElementRecord promotes style typography to root fields", () => {
  const { record, promotions } = normalizeTextElementRecord({
    element_type: "text",
    color: "#1E293B",
    font_size: 36,
    style: {
      opacity: 1,
      rotation_deg: 0,
      z_index: 2,
      color: "#FFFFFF",
      font_size: 56,
      line_height: 1.45,
      font_weight: 700,
    },
  });
  assert.equal(record.color, "#FFFFFF");
  assert.equal(record.font_size, 56);
  assert.equal(record.line_height, 1.45);
  assert.equal(record.bold, true);
  assert.equal((record.style as Record<string, unknown>).z_index, 2);
  assert.equal((record.style as Record<string, unknown>).color, undefined);
  assert.ok(promotions.includes("style.color→color"));
});

test("resolveEffectiveTextColor prefers style.color when present", () => {
  const text = textChild("el_a", {
    color: "#1E293B",
    style: { opacity: 1, rotation_deg: 0, z_index: 0, color: "#FFFFFF" },
  });
  assert.equal(resolveEffectiveTextColor(text), "#FFFFFF");
});

test("collectTextTypographyDriftWarnings flags root vs style.color mismatch", () => {
  const scene: Scene = {
    scene_id: "sc_drift",
    name: "drift",
    slide_elements: [
      {
        element_type: "slide",
        element_id: "el_slide",
        name: "s",
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
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
        enter_effect: "none",
        exit_effect: "none",
        background_color: "#0b1420",
        children_elements: [
          textChild("el_text", {
            color: "#1E293B",
            style: { opacity: 1, rotation_deg: 0, z_index: 0, color: "#FFFFFF" },
          }),
        ],
      } as SlideElement,
    ],
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
  };

  assert.equal(collectTextTypographyDriftWarnings(scene).length, 1);
});

test("normalizeTextElementsInScene rewrites persisted text color", () => {
  const scene: Scene = {
    scene_id: "sc_norm",
    name: "norm",
    slide_elements: [
      {
        element_type: "slide",
        element_id: "el_slide",
        name: "s",
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
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
        enter_effect: "none",
        exit_effect: "none",
        background_color: "#0b1420",
        children_elements: [
          textChild("el_text", {
            color: "#1E293B",
            style: { opacity: 1, rotation_deg: 0, z_index: 0, color: "#FFFFFF" },
          }),
        ],
      } as SlideElement,
    ],
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
  };

  const { scene: normalized, warnings } = normalizeTextElementsInScene(scene);
  const child = normalized.slide_elements[0].children_elements[0] as TextElement;
  assert.equal(child.color, "#FFFFFF");
  assert.equal((child.style as unknown as Record<string, unknown>).color, undefined);
  assert.ok(warnings.length > 0);
  assert.equal(collectTextTypographyDriftWarnings(normalized).length, 0);
});
