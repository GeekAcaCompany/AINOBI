// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";

export interface QuizOptionGroupProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/**
 * Wraps {@link QuizOption} children with the correct `role` based on the
 * current question type (radiogroup for single_choice, group for multi-choice).
 * Has no behavior of its own.
 */
export const QuizOptionGroup = ({
  className,
  style,
  id,
  children,
}: QuizOptionGroupProps) => {
  const ctx = useQuizFormContext();
  const role =
    ctx?.questionType === "single_choice"
      ? "radiogroup"
      : ctx?.questionType === "multiple_choice"
        ? "group"
        : "list";
  return (
    <div
      id={id}
      role={role}
      className={className}
      style={style}
      data-quiz-slot="option-group"
    >
      {children}
    </div>
  );
};
