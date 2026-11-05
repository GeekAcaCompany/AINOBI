// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext, type ReactNode } from "react";

import type { QuizAggregateScoreSnapshot } from "@ainobi/courseware-core/quiz-score-summary.ts";

export interface QuizScoreSummaryContextValue {
  snapshot: QuizAggregateScoreSnapshot;
}

const QuizScoreSummaryContext = createContext<QuizScoreSummaryContextValue | null>(null);

export const QuizScoreSummaryProvider = ({
  snapshot,
  children,
}: {
  snapshot: QuizAggregateScoreSnapshot;
  children: ReactNode;
}) => (
  <QuizScoreSummaryContext.Provider value={{ snapshot }}>{children}</QuizScoreSummaryContext.Provider>
);

export const useQuizScoreSummaryContext = (): QuizScoreSummaryContextValue | null =>
  useContext(QuizScoreSummaryContext);

export const useRequiredQuizScoreSummaryContext = (): QuizScoreSummaryContextValue => {
  const ctx = useContext(QuizScoreSummaryContext);
  if (!ctx) {
    throw new Error("QuizScoreSummary components must be rendered inside QuizScoreSummaryProvider");
  }
  return ctx;
};
