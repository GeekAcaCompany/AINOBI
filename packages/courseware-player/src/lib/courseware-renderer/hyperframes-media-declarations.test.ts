// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { NarrationElement, Scene, SlideElement } from "../courseware/index.ts";
import { collectHyperframesMediaDeclarations } from "./hyperframes-media-declarations.ts";

const baseNarration = (overrides?: Partial<NarrationElement>): NarrationElement => ({
  element_type: "narration",
  element_id: "narration_shared",
  name: "Narration",
  html: "",
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 100, height: 100 },
  timeline: { start_at: 0, end_at: 8000 },
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
  ai_teacher_id: "t1",
  ai_teacher_name: "",
  vtuber_element_id: "v1",
  script: "",
  transcript: "",
  subtitle_background_color: "#000",
  subtitle_background_opacity: 0.7,
  subtitle_background_transparent: false,
  subtitle_visible: true,
  segments: [
    {
      text: "第一句",
      audio_url: "https://cdn.example.com/a.mp3",
      duration_ms: 2000,
      gap_ms: 0,
    },
    {
      text: "第二句",
      audio_url: "https://cdn.example.com/b.mp3",
      duration_ms: 1500,
      gap_ms: 0,
    },
  ],
  ...overrides,
});

const makeSlide = (slideId: string, narration: NarrationElement): SlideElement => ({
  element_id: slideId,
  element_type: "slide",
  name: slideId,
  timeline: { start_at: 0, end_at: 5000 },
  children_elements: [narration],
  background_color: "#000",
  background_image_url: "",
  metadata: {},
} as SlideElement);

describe("collectHyperframesMediaDeclarations", () => {
  it("emits per-slide narration ids when narration element_id is reused across slides", () => {
    const narration = baseNarration();
    const scene = {
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
      slide_elements: [makeSlide("slide_a", narration), makeSlide("slide_b", narration)],
      transitions: [],
      vtuber_elements: [],
      preset_script: "",
      metadata: {},
    } as Scene;

    const { audios, diagnostics } = collectHyperframesMediaDeclarations(scene);
    const firstSegments = audios.filter((a) => a.id.endsWith("-0"));
    expect(firstSegments).toHaveLength(2);
    expect(firstSegments.map((a) => a.id).sort()).toEqual([
      "hf-narration-slide_a-narration_shared-0",
      "hf-narration-slide_b-narration_shared-0",
    ]);
    expect(firstSegments[0]?.startSec).toBe(0);
    expect(firstSegments[1]?.startSec).toBe(5);
    expect(diagnostics.narrationDeclaredCount).toBe(4);
    expect(diagnostics.skippedCount).toBe(0);
  });

  it("keeps later narration segments when measured duration extends the first segment", () => {
    const narration = baseNarration();
    const scene = {
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
      slide_elements: [makeSlide("slide_a", narration)],
      transitions: [],
      vtuber_elements: [],
      preset_script: "",
      metadata: {},
    } as Scene;

    const { audios, diagnostics } = collectHyperframesMediaDeclarations(scene, {
      "https://cdn.example.com/a.mp3": 6000,
    });
    const narrationTracks = audios.filter((a) => a.id.startsWith("hf-narration-slide_a-"));
    expect(narrationTracks).toHaveLength(2);
    expect(narrationTracks.map((a) => a.id)).toEqual([
      "hf-narration-slide_a-narration_shared-0",
      "hf-narration-slide_a-narration_shared-1",
    ]);
    expect(narrationTracks[1]?.startSec).toBe(6);
    expect(diagnostics.skippedCount).toBe(0);
  });

  it("records duplicate_id when narration element_id is reused on the same slide", () => {
    const narration = baseNarration();
    const scene = {
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
      slide_elements: [
        {
          ...makeSlide("slide_a", narration),
          children_elements: [narration, { ...narration, name: "copy" }],
        },
      ],
      transitions: [],
      vtuber_elements: [],
      preset_script: "",
      metadata: {},
    } as Scene;

    const { audios, diagnostics } = collectHyperframesMediaDeclarations(scene);
    expect(audios.filter((a) => a.id.startsWith("hf-narration-slide_a-"))).toHaveLength(2);
    expect(diagnostics.skipped.filter((s) => s.reason === "duplicate_id")).toHaveLength(2);
    expect(diagnostics.narrationRawSegmentCount).toBe(4);
    expect(diagnostics.narrationDeclaredCount).toBe(2);
  });
});
