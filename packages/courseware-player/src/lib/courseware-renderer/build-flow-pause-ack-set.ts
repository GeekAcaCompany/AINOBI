// SPDX-License-Identifier: AGPL-3.0-only
import type { Scene } from "../courseware/index.ts";
import { getSlideFlowPausePoints } from "@ainobi/courseware-core/slide-flow-pause.ts";

/** Video rendering: acknowledge every flow pause point in advance, so the timeline doesn't stop at interaction stops. */
export function buildRendererFlowPauseAckSet(scene: Scene): Set<number> {
  const acknowledged = new Set<number>();
  for (const slide of scene.slide_elements) {
    for (const point of getSlideFlowPausePoints(slide)) {
      acknowledged.add(point.at_ms);
    }
  }
  return acknowledged;
}
