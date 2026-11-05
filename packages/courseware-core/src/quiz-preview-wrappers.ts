// SPDX-License-Identifier: AGPL-3.0-only
import type { QuizSlideElement, SlideElement } from "./elements.ts";
import type { QuizConfig, QuizQuestion } from "./quiz.ts";
import { areRequiredQuizWrappersComplete } from "./learning-progress.ts";
import { getSlideLocalDurationMs } from "./slide-flow-pause.ts";

/** Tolerance (ms) between a quiz question's end time and the start of the next content. */
export const QUIZ_GAP_EPS_MS = 1;

const isQuizElementOnSlide = (slide: SlideElement, quizElementId: string): boolean =>
  slide.children_elements.some(
    (e) => e.element_type === "quiz" && e.element_id === quizElementId,
  );

/**
 * Whether any other visible canvas element sits between the end of this question's timeline and the start of the next quiz question (or the end of the slide).
 * If the next question in order is not on this slide, the gap ends at the end of the slide.
 */
export const hasPlayableContentAfterQuizOnSlide = (
  slide: SlideElement,
  currentQuiz: QuizSlideElement,
  nextQuizInSceneOrder: QuizSlideElement | null,
  slidePlaybackDuration: number,
): boolean => {
  const afterEnd = currentQuiz.timeline.end_at;
  let gapEnd = slidePlaybackDuration;
  if (
    nextQuizInSceneOrder &&
    isQuizElementOnSlide(slide, nextQuizInSceneOrder.element_id)
  ) {
    gapEnd = Math.min(gapEnd, nextQuizInSceneOrder.timeline.start_at);
  }

  if (afterEnd + QUIZ_GAP_EPS_MS >= gapEnd) {
    return false;
  }

  const gapStart = afterEnd + QUIZ_GAP_EPS_MS;
  const excluded = new Set<string>([currentQuiz.element_id]);

  for (const el of slide.children_elements) {
    if (excluded.has(el.element_id)) continue;
    if (
      el.element_type === "quiz" &&
      nextQuizInSceneOrder &&
      el.element_id === nextQuizInSceneOrder.element_id
    ) {
      continue;
    }
    const s = el.timeline.start_at;
    const e = el.timeline.end_at;
    if (e > gapStart && s < gapEnd) {
      return true;
    }
  }
  return false;
};

type OrderedQuizWrapper = {
  question: QuizSlideElement;
  slideIndex: number;
};

const listBoundQuizWrappersInSceneOrder = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
): OrderedQuizWrapper[] => {
  const boundById = new Map(quiz.questions.map((q) => [q.question_id, q]));
  const ordered: OrderedQuizWrapper[] = [];
  slides.forEach((slide, slideIndex) => {
    for (const el of slide.children_elements) {
      if (el.element_type !== "quiz") continue;
      const quizEl = el as QuizSlideElement;
      if (!quizEl.quiz_question_id || !boundById.has(quizEl.quiz_question_id)) continue;
      ordered.push({ question: quizEl, slideIndex });
    }
  });
  return ordered;
};

/** Whether the current slide has other playable elements after the given quiz wrapper ends. */
export const hasPlayableContentAfterQuizWrapper = (
  quiz: QuizConfig | null | undefined,
  slides: readonly SlideElement[],
  questionWrapperId: string,
): boolean => {
  if (!quiz?.enabled) return true;
  const ordered = listBoundQuizWrappersInSceneOrder(quiz, slides);
  const idx = ordered.findIndex((item) => item.question.element_id === questionWrapperId);
  if (idx < 0) return true;
  const cur = ordered[idx]!;
  const next = ordered[idx + 1];
  const slideEl = slides[cur.slideIndex];
  if (!slideEl) return true;
  return hasPlayableContentAfterQuizOnSlide(
    slideEl,
    cur.question,
    next?.question ?? null,
    getSlideLocalDurationMs(slideEl),
  );
};

/** Whether the next quiz in scene order is still on the current slide (only then should it seek to the next question's start). */
export const isNextBoundQuizOnSameSlide = (
  quiz: QuizConfig | null | undefined,
  slides: readonly SlideElement[],
  questionWrapperId: string,
): boolean => {
  if (!quiz?.enabled) return false;
  const ordered = listBoundQuizWrappersInSceneOrder(quiz, slides);
  const idx = ordered.findIndex((item) => item.question.element_id === questionWrapperId);
  if (idx < 0) return false;
  const cur = ordered[idx]!;
  const next = ordered[idx + 1];
  return Boolean(next && next.slideIndex === cur.slideIndex);
};

export type TopLevelQuizWrapperLocation = {
  slide: SlideElement;
  quizEl: QuizSlideElement;
};

/**
 * The student preview runtime renders only top-level slide `quiz` elements (see buildQuestionStackRenderUnits).
 * Quizzes nested in group/html do not count as interactive wrappers.
 */
export const buildTopLevelQuizWrapperIndex = (
  slides: readonly SlideElement[],
): Map<string, TopLevelQuizWrapperLocation> => {
  const result = new Map<string, TopLevelQuizWrapperLocation>();
  for (const slide of slides) {
    for (const el of slide.children_elements) {
      if (el.element_type !== "quiz") continue;
      const quizEl = el as QuizSlideElement;
      if (quizEl.element_id) {
        result.set(quizEl.element_id, { slide, quizEl });
      }
    }
  }
  return result;
};

export const collectTopLevelQuizWrappers = (
  slides: readonly SlideElement[],
): Map<string, string> => {
  const result = new Map<string, string>();
  for (const [wrapperId, { quizEl }] of buildTopLevelQuizWrapperIndex(slides)) {
    if (quizEl.quiz_question_id) {
      result.set(wrapperId, quizEl.quiz_question_id);
    }
  }
  return result;
};

/** Collect the wrapper ids of required quiz questions (top-level interactive elements only). */
export const collectRequiredQuizWrapperIds = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
): string[] => {
  const boundByQuestionId = new Map(quiz.questions.map((q) => [q.question_id, q]));
  const wrapperIds: string[] = [];
  for (const [wrapperId, questionId] of collectTopLevelQuizWrappers(slides)) {
    const question = boundByQuestionId.get(questionId);
    if (question && question.required !== false) {
      wrapperIds.push(wrapperId);
    }
  }
  return wrapperIds;
};

/** Number of bound, answerable quiz questions on the canvas (top-level wrappers). */
export const countTopLevelBoundQuizWrappers = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
): number => {
  const boundQuestionIds = new Set(quiz.questions.map((q) => q.question_id));
  let count = 0;
  for (const [, questionId] of collectTopLevelQuizWrappers(slides)) {
    if (boundQuestionIds.has(questionId)) count += 1;
  }
  return count;
};

/** Total full score of visible (top-level, bound) quiz questions. */
export const sumTopLevelBoundQuizMaxScore = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
): number => {
  const boundByQuestionId = new Map(quiz.questions.map((q) => [q.question_id, q]));
  let total = 0;
  for (const [, questionId] of collectTopLevelQuizWrappers(slides)) {
    const question = boundByQuestionId.get(questionId);
    if (question) {
      total += Math.max(0, Number(question.score) || 0);
    }
  }
  return total;
};

export const listTopLevelBoundQuizQuestions = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
): QuizQuestion[] => {
  const boundByQuestionId = new Map(quiz.questions.map((q) => [q.question_id, q]));
  const seen = new Set<string>();
  const questions: QuizQuestion[] = [];
  for (const [, questionId] of collectTopLevelQuizWrappers(slides)) {
    if (seen.has(questionId)) continue;
    const question = boundByQuestionId.get(questionId);
    if (!question) continue;
    seen.add(questionId);
    questions.push(question);
  }
  return questions;
};

export const findTopLevelQuizWrapper = (
  slides: readonly SlideElement[],
  wrapperId: string,
  index?: ReadonlyMap<string, TopLevelQuizWrapperLocation>,
): TopLevelQuizWrapperLocation | null => {
  const resolvedIndex = index ?? buildTopLevelQuizWrapperIndex(slides);
  return resolvedIndex.get(wrapperId) ?? null;
};

/** `question_id` of the last question in the `quiz.questions` config (same as the post-submit primary button logic). */
export const getLastQuizConfigQuestionId = (
  quiz: QuizConfig | null | undefined,
): string | null => {
  if (!quiz?.enabled || quiz.questions.length === 0) return null;
  return quiz.questions[quiz.questions.length - 1]!.question_id;
};

export const isLastQuizConfigQuestion = (
  quiz: QuizConfig | null | undefined,
  quizQuestionId: string,
): boolean => {
  const lastId = getLastQuizConfigQuestionId(quiz);
  return Boolean(lastId && lastId === quizQuestionId);
};

/** Whether the top-level wrapper bound to the "last configured question" on the canvas is submitted or skipped. */
export const isLastQuizConfigWrapperSubmitted = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
  quizState: Record<string, { submitted?: boolean; skipped?: boolean }>,
): boolean => {
  const lastId = getLastQuizConfigQuestionId(quiz);
  if (!lastId) return false;
  for (const [wrapperId, { quizEl }] of buildTopLevelQuizWrapperIndex(slides)) {
    if (quizEl.quiz_question_id !== lastId) continue;
    const state = quizState[wrapperId];
    return Boolean(state?.submitted || state?.skipped);
  }
  return false;
};

/** Total questions to complete in the quiz config (the max of configured questions, top-level canvas wrappers and required wrappers). */
export const countQuizQuestionsExpectedForCompletion = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
): number => {
  const boundCount = countTopLevelBoundQuizWrappers(quiz, slides);
  const requiredCount = collectRequiredQuizWrapperIds(quiz, slides).length;
  const configCount = quiz.enabled ? quiz.questions.length : 0;
  return Math.max(boundCount, configCount, requiredCount);
};

/** Whether local state qualifies for "mark homework as submitted": required questions done, configured count reached, last question answered. */
export const canCompleteQuizHomework = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
  quizState: Record<string, { submitted?: boolean; skipped?: boolean }>,
): boolean => {
  if (!quiz.enabled || quiz.questions.length === 0) return false;
  const requiredIds = collectRequiredQuizWrapperIds(quiz, slides);
  if (requiredIds.length > 0 && !areRequiredQuizWrappersComplete(requiredIds, quizState)) {
    return false;
  }
  const expectedCount = countQuizQuestionsExpectedForCompletion(quiz, slides);
  if (expectedCount <= 0) return false;
  let localAnswered = 0;
  const boundQuestionIds = new Set(quiz.questions.map((q) => q.question_id));
  for (const [wrapperId, questionId] of collectTopLevelQuizWrappers(slides)) {
    if (!boundQuestionIds.has(questionId)) continue;
    const st = quizState[wrapperId];
    if (st?.submitted || st?.skipped) localAnswered += 1;
  }
  if (localAnswered < expectedCount) return false;
  if (!isLastQuizConfigWrapperSubmitted(quiz, slides, quizState)) return false;
  return true;
};

/** Answer payload sent to the courseware service when an optional question is skipped. */
export const buildCoursewareQuizSkippedAnswer = (): { skipped: true } => ({ skipped: true });

const slidesFromSceneContent = (content: Record<string, unknown>): SlideElement[] =>
  Array.isArray(content.slide_elements) ? (content.slide_elements as SlideElement[]) : [];

/** Top-level quiz wrappers (element id → question id) of a raw scene snapshot. */
export const collectTopLevelQuizWrappersFromSceneContent = (
  content: Record<string, unknown>,
): Map<string, string> => collectTopLevelQuizWrappers(slidesFromSceneContent(content));

/** Required wrapper ids of a raw scene snapshot (server-side attempt evaluation). */
export const requiredWrapperIds = (content: Record<string, unknown>, quiz: QuizConfig): string[] =>
  collectRequiredQuizWrapperIds(quiz, slidesFromSceneContent(content));

export const countTopLevelBoundQuizWrappersFromSceneContent = (
  content: Record<string, unknown>,
  quiz: QuizConfig,
): number => countTopLevelBoundQuizWrappers(quiz, slidesFromSceneContent(content));

export type QuizCompletionCountHints = {
  requiredQuestionWrapperIds?: readonly string[];
  quizTotalRequired?: number;
};

/** Expected question count for attempt completion: the client count, raised by client hints. */
export const countQuizQuestionsExpectedForCompletionFromSceneContent = (
  content: Record<string, unknown>,
  quiz: QuizConfig,
  hints?: QuizCompletionCountHints,
): number =>
  Math.max(
    countQuizQuestionsExpectedForCompletion(quiz, slidesFromSceneContent(content)),
    hints?.requiredQuestionWrapperIds?.length ?? 0,
    Math.max(0, hints?.quizTotalRequired ?? 0),
  );

export const mergeRequiredWrapperIds = (
  content: Record<string, unknown>,
  quiz: QuizConfig,
  hints?: QuizCompletionCountHints,
): string[] => [
  ...new Set([...requiredWrapperIds(content, quiz), ...(hints?.requiredQuestionWrapperIds ?? [])]),
];

export const sumTopLevelBoundQuizMaxScoreFromSceneContent = (
  content: Record<string, unknown>,
  quiz: QuizConfig,
): number => sumTopLevelBoundQuizMaxScore(quiz, slidesFromSceneContent(content));
