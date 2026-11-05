// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import type { SlideElement, VtuberElement } from "@ainobi/courseware-core/elements.ts";
import { resolveSceneAiTeacherId } from "./resolve-scene-ai-teacher-id.ts";

function makeVtuber(id: string, teacherId: string): VtuberElement {
  return {
    element_type: "vtuber",
    element_id: id,
    name: "Teacher",
    html: "",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    timeline: { start_at: 0, end_at: 1000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 1 },
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: { ai_teacher_id: teacherId },
    model_id: teacherId,
    expression: "default",
    motion: "idle",
  };
}

function makeSlide(vtubers: VtuberElement[]): SlideElement {
  return {
    element_type: "slide",
    element_id: "slide-1",
    name: "Slide",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    timeline: { start_at: 0, end_at: 5000 },
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
    background_color: "#fff",
    background_image_url: "",
    children_elements: vtubers,
  };
}

describe("resolveSceneAiTeacherId", () => {
  it("prefers current slide vtuber over scene/global vtubers", () => {
    const slideTeacher = "11111111-1111-4111-8111-111111111111";
    const sceneTeacher = "22222222-2222-4222-8222-222222222222";
    const otherSlideTeacher = "33333333-3333-4333-8333-333333333333";
    const currentSlide = makeSlide([makeVtuber("v1", slideTeacher)]);
    const otherSlide = makeSlide([makeVtuber("v2", otherSlideTeacher)]);

    expect(
      resolveSceneAiTeacherId({
        currentSlide,
        sceneVtubers: [makeVtuber("v-scene", sceneTeacher)],
        allSlides: [currentSlide, otherSlide],
      }),
    ).toBe(slideTeacher);
  });

  it("falls back to scene vtuber then other slides", () => {
    const sceneTeacher = "22222222-2222-4222-8222-222222222222";
    const otherSlideTeacher = "33333333-3333-4333-8333-333333333333";
    const currentSlide = makeSlide([]);
    const otherSlide = makeSlide([makeVtuber("v2", otherSlideTeacher)]);

    expect(
      resolveSceneAiTeacherId({
        currentSlide,
        sceneVtubers: [makeVtuber("v-scene", sceneTeacher)],
        allSlides: [currentSlide, otherSlide],
      }),
    ).toBe(sceneTeacher);

    expect(
      resolveSceneAiTeacherId({
        currentSlide,
        sceneVtubers: [],
        allSlides: [currentSlide, otherSlide],
      }),
    ).toBe(otherSlideTeacher);
  });

  it("returns null when no vtuber has ai_teacher_id", () => {
    const slide = makeSlide([makeVtuber("v1", "")]);
    expect(
      resolveSceneAiTeacherId({
        currentSlide: slide,
        sceneVtubers: [],
        allSlides: [slide],
      }),
    ).toBeNull();
  });

  it("does not treat non-uuid model_id as ai_teacher_id", () => {
    const generic = makeVtuber("v1", "");
    generic.model_id = "geekaca-teacher";
    generic.metadata = {};
    const slide = makeSlide([generic]);
    expect(
      resolveSceneAiTeacherId({
        currentSlide: slide,
        sceneVtubers: [],
        allSlides: [slide],
      }),
    ).toBeNull();
  });

  it("falls back to uuid model_id when metadata ai_teacher_id is missing", () => {
    const teacherId = "11111111-1111-4111-8111-111111111111";
    const vtuber = makeVtuber("v1", "");
    vtuber.metadata = {};
    vtuber.model_id = teacherId;
    const slide = makeSlide([vtuber]);
    expect(
      resolveSceneAiTeacherId({
        currentSlide: slide,
        sceneVtubers: [],
        allSlides: [slide],
      }),
    ).toBe(teacherId);
  });
});
