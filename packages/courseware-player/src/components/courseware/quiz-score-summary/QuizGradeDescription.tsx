// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from "react";

import { useRequiredQuizScoreSummaryContext } from "./QuizScoreSummaryContext.tsx";
import { resolveScoreSummarySlotContent } from "./resolve-score-summary-slot-content.ts";

export interface QuizGradeDescriptionProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/** Shows the description text of the current grade. */
export const QuizGradeDescription = ({
  className,
  style,
  id,
  children,
}: QuizGradeDescriptionProps) => {
  const { snapshot } = useRequiredQuizScoreSummaryContext();
  const description = snapshot.gradeLevel?.description?.trim() ?? "";
  const content = resolveScoreSummarySlotContent(children, description);
  if (!content) return null;
  return (
    <span
      id={id}
      className={className}
      style={style}
      data-quiz-score-summary-slot="grade-description"
    >
      {content}
    </span>
  );
};
