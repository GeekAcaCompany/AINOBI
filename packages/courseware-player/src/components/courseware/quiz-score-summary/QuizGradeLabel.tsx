// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from "react";

import { useRequiredQuizScoreSummaryContext } from "./QuizScoreSummaryContext.tsx";
import { resolveScoreSummarySlotContent } from "./resolve-score-summary-slot-content.ts";

export interface QuizGradeLabelProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/** Shows the grade name matched by the current score (empty when `grade_levels` isn't configured). */
export const QuizGradeLabel = ({ className, style, id, children }: QuizGradeLabelProps) => {
  const { snapshot } = useRequiredQuizScoreSummaryContext();
  const label = snapshot.gradeLevel?.label?.trim() ?? "";
  const content = resolveScoreSummarySlotContent(children, label);
  if (!content) return null;
  return (
    <span id={id} className={className} style={style} data-quiz-score-summary-slot="grade-label">
      {content}
    </span>
  );
};
