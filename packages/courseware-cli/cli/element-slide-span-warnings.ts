// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";
import type { Element, Scene } from "@ainobi/courseware-core";

const FULL_SLIDE_SPAN_EPSILON_MS = 50;

const elementTypeLabel = (elementType: Element["element_type"]): string =>
  elementType === "html" ? "HTML" : "Quiz";

/**
 * Warn when `html` / `quiz` slide children do not span the full slide timeline.
 * Default authoring expectation: these elements stay visible for the entire slide.
 */
export const collectHtmlQuizSlideSpanWarnings = (scene: Scene): CliIssue[] => {
  const warnings: CliIssue[] = [];
  scene.slide_elements.forEach((slide, slideIndex) => {
    const slideStart = slide.timeline.start_at;
    const slideEnd = slide.timeline.end_at;
    const slideDur = slideEnd - slideStart;
    if (slideDur <= 0) return;

    for (const element of slide.children_elements) {
      if (element.element_type !== "html" && element.element_type !== "quiz") continue;
      const span = element.timeline.end_at - element.timeline.start_at;
      const startsLate = element.timeline.start_at > slideStart + FULL_SLIDE_SPAN_EPSILON_MS;
      const endsEarly = element.timeline.end_at < slideEnd - FULL_SLIDE_SPAN_EPSILON_MS;
      if (!startsLate && !endsEarly) continue;

      const label = elementTypeLabel(element.element_type);
      warnings.push({
        path: `slide_elements[${slideIndex}].${element.element_id}.timeline`,
        message:
          `${label} element timeline does not span the full slide (${span}ms of ${slideDur}ms). ` +
          `Prefer timeline.start_at=${slideStart}, timeline.end_at=${slideEnd} (the full slide duration) unless a shorter window is intentional.`,
      });
    }
  });
  return warnings;
};
