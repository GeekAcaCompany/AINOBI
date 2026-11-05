// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlideChildBox extends ElementBox {
  element_id: string;
  element_type: string;
}

const boxIntersectionArea = (a: ElementBox, b: ElementBox): number => {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
};

/**
 * Warn when inserting slide-level image/audio on a slide that already has a quiz element,
 * especially when the new box overlaps the quiz frame (common agent mis-route for in-question media).
 */
export const collectQuizSlideMediaWarnings = (input: {
  slideIndex: number;
  elementType: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  slideChildren: SlideChildBox[];
  allowSlideMedia: boolean;
}): CliIssue[] => {
  if (input.allowSlideMedia) return [];
  if (input.elementType !== "image" && input.elementType !== "audio") return [];

  const quizElements = input.slideChildren.filter((child) => child.element_type === "quiz");
  if (quizElements.length === 0) return [];

  const { width, height } = input.size;
  if (width <= 0 || height <= 0) return [];

  const mediaBox: ElementBox = {
    x: input.position.x,
    y: input.position.y,
    width,
    height,
  };

  const overlapping = quizElements.filter((quiz) => boxIntersectionArea(mediaBox, quiz) > 0);
  if (overlapping.length === 0) {
    return [
      {
        path: `slide[${input.slideIndex}].children_elements[]`,
        message:
          "This slide has quiz element(s) (" +
          quizElements.map((q) => q.element_id).join(", ") +
          "). If this " +
          input.elementType +
          " belongs inside the question UI (question-stem image, listening audio), use QuizMedia in react_layout via " +
          "ainobi quiz update SLIDE QUIZ_ELEMENT_ID --jsx-file (after ainobi asset upload). " +
          "element insert only adds a slide sibling—not content inside the blue quiz frame. " +
          "Do not use --allow-slide-media to force in-question media onto the slide layer. " +
          "That flag is only for intentional decor outside the blue frame (or overlapping it on purpose).",
        value: { quiz_element_ids: quizElements.map((q) => q.element_id) },
      },
    ];
  }

  const quizIds = overlapping.map((q) => q.element_id).join(", ");
  return [
    {
      path: `slide[${input.slideIndex}].children_elements[]`,
      message:
        `This ${input.elementType} overlaps quiz element(s) (${quizIds}). ` +
        "Media inside the question must use <QuizMedia> + ainobi quiz update --jsx-file, not slide element insert. " +
        "Inserted slide images/audio are siblings of the quiz layer and do not appear in the student question UI. " +
        "Do not use --allow-slide-media to place in-question media—use quiz update + QuizMedia. " +
        "Re-run with --allow-slide-media only for intentional slide decor on top of the quiz frame.",
      value: {
        overlapping_quiz_element_ids: overlapping.map((q) => q.element_id),
        intersection_px2: overlapping.map((q) => boxIntersectionArea(mediaBox, q)),
      },
    },
  ];
};

/** Tag overlap pairs that look like quiz + slide-media misplacement. */
export const isLikelyQuizMediaMisplacementOverlap = (
  a: { element_type: string },
  b: { element_type: string },
): boolean => {
  const types = new Set([a.element_type, b.element_type]);
  return types.has("quiz") && (types.has("image") || types.has("audio"));
};
