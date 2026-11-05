// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";
import type { Element, Scene } from "@ainobi/courseware-core";

const isQuizPlaybackElement = (element: Element): boolean =>
  element.element_type === "quiz" || element.element_type === "quiz_score_summary";

const hasElementMotion = (element: Element): boolean => {
  if (element.enter_effect !== "none") return true;
  if (element.exit_effect !== "none") return true;
  if (element.animations.length > 0) return true;
  if (element.keyframes.length > 0) return true;
  return false;
};

const flattenSlideChildren = (elements: Element[]): Element[] => {
  const out: Element[] = [];
  for (const element of elements) {
    out.push(element);
    if ("children_elements" in element && Array.isArray(element.children_elements)) {
      out.push(...flattenSlideChildren(element.children_elements as Element[]));
    }
  }
  return out;
};

/**
 * Warn when every child on a slide lacks enter/exit effects, animation segments, and keyframes.
 */
export const collectSlidesWithNoMotionWarnings = (scene: Scene): CliIssue[] => {
  const warnings: CliIssue[] = [];
  scene.slide_elements.forEach((slide, slideIndex) => {
    const children = flattenSlideChildren(slide.children_elements);
    if (children.length === 0) return;
    if (children.every(isQuizPlaybackElement)) return;
    if (!children.every((element) => !hasElementMotion(element))) return;

    const label = slide.name?.trim() || `index ${slideIndex}`;
    warnings.push({
      path: `slide_elements[${slideIndex}].children_elements`,
      message:
        `Slide "${label}" has ${children.length} child element(s) with no enter/exit effects, ` +
        "animation segments, or keyframes; consider `animation preset`, `animation stagger`, or explicit effects for timed reveals.",
      value: {
        slide_index: slideIndex,
        slide_id: slide.element_id,
        child_count: children.length,
      },
    });
  });
  return warnings;
};
