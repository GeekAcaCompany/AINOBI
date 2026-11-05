// SPDX-License-Identifier: AGPL-3.0-only
import type { SlideElement } from "./elements.ts";
import type { QuizQuestionAttemptState } from "./quiz-score-summary.ts";

export {
  collectRequiredQuizWrapperIds,
  collectTopLevelQuizWrappers,
  countTopLevelBoundQuizWrappers,
} from "./quiz-preview-wrappers.ts";

/** Compute 0–100 learning progress from the scene playhead position. */
export const computeCoursewareLearningProgressPercent = (
  sceneCurrentTimeMs: number,
  sceneTotalDurationMs: number,
): number => {
  if (!Number.isFinite(sceneCurrentTimeMs) || !Number.isFinite(sceneTotalDurationMs)) {
    return 0;
  }
  if (sceneTotalDurationMs <= 0) return 0;
  const raw = Math.round((sceneCurrentTimeMs / sceneTotalDurationMs) * 100);
  return Math.max(0, Math.min(100, raw));
};

export const slideHasQuizScoreSummary = (slide: SlideElement): boolean =>
  slide.children_elements.some((el) => el.element_type === "quiz_score_summary");

/** Every required question submitted or skipped (optional questions don't count). */
export const areRequiredQuizWrappersComplete = (
  requiredWrapperIds: readonly string[],
  quizState: Record<string, QuizQuestionAttemptState>,
): boolean => {
  if (requiredWrapperIds.length === 0) return true;
  return requiredWrapperIds.every((wrapperId) => {
    const state = quizState[wrapperId];
    return Boolean(state?.submitted || state?.skipped);
  });
};
