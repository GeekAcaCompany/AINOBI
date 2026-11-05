// SPDX-License-Identifier: AGPL-3.0-only
import type { BaseElement, QuizSlideElement, SlideElement } from "./elements.ts";
import type { QuizAstNode } from "./quiz-ast.ts";
import type { QuizConfig, QuizQuestion } from "./quiz.ts";

export interface ElementLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const elementLayoutBox = (element: BaseElement): ElementLayoutBox => ({
  x: element.position.x,
  y: element.position.y,
  width: element.size.width,
  height: element.size.height,
});

/** True when two axis-aligned boxes share positive area. */
export const layoutBoxesOverlap = (a: ElementLayoutBox, b: ElementLayoutBox): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

const SLIDE_MEDIA_TYPES = new Set<BaseElement["element_type"]>(["image", "audio"]);

const walkQuizAst = (node: QuizAstNode | null | undefined, visit: (node: QuizAstNode) => void): void => {
  if (!node) return;
  visit(node);
  if (node.kind === "text" || node.kind === "interp") return;
  for (const child of node.children) walkQuizAst(child, visit);
};

const questionHasQuizMedia = (question: QuizQuestion, mediaType: "image" | "audio"): boolean => {
  let found = false;
  walkQuizAst(question.react_layout, (node) => {
    if (found || node.kind !== "element" || node.tag !== "QuizMedia") return;
    if (node.props.type !== mediaType) return;
    const src = node.props.src;
    if (typeof src === "string" && src.trim().length > 0) found = true;
  });
  return found;
};

const findQuestionById = (config: QuizConfig, questionId: string): QuizQuestion | null =>
  config.questions.find((q) => q.question_id === questionId) ?? null;

/**
 * Warn when slide-level image/audio siblings overlap a quiz wrapper, or when a
 * slide has media but the bound question's AST has no matching `<QuizMedia>`.
 */
export const collectQuizSlideMediaPlacementWarnings = (
  config: QuizConfig | null | undefined,
  slides: readonly SlideElement[],
): { path: string; message: string }[] => {
  if (!config) return [];
  const warnings: { path: string; message: string }[] = [];

  slides.forEach((slide, slideIndex) => {
    const quizWrappers = slide.children_elements.filter(
      (el): el is QuizSlideElement => el.element_type === "quiz",
    );
    if (quizWrappers.length === 0) return;

    const slideMedia = slide.children_elements.filter((el) => SLIDE_MEDIA_TYPES.has(el.element_type));
    if (slideMedia.length === 0) return;

    for (const media of slideMedia) {
      const mediaType = media.element_type === "audio" ? "audio" : "image";
      const mediaBox = elementLayoutBox(media as BaseElement);
      let overlappedQuiz: QuizSlideElement | null = null;

      for (const quiz of quizWrappers) {
        if (layoutBoxesOverlap(mediaBox, elementLayoutBox(quiz))) {
          overlappedQuiz = quiz;
          break;
        }
      }

      if (overlappedQuiz) {
        warnings.push({
          path: `slide_elements[${slideIndex}].children_elements`,
          message:
            `Slide ${slideIndex + 1}: slide-layer ${mediaType} "${media.name || media.element_id}" ` +
            `overlaps the quiz frame "${overlappedQuiz.name || overlappedQuiz.element_id}". If this asset is a question-stem/option image or listening audio, ` +
            `use <QuizMedia type="${mediaType}"> inside react_layout instead ` +
            `of running element insert --type ${mediaType} on the slide.`,
        });
        continue;
      }

      for (const quiz of quizWrappers) {
        const question = findQuestionById(config, quiz.quiz_question_id);
        if (!question || questionHasQuizMedia(question, mediaType)) continue;
        warnings.push({
          path: `slide_elements[${slideIndex}].children_elements`,
          message:
            `Slide ${slideIndex + 1}: slide-layer ${mediaType} "${media.name || media.element_id}" ` +
            `shares the slide with quiz "${quiz.name || quiz.quiz_question_id}", but the question AST has no <QuizMedia type="${mediaType}">. ` +
            `If this asset is a question-stem/demo image, asset upload it and write it via quiz update --jsx instead of leaving it only on the slide (slide-layer assets do not appear inside the quiz container of the student answer UI).`,
        });
        break;
      }
    }
  });

  return warnings;
};
