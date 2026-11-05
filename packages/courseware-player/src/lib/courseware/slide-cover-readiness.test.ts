// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import type { SlideElement, VtuberElement } from "@ainobi/courseware-core/elements.ts";
import {
  areCoverVtuberSnapshotsReady,
  listCoverVtuberSourceKeysAwaitingSnapshot,
} from "./slide-cover-readiness.ts";

const baseSlide = (): SlideElement => ({
  element_type: "slide",
  element_id: "el_slide_1",
  name: "Slide 1",
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  timeline: { start_at: 0, end_at: 10_000 },
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

const live2dVtuber = (): VtuberElement =>
  ({
    element_type: "vtuber",
    element_id: "el_vtuber_1",
    name: "Teacher",
    model_id: "",
    expression: "",
    motion: "",
    position: { x: 100, y: 100 },
    size: { width: 400, height: 600 },
    timeline: { start_at: 0, end_at: 10_000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 1 },
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: {
      model_url: "https://cdn.example/geekaca-teacher.model3.json",
    },
  }) as unknown as VtuberElement;

describe("slide-cover-readiness", () => {
  it("lists Live2D vtuber source keys visible at snapshot time", () => {
    const slide = { ...baseSlide(), children_elements: [live2dVtuber()] };
    const keys = listCoverVtuberSourceKeysAwaitingSnapshot(slide, 0);
    expect(keys).toEqual(["model:https://cdn.example/geekaca-teacher.model3.json"]);
  });

  it("reports ready when all required snapshots exist", () => {
    const slide = { ...baseSlide(), children_elements: [live2dVtuber()] };
    const key = "model:https://cdn.example/geekaca-teacher.model3.json";
    expect(areCoverVtuberSnapshotsReady(slide, {}, 0)).toBe(false);
    expect(areCoverVtuberSnapshotsReady(slide, { [key]: "data:image/png;base64,abc" }, 0)).toBe(
      true,
    );
  });

  it("skips Inochi vtuber models that do not use static snapshots", () => {
    const inochi = {
      ...live2dVtuber(),
      metadata: { model_url: "https://cdn.example/avatar.inx" },
    };
    const slide = { ...baseSlide(), children_elements: [inochi] };
    expect(listCoverVtuberSourceKeysAwaitingSnapshot(slide, 0)).toEqual([]);
    expect(areCoverVtuberSnapshotsReady(slide, {}, 0)).toBe(true);
  });
});
