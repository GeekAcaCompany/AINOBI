// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { deserializeScene, type Scene } from "@ainobi/courseware-core/scene.ts";
import { isCoursewareSceneEffectivelyEmpty } from "./scene-persist-guard.ts";

function minimalSlide(id = "el_slide_0"): Record<string, unknown> {
  return {
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    element_type: "slide",
    element_id: id,
    name: "slide",
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
    metadata: {},
    background_color: "#000",
    children_elements: [],
  };
}

function sceneWith(overrides: Record<string, unknown>): Scene {
  return deserializeScene({
    audio_elements: [],
    scene_id: "sc_guard",
    name: "test",
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
    slide_elements: [minimalSlide()],
    vtuber_elements: [],
    ...overrides,
  });
}

describe("isCoursewareSceneEffectivelyEmpty", () => {
  it("returns true when there are no slides", () => {
    expect(isCoursewareSceneEffectivelyEmpty(sceneWith({ slide_elements: [] }))).toBe(true);
  });

  it("returns true when slides exist but have no children or global tracks", () => {
    expect(isCoursewareSceneEffectivelyEmpty(sceneWith({}))).toBe(true);
  });

  it("returns false when any slide has a child element", () => {
    const scene = sceneWith({});
    scene.slide_elements[0].children_elements = [
      {
        element_type: "text",
        element_id: "el_text",
        name: "t",
        html: "",
        fps: 30,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 40 },
        timeline: { start_at: 0, end_at: 5000 },
        style: { opacity: 1, rotation_deg: 0, z_index: 1 },
        enter_effect: "none",
        exit_effect: "none",
        animations: [],
        keyframes: [],
        highlight_segments: [],
        event_bindings: [],
        action_mappings: {},
        event_scripts: {},
        preset_script: "",
        metadata: {},
        text: "hi",
        font_size: 24,
        font_family: "sans-serif",
        color: "#fff",
        align: "left",
        bold: false,
      },
    ];
    expect(isCoursewareSceneEffectivelyEmpty(scene)).toBe(false);
  });

  it("returns false when a slide only has a background image", () => {
    const scene = sceneWith({});
    scene.slide_elements[0].background_image_url =
      "https://courseware.example.com/raw/image/bg.png";
    expect(isCoursewareSceneEffectivelyEmpty(scene)).toBe(false);
  });

  it("returns false when a slide only has flow pause points", () => {
    const scene = sceneWith({});
    scene.slide_elements[0].flow_pause_points = [
      { pause_id: "fp_1", at_ms: 1200 },
    ];
    expect(isCoursewareSceneEffectivelyEmpty(scene)).toBe(false);
  });
});
