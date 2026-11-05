// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

import { QUIZ_WARM_PALETTE } from "./quiz-button-appearance.ts";
import {
  authorInteractiveFeedback,
  authorStyleHasCustomAppearance,
  omitAuthorSetKeys,
} from "./quiz-style-merge.ts";

export type QuizOptionVisualState =
  | "idle"
  | "selected"
  | "hover"
  | "submitted-correct"
  | "submitted-incorrect"
  | "submitted-other";

/** Resolve visual state for a choice option (after submit, every correct option is "correct"). */
export const resolveQuizOptionVisualState = (input: {
  submitted: boolean;
  selected: boolean;
  isCorrect: boolean;
  hovered: boolean;
}): QuizOptionVisualState => {
  const { submitted, selected, isCorrect, hovered } = input;
  if (!submitted) {
    if (selected) return "selected";
    if (hovered) return "hover";
    return "idle";
  }
  if (isCorrect) return "submitted-correct";
  if (selected) return "submitted-incorrect";
  return "submitted-other";
};

const STATE_APPEARANCE: Record<QuizOptionVisualState, CSSProperties> = {
  idle: {
    borderColor: QUIZ_WARM_PALETTE.border,
    backgroundColor: QUIZ_WARM_PALETTE.surface,
    color: QUIZ_WARM_PALETTE.text,
  },
  hover: {
    borderColor: QUIZ_WARM_PALETTE.borderStrong,
    backgroundColor: QUIZ_WARM_PALETTE.surfaceHover,
    color: QUIZ_WARM_PALETTE.text,
  },
  selected: {
    borderColor: QUIZ_WARM_PALETTE.accent,
    backgroundColor: "#eff6ff",
    color: QUIZ_WARM_PALETTE.text,
    boxShadow: `0 0 0 1px ${QUIZ_WARM_PALETTE.accent}`,
  },
  "submitted-correct": {
    borderColor: "#9ab89a",
    backgroundColor: "#e8f0e8",
    color: "#2f4f2f",
  },
  "submitted-incorrect": {
    borderColor: "#d4a0a0",
    backgroundColor: "#f5e8e8",
    color: "#6b3030",
  },
  "submitted-other": {
    borderColor: QUIZ_WARM_PALETTE.border,
    backgroundColor: QUIZ_WARM_PALETTE.slide,
    color: QUIZ_WARM_PALETTE.textMuted,
    opacity: 0.9,
  },
};

const LAYOUT_BASE: CSSProperties = {
  display: "flex",
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
  transition: "background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, filter 140ms ease",
};

/** Merge author AST `style` with built-in state colors. Author appearance wins unless post-submit feedback applies. */
export const mergeQuizOptionStyle = (
  authorStyle: CSSProperties | undefined,
  visualState: QuizOptionVisualState,
): CSSProperties => {
  const submittedFeedback =
    visualState === "submitted-correct" ||
    visualState === "submitted-incorrect" ||
    visualState === "submitted-other";

  if (submittedFeedback) {
    return {
      ...LAYOUT_BASE,
      borderWidth: 1,
      borderStyle: "solid",
      ...authorStyle,
      ...STATE_APPEARANCE[visualState],
    };
  }

  const customized = authorStyleHasCustomAppearance(authorStyle);
  if (customized) {
    const feedback =
      visualState === "hover"
        ? authorInteractiveFeedback("hover")
        : visualState === "selected"
          ? { boxShadow: authorStyle?.boxShadow ?? `0 0 0 2px ${QUIZ_WARM_PALETTE.accent}` }
          : {};
    return {
      ...LAYOUT_BASE,
      borderWidth: authorStyle?.borderWidth ?? 1,
      borderStyle: (authorStyle?.borderStyle as string | undefined) ?? "solid",
      ...authorStyle,
      ...feedback,
    };
  }

  const stateLayer = omitAuthorSetKeys(STATE_APPEARANCE[visualState], authorStyle);
  return {
    ...LAYOUT_BASE,
    borderWidth: 1,
    borderStyle: "solid",
    ...authorStyle,
    ...stateLayer,
  };
};

export const QUIZ_SCORE_DEFAULT_STYLE: CSSProperties = {
  display: "inline-block",
  marginTop: 4,
  padding: "6px 12px",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  color: QUIZ_WARM_PALETTE.text,
  backgroundColor: QUIZ_WARM_PALETTE.explanation,
};

export const QUIZ_FEEDBACK_DEFAULT_STYLE: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 10,
  fontSize: 15,
  lineHeight: 1.5,
};
