// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { deserializeScene } from "@ainobi/courseware-core/scene.ts";
import { applyCoursewareApiTitleToScene } from "./courseware-access.ts";

function minimalScene(name: string) {
  return deserializeScene({
    audio_elements: [],
    scene_id: "sc_title",
    name,
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
    slide_elements: [],
    vtuber_elements: [],
  });
}

describe("applyCoursewareApiTitleToScene", () => {
  it("overwrites scene.name when API title differs", () => {
    const scene = minimalScene("旧名称");
    const next = applyCoursewareApiTitleToScene(scene, "管理端新名称");
    expect(next.name).toBe("管理端新名称");
  });

  it("is a no-op when names already match", () => {
    const scene = minimalScene("Same");
    expect(applyCoursewareApiTitleToScene(scene, "Same")).toBe(scene);
  });

  it("is a no-op when API title is empty", () => {
    const scene = minimalScene("Local");
    expect(applyCoursewareApiTitleToScene(scene, null)).toBe(scene);
    expect(applyCoursewareApiTitleToScene(scene, "   ")).toBe(scene);
  });
});
