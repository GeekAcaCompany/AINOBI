// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";

export interface QuizExplanationProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/**
 * Renders children only after submission, so authors can use `{$explanation}`
 * or any prose explaining the answer.
 */
export const QuizExplanation = ({
  className,
  style,
  id,
  children,
}: QuizExplanationProps) => {
  const ctx = useQuizFormContext();
  const reveal = ctx?.editorReveal ?? false;
  if (!reveal && !ctx?.submitted) return null;
  if (!reveal && !ctx?.question.explanation?.trim()) return null;
  return (
    <div
      id={id}
      className={className}
      style={{ whiteSpace: "pre-line", ...style }}
      data-quiz-slot="explanation"
    >
      {children}
    </div>
  );
};
