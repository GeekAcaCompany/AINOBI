// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

import {
  authorInteractiveFeedback,
  authorStyleHasCustomAppearance,
  omitAuthorSetKeys,
} from "./quiz-style-merge.ts";

/**
 * Warm neutral surfaces for `#f0f0ec` slides; primary actions use blue accent
 * when the author does not override colors in AST `style`.
 */
export const QUIZ_WARM_PALETTE = {
  slide: "#f0f0ec",
  surface: "#fbfbf9",
  surfaceHover: "#f5f5f1",
  surfaceActive: "#eeeee9",
  border: "#d6d6d0",
  borderStrong: "#c8c8c2",
  text: "#4a4a46",
  textMuted: "#6b6b65",
  accent: "#2563eb",
  accentHover: "#1d4ed8",
  accentActive: "#1e40af",
  accentText: "#ffffff",
  disabledBg: "#e4e4de",
  disabledText: "#9a9a94",
  explanation: "#e8e8e2",
} as const;

export type QuizPrimaryButtonVisualState =
  | "idle"
  | "hover"
  | "active"
  | "disabled"
  | "submitting";

export type QuizSecondaryButtonVisualState = "idle" | "hover" | "active" | "hidden";

const BUTTON_MOTION: CSSProperties = {
  transition:
    "background-color 140ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease, filter 140ms ease, transform 100ms ease",
};

const PRIMARY_APPEARANCE: Record<QuizPrimaryButtonVisualState, CSSProperties> = {
  idle: {
    backgroundColor: QUIZ_WARM_PALETTE.accent,
    color: QUIZ_WARM_PALETTE.accentText,
    borderColor: QUIZ_WARM_PALETTE.accent,
    opacity: 1,
  },
  hover: {
    backgroundColor: QUIZ_WARM_PALETTE.accentHover,
    color: QUIZ_WARM_PALETTE.accentText,
    borderColor: QUIZ_WARM_PALETTE.accentHover,
    opacity: 1,
  },
  active: {
    backgroundColor: QUIZ_WARM_PALETTE.accentActive,
    color: QUIZ_WARM_PALETTE.accentText,
    borderColor: QUIZ_WARM_PALETTE.accentActive,
    opacity: 1,
  },
  disabled: {
    backgroundColor: QUIZ_WARM_PALETTE.disabledBg,
    color: QUIZ_WARM_PALETTE.disabledText,
    borderColor: QUIZ_WARM_PALETTE.disabledBg,
    opacity: 0.92,
  },
  submitting: {
    backgroundColor: QUIZ_WARM_PALETTE.accentHover,
    color: QUIZ_WARM_PALETTE.accentText,
    borderColor: QUIZ_WARM_PALETTE.accentHover,
    opacity: 0.78,
  },
};

const SECONDARY_APPEARANCE: Record<
  Exclude<QuizSecondaryButtonVisualState, "hidden">,
  CSSProperties
> = {
  idle: {
    backgroundColor: "transparent",
    color: QUIZ_WARM_PALETTE.textMuted,
    borderColor: QUIZ_WARM_PALETTE.border,
  },
  hover: {
    backgroundColor: QUIZ_WARM_PALETTE.surfaceHover,
    color: QUIZ_WARM_PALETTE.text,
    borderColor: QUIZ_WARM_PALETTE.borderStrong,
  },
  active: {
    backgroundColor: QUIZ_WARM_PALETTE.surfaceActive,
    color: QUIZ_WARM_PALETTE.text,
    borderColor: QUIZ_WARM_PALETTE.borderStrong,
  },
};

const PRIMARY_LAYOUT: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 28px",
  fontSize: 17,
  fontWeight: 600,
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: "solid",
  alignSelf: "flex-start",
  minWidth: 140,
  cursor: "pointer",
};

const SECONDARY_LAYOUT: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: "solid",
  alignSelf: "flex-start",
  cursor: "pointer",
};

export const resolveQuizPrimaryButtonVisualState = (input: {
  disabled: boolean;
  submitting: boolean;
  hovered: boolean;
  pressed: boolean;
}): QuizPrimaryButtonVisualState => {
  if (input.disabled) return "disabled";
  if (input.submitting) return "submitting";
  if (input.pressed) return "active";
  if (input.hovered) return "hover";
  return "idle";
};

export const resolveQuizSecondaryButtonVisualState = (input: {
  hovered: boolean;
  pressed: boolean;
}): Exclude<QuizSecondaryButtonVisualState, "hidden"> => {
  if (input.pressed) return "active";
  if (input.hovered) return "hover";
  return "idle";
};

export const mergeQuizPrimaryButtonStyle = (
  authorStyle: CSSProperties | undefined,
  visualState: QuizPrimaryButtonVisualState,
): CSSProperties => {
  const layout = omitAuthorSetKeys(PRIMARY_LAYOUT, authorStyle);
  const customized = authorStyleHasCustomAppearance(authorStyle);

  if (customized) {
    const feedback = authorInteractiveFeedback(visualState);
    return {
      ...BUTTON_MOTION,
      ...layout,
      ...authorStyle,
      ...feedback,
      cursor:
        visualState === "disabled" || visualState === "submitting"
          ? "not-allowed"
          : ((authorStyle?.cursor as string | undefined) ?? "pointer"),
    };
  }

  const stateLayer = omitAuthorSetKeys(PRIMARY_APPEARANCE[visualState], authorStyle);
  return {
    ...BUTTON_MOTION,
    ...layout,
    ...authorStyle,
    ...stateLayer,
    cursor: visualState === "disabled" || visualState === "submitting" ? "not-allowed" : "pointer",
  };
};

export const mergeQuizRecordingActiveStyle = (
  authorStyle: CSSProperties | undefined,
  recordingStyle: CSSProperties | undefined,
): CSSProperties => {
  if (recordingStyle && Object.keys(recordingStyle).length > 0) {
    const layout = omitAuthorSetKeys(PRIMARY_LAYOUT, authorStyle);
    return {
      ...BUTTON_MOTION,
      ...layout,
      ...authorStyle,
      ...recordingStyle,
      cursor: "pointer",
    };
  }
  return mergeQuizPrimaryButtonStyle(authorStyle, "active");
};

export const mergeQuizSecondaryButtonStyle = (
  authorStyle: CSSProperties | undefined,
  visualState: Exclude<QuizSecondaryButtonVisualState, "hidden">,
): CSSProperties => {
  const layout = omitAuthorSetKeys(SECONDARY_LAYOUT, authorStyle);
  const customized = authorStyleHasCustomAppearance(authorStyle);

  if (customized) {
    return {
      ...BUTTON_MOTION,
      ...layout,
      ...authorStyle,
      ...authorInteractiveFeedback(visualState),
      cursor: (authorStyle?.cursor as string | undefined) ?? "pointer",
    };
  }

  const stateLayer = omitAuthorSetKeys(SECONDARY_APPEARANCE[visualState], authorStyle);
  return {
    ...BUTTON_MOTION,
    ...layout,
    ...authorStyle,
    ...stateLayer,
  };
};
