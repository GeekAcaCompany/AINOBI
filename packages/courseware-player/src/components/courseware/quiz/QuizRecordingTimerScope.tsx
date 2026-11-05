// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext, type ReactNode } from "react";

const QuizRecordingTimerScopeContext = createContext<string | null>(null);

export const QuizRecordingTimerScope = ({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) => (
  <QuizRecordingTimerScopeContext.Provider value={name}>
    {children}
  </QuizRecordingTimerScopeContext.Provider>
);

/** `name` of the nearest enclosing {@link QuizRecordingTimer} (for `{$recording_elapsed}`). */
export const useQuizRecordingTimerScope = (): string | null =>
  useContext(QuizRecordingTimerScopeContext);
