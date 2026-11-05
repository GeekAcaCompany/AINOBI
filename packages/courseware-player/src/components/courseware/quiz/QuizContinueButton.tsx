// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type CSSProperties, type ReactNode } from "react";
import { useI18nNew } from "../../../hooks/useI18nNew.tsx";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import {
  mergeQuizSecondaryButtonStyle,
  resolveQuizSecondaryButtonVisualState,
} from "./quiz-button-appearance.ts";

export interface QuizContinueButtonProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/** Advance once the host clears the playback gate (`canAdvance`). */
export const QuizContinueButton = ({
  className,
  style,
  id,
  children,
}: QuizContinueButtonProps) => {
  const { t } = useI18nNew();
  const ctx = useQuizFormContext();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  if (!ctx) return null;
  if (!ctx.editorReveal && !ctx.canAdvance) return null;
  const visualState = resolveQuizSecondaryButtonVisualState({ hovered, pressed });
  return (
    <button
      type="button"
      id={id}
      className={className}
      style={mergeQuizSecondaryButtonStyle(style, visualState)}
      data-quiz-action="continue"
      data-quiz-state={visualState}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onClick={() => ctx.advance()}
    >
      {children ?? t("coursewarePreview.quiz.continue")}
    </button>
  );
};
