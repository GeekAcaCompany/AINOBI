// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  deserializeElement,
  serializeElement,
  UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID,
  type NarrationElement,
  type SlideElement,
} from "./elements.ts";

const baseNarration = (): NarrationElement => ({
  element_type: "narration",
  element_id: "el_narration_test",
  name: "讲解",
  html: "",
  fps: 30,
  position: { x: 0, y: 940 },
  size: { width: 1800, height: 100 },
  timeline: { start_at: 0, end_at: 5000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 1 },
  enter_effect: "none",
  exit_effect: "none",
  animations: [],
  keyframes: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  metadata: {},
  ai_teacher_id: "",
  ai_teacher_name: "",
  vtuber_element_id: "",
  script: "",
  transcript: "",
  segments: [],
  subtitle_background_color: "#020617",
  subtitle_background_opacity: 0.7,
  subtitle_background_transparent: false,
  subtitle_visible: true,
});

describe("serializeElement narration ai_teacher_id", () => {
  it("fills missing ai_teacher_id before validation", () => {
    const serialized = serializeElement(baseNarration());
    const deserialized = deserializeElement(serialized) as NarrationElement;
    expect(deserialized.ai_teacher_id).toBe(UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID);
  });

  it("deserializes a narration record without the ai_teacher_id field", () => {
    const raw: Record<string, unknown> = { ...serializeElement(baseNarration()) };
    delete raw.ai_teacher_id;
    const parsed = deserializeElement(raw) as NarrationElement;
    expect(parsed.ai_teacher_id).toBe(UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID);
  });

  it("fills narration when only metadata has teacher id", () => {
    const narration = {
      ...baseNarration(),
      ai_teacher_id: "",
      metadata: { ai_teacher_id: "teacher-from-meta" },
    };
    const serialized = serializeElement(narration);
    const deserialized = deserializeElement(serialized) as NarrationElement;
    expect(deserialized.ai_teacher_id).toBe("teacher-from-meta");
  });

  it("fills nested narration inside slide children", () => {
    const slide: SlideElement = {
      element_type: "slide",
      element_id: "slide_test",
      name: "Slide",
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
      background_color: "#000000",
      background_image_url: "",
      background_image_fit: "cover",
      children_elements: [baseNarration()],
    };
    expect(() => serializeElement(slide)).not.toThrow();
    const serialized = serializeElement(slide) as SlideElement;
    const child = serialized.children_elements[0] as NarrationElement;
    expect(child.ai_teacher_id).toBe(UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID);
  });
});
