// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";

export interface QuizTextareaProps {
  name: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/**
 * Controlled multi-line input. Used by essay questions.
 */
export const QuizTextarea = ({
  name,
  placeholder,
  rows,
  disabled,
  className,
  style,
  id,
}: QuizTextareaProps) => {
  const ctx = useQuizFormContext();
  const value = ctx?.getInputValue(name) ?? "";
  const submitted = ctx?.submitted ?? false;
  return (
    <textarea
      id={id}
      className={className}
      style={style}
      name={name}
      placeholder={placeholder}
      rows={rows ?? 4}
      disabled={disabled || !ctx || submitted}
      readOnly={submitted}
      value={value}
      data-quiz-input={name}
      data-quiz-submitted={submitted ? "true" : "false"}
      onChange={(event) => ctx?.setInputValue(name, event.target.value)}
    />
  );
};
