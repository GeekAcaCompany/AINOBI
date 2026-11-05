// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import { QUIZ_SCORE_DEFAULT_STYLE } from "./quiz-option-appearance.ts";

export interface QuizScoreProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/**
 * Renders the current score string once the question has been submitted and
 * the host opted in to showing the score. Format: `earned / total`. Authors
 * can also use the `{$score}` / `{$earned_score}` / `{$total_score}`
 * interpolations directly inside text for custom phrasing.
 */
export const QuizScore = ({ className, style, id }: QuizScoreProps) => {
  const ctx = useQuizFormContext();
  const reveal = ctx?.editorReveal ?? false;
  if (!reveal && !ctx?.submitted) return null;
  if (!reveal && !ctx?.showFeedbackScore) return null;
  if (!reveal && ctx?.earnedScore == null) return null;
  if (!ctx) return null;
  return (
    <span
      id={id}
      className={className}
      style={{ ...QUIZ_SCORE_DEFAULT_STYLE, ...style }}
      data-quiz-slot="score"
    >
      {ctx.earnedScore ?? ctx.totalScore}
      <span data-quiz-slot="score-separator"> / </span>
      {ctx.totalScore}
    </span>
  );
};
