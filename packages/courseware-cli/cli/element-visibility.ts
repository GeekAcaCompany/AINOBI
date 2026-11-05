// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from "@ainobi/courseware-core/elements.ts";

const NON_VISUAL_ELEMENT_TYPES = new Set(["audio", "narration"]);

/**
 * Whether an element can ever render pixels, judged the way the renderer does: with
 * keyframes, size and opacity come only from the keyframes (the base box is ignored, so a
 * 0-size base can grow in); without keyframes, from the base size and style opacity.
 * Shared by timeline coverage and the content-overlap check.
 */
export const hasVisiblePixels = (element: Element): boolean => {
  if (NON_VISUAL_ELEMENT_TYPES.has(element.element_type)) return false;
  if (element.keyframes.length > 0) {
    return (
      element.keyframes.some((frame) => frame.size.width > 0 && frame.size.height > 0) &&
      element.keyframes.some((frame) => frame.opacity > 0)
    );
  }
  return element.size.width > 0 && element.size.height > 0 && element.style.opacity > 0;
};
