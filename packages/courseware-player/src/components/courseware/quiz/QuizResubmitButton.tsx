// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type CSSProperties, type ReactNode } from "react";
import { useI18nNew } from "../../../hooks/useI18nNew.tsx";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import {
  mergeQuizSecondaryButtonStyle,
  resolveQuizSecondaryButtonVisualState,
} from "./quiz-button-appearance.ts";

export interface QuizResubmitButtonProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/** Visible only after submission when `allow_resubmit` is true. */
export const QuizResubmitButton = ({
  className,
  style,
  id,
  children,
}: QuizResubmitButtonProps) => {
  const { t } = useI18nNew();
  const ctx = useQuizFormContext();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  if (!ctx) return null;
  if (!ctx.editorReveal && (!ctx.submitted || !ctx.allowResubmit)) return null;
  const visualState = resolveQuizSecondaryButtonVisualState({ hovered, pressed });
  return (
    <button
      type="button"
      id={id}
      className={className}
      style={mergeQuizSecondaryButtonStyle(style, visualState)}
      data-quiz-action="resubmit"
      data-quiz-state={visualState}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onClick={() => ctx.reset()}
    >
      {children ?? t("coursewarePreview.quiz.retry")}
    </button>
  );
};
