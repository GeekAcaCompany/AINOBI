// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from "react";

import { QuizScoreSummaryProvider } from "./QuizScoreSummaryContext.tsx";
import type { QuizAggregateScoreSnapshot } from "@ainobi/courseware-core/quiz-score-summary.ts";

export interface QuizScoreSummaryContainerProps {
  snapshot: QuizAggregateScoreSnapshot;
  padding?: number | string;
  gap?: number | string;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/** Root container of the summary panel, providing the whole-quiz score snapshot to its children. */
export const QuizScoreSummaryContainer = ({
  snapshot,
  padding,
  gap,
  className,
  style,
  id,
  children,
}: QuizScoreSummaryContainerProps) => {
  const layoutStyle: CSSProperties = {
    boxSizing: "border-box",
    ...(padding !== undefined ? { padding } : null),
    ...(gap !== undefined ? { gap, display: "flex", flexDirection: "column" } : null),
    ...style,
  };
  return (
    <QuizScoreSummaryProvider snapshot={snapshot}>
      <div id={id} className={className} style={layoutStyle} data-quiz-score-summary-slot="container">
        {children}
      </div>
    </QuizScoreSummaryProvider>
  );
};
