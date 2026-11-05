// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type CSSProperties, type ReactNode } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import {
  mergeQuizOptionStyle,
  resolveQuizOptionVisualState,
} from "./quiz-option-appearance.ts";

export interface QuizOptionProps {
  /** Maps to `scene.quiz.questions[].options[].option_id`. */
  value: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/**
 * A single selectable choice for single/multiple-choice questions.
 *
 * Built-in idle / hover / selected / submit feedback colors are merged on top of
 * author `style` from the AST. Authors can still override layout metrics; state
 * colors take precedence for border/background/text after submit.
 */
export const QuizOption = ({
  value,
  disabled,
  className,
  style,
  id,
  children,
}: QuizOptionProps) => {
  const ctx = useQuizFormContext();
  const [hovered, setHovered] = useState(false);
  const selected = ctx?.isOptionSelected(value) ?? false;
  const submitted = ctx?.submitted ?? false;
  const isCorrect =
    submitted && ctx
      ? Boolean(
          (ctx.question.type === "single_choice" || ctx.question.type === "multiple_choice") &&
            (ctx.question as { options: Array<{ option_id: string; is_correct: boolean }> }).options
              .find((opt) => opt.option_id === value)?.is_correct,
        )
      : false;

  const visualState = resolveQuizOptionVisualState({
    submitted,
    selected,
    isCorrect,
    hovered: hovered && !submitted,
  });

  const interactive = ctx && !submitted && !disabled;
  const resolvedStyle = mergeQuizOptionStyle(style, visualState);

  return (
    <button
      type="button"
      id={id}
      className={className}
      style={{
        ...resolvedStyle,
        cursor: interactive ? "pointer" : submitted ? "default" : "not-allowed",
      }}
      disabled={!interactive}
      data-quiz-option={value}
      data-quiz-state={visualState}
      data-quiz-correct={submitted ? String(isCorrect) : undefined}
      data-quiz-submitted={submitted ? "true" : "false"}
      aria-pressed={selected}
      onMouseEnter={() => {
        if (interactive) setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!interactive) return;
        ctx.toggleOption(value);
      }}
    >
      {children}
    </button>
  );
};
