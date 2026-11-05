// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type CSSProperties, type ReactNode } from "react";
import { useI18nNew } from "../../../hooks/useI18nNew.tsx";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import {
  mergeQuizPrimaryButtonStyle,
  resolveQuizPrimaryButtonVisualState,
} from "./quiz-button-appearance.ts";

export interface QuizSubmitButtonProps {
  /** When true, disable the submit button until the user has answered (default `true`). */
  disabledWhenEmpty?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

const isEmptyAnswer = (ctx: NonNullable<ReturnType<typeof useQuizFormContext>>): boolean => {
  if (ctx.questionType === "single_choice" || ctx.questionType === "multiple_choice") {
    return ctx.selectedOptionIds.length === 0;
  }
  if (ctx.questionType === "fill_blank") {
    return ctx.blankIds.some((id) => !ctx.inputValues[id]?.trim());
  }
  if (ctx.questionType === "essay") {
    return !Object.values(ctx.inputValues).some((value) => value.trim().length > 0);
  }
  if (ctx.questionType === "shadowing" || ctx.questionType === "speech") {
    return !ctx.recordedBlobUrl || ctx.recordedDurationSec <= 0;
  }
  return false;
};

/**
 * Submits the active quiz attempt. Built-in idle / hover / active / disabled /
 * submitting styles merge on top of author AST `style`.
 */
export const QuizSubmitButton = ({
  disabledWhenEmpty = true,
  className,
  style,
  id,
  children,
}: QuizSubmitButtonProps) => {
  const { t } = useI18nNew();
  const ctx = useQuizFormContext();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const isEmpty = ctx ? isEmptyAnswer(ctx) : true;
  const disabled = !ctx || ctx.submitted || ctx.submitting || (disabledWhenEmpty && isEmpty);
  const visualState = resolveQuizPrimaryButtonVisualState({
    disabled,
    submitting: Boolean(ctx?.submitting),
    hovered: hovered && !disabled,
    pressed: pressed && !disabled,
  });
  const resolvedStyle = mergeQuizPrimaryButtonStyle(style, visualState);

  return (
    <button
      type="submit"
      id={id}
      className={className}
      style={resolvedStyle}
      disabled={disabled}
      data-quiz-action="submit"
      data-quiz-submitting={ctx?.submitting ? "true" : "false"}
      data-quiz-state={visualState}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => {
        if (!disabled) setPressed(true);
      }}
      onMouseUp={() => setPressed(false)}
      onClick={(event) => {
        if (!ctx) return;
        event.preventDefault();
        if (disabled) return;
        void ctx.submit();
      }}
    >
      {children ?? t("coursewarePreview.quiz.submit")}
    </button>
  );
};
