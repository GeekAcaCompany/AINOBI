// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

import { useRequiredQuizScoreSummaryContext } from "./QuizScoreSummaryContext.tsx";

const DEFAULT_STYLE: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
};

export interface QuizTotalScoreProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/** Shows the whole-quiz total score: `earned / total`. */
export const QuizTotalScore = ({ className, style, id }: QuizTotalScoreProps) => {
  const { snapshot } = useRequiredQuizScoreSummaryContext();
  return (
    <span
      id={id}
      className={className}
      style={{ ...DEFAULT_STYLE, ...style }}
      data-quiz-score-summary-slot="total-score"
    >
      {snapshot.earnedScore}
      <span data-quiz-score-summary-slot="total-score-separator"> / </span>
      {snapshot.totalScore}
    </span>
  );
};
