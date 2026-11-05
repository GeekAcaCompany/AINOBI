// SPDX-License-Identifier: AGPL-3.0-only
import { deserializeScene, serializeScene } from "@ainobi/courseware-core/scene.ts";
import { SLIDE_LOGICAL_HEIGHT, SLIDE_LOGICAL_WIDTH } from "./slide-cover-layout.ts";
import { generateUuidV4 } from "@ainobi/web-kit/lib/uuid";

const DEFAULT_SLIDE_DURATION_MS = 5000;

function shortId(prefix: string): string {
  return `${prefix}_${generateUuidV4().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * The scene JSON of a new empty courseware (a single blank slide), used by putCourseware to bootstrap the record.
 */
export function buildBlankCoursewareContent(args?: {
  sceneName?: string;
  slideName?: string;
}): Record<string, unknown> {
  const slideId = shortId("el_slide");
  const scene = deserializeScene({
    scene_id: shortId("sc"),
    name: args?.sceneName?.trim() || "Untitled",
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
    slide_elements: [
      {
        element_type: "slide",
        element_id: slideId,
        name: args?.slideName?.trim() || "Slide 1",
        fps: 30,
        position: { x: 0, y: 0 },
        size: { width: SLIDE_LOGICAL_WIDTH, height: SLIDE_LOGICAL_HEIGHT },
        timeline: { start_at: 0, end_at: DEFAULT_SLIDE_DURATION_MS },
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
        background_color: "#F0F0ED",
        children_elements: [],
      },
    ],
    vtuber_elements: [],
  });
  return serializeScene(scene) as unknown as Record<string, unknown>;
}
