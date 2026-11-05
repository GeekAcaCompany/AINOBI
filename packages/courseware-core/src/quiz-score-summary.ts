// SPDX-License-Identifier: AGPL-3.0-only
import type { QuizGradeLevel, QuizConfig } from "./quiz.ts";
import type { QuizSlideElement, SlideElement } from "./elements.ts";
import { countTopLevelBoundQuizWrappers, sumTopLevelBoundQuizMaxScore } from "./quiz-preview-wrappers.ts";
import { validateQuizScoreSummaryAst, type QuizScoreSummaryAstNode } from "./quiz-score-summary-ast.ts";
import { buildDefaultQuizScoreSummaryAst } from "./quiz-score-summary-default-ast.ts";
import type { ContentLanguage } from "./content-language.ts";

export interface QuizScoreSummaryConfig {
  react_layout: QuizScoreSummaryAstNode;
}

export interface QuizAggregateScoreSnapshot {
  earnedScore: number;
  totalScore: number;
  questionCount: number;
  answeredCount: number;
  gradeLevel: QuizGradeLevel | null;
}

/** Match the grade for the current score by the `grade_levels` thresholds (descending). */
export const resolveQuizGradeLevel = (
  earnedScore: number,
  gradeLevels: readonly QuizGradeLevel[],
): QuizGradeLevel | null => {
  if (gradeLevels.length === 0) return null;
  const sorted = [...gradeLevels].sort((a, b) => b.min_score - a.min_score);
  return sorted.find((lv) => earnedScore >= lv.min_score) ?? null;
};

export type QuizQuestionAttemptState = {
  submitted?: boolean;
  skipped?: boolean;
  score?: number | null;
};

/**
 * Sum the scores of all bound quiz elements. Submitted (including skipped) counts toward answered_count;
 * earnedScore accumulates only when submitted and score is a number.
 */
export const computeQuizAggregateScore = (
  quiz: QuizConfig,
  slides: readonly SlideElement[],
  quizState: Record<string, QuizQuestionAttemptState>,
): QuizAggregateScoreSnapshot => {
  let earnedScore = 0;
  let answeredCount = 0;
  const boundQuestionIds = new Set(quiz.questions.map((q) => q.question_id));

  for (const slide of slides) {
    for (const el of slide.children_elements) {
      if (el.element_type !== "quiz") continue;
      const quizEl = el as QuizSlideElement;
      if (!boundQuestionIds.has(quizEl.quiz_question_id)) continue;
      const st = quizState[quizEl.element_id];
      if (!st) continue;
      if (st.skipped) {
        answeredCount += 1;
        continue;
      }
      if (st.submitted) {
        answeredCount += 1;
        if (typeof st.score === "number" && Number.isFinite(st.score)) {
          earnedScore += st.score;
        }
      }
    }
  }

  const questionCount = countTopLevelBoundQuizWrappers(quiz, slides);
  const totalScore = sumTopLevelBoundQuizMaxScore(quiz, slides);

  return {
    earnedScore,
    totalScore: totalScore > 0 ? totalScore : quiz.total_score,
    questionCount,
    answeredCount,
    gradeLevel: resolveQuizGradeLevel(earnedScore, quiz.grade_levels),
  };
};

/** `language` = courseware content language (`scene.metadata.language`); the default card copy is baked in it. */
export const createDefaultQuizScoreSummaryConfig = (language: ContentLanguage): QuizScoreSummaryConfig => ({
  react_layout: buildDefaultQuizScoreSummaryAst(language),
});

export const ensureQuizScoreSummaryConfig = (
  config: QuizScoreSummaryConfig | null | undefined,
  language: ContentLanguage,
): QuizScoreSummaryConfig => {
  if (config?.react_layout) return config;
  return createDefaultQuizScoreSummaryConfig(language);
};

/**
 * Decides which `score_summary` to write when the canvas "adds score statistics":
 * - no `quiz_score_summary` element on the canvas yet → write the current built-in default (overriding an old default that exists only in the quiz config)
 * - an element already on the canvas → reuse the shared layout (keeping user/agent customizations)
 */
export const resolveQuizScoreSummaryConfigForCanvasAdd = (
  existing: QuizScoreSummaryConfig | null | undefined,
  slides: readonly SlideElement[],
  language: ContentLanguage,
): QuizScoreSummaryConfig => {
  const hasScoreSummaryOnCanvas = slides.some((slide) =>
    slide.children_elements.some((el) => el.element_type === "quiz_score_summary"),
  );
  if (!hasScoreSummaryOnCanvas) {
    return createDefaultQuizScoreSummaryConfig(language);
  }
  return ensureQuizScoreSummaryConfig(existing, language);
};

export const validateQuizScoreSummaryConfig = (
  config: QuizScoreSummaryConfig | null | undefined,
  path = "quiz.score_summary",
): { path: string; message: string }[] => {
  if (!config) return [];
  return validateQuizScoreSummaryAst(config.react_layout).map((issue) => ({
    path: `${path}.${issue.path}`,
    message: issue.message,
  }));
};

/** Default geometry of the score statistics canvas element (a centered wide card at 1920×1080). */
export const defaultQuizScoreSummaryElementLayoutForSlide = (slide: {
  size?: { width?: number; height?: number };
}): { position: { x: number; y: number }; size: { width: number; height: number } } => {
  const slideW = Number(slide.size?.width ?? 1920);
  const slideH = Number(slide.size?.height ?? 1080);
  const width = Math.min(1000, Math.max(640, slideW - 160));
  const height = Math.min(520, Math.max(400, Math.round(slideH * 0.46)));
  return {
    position: {
      x: Math.round((slideW - width) / 2),
      y: Math.round((slideH - height) / 2),
    },
    size: { width, height },
  };
};
