// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import { QUIZ_FEEDBACK_DEFAULT_STYLE } from "./quiz-option-appearance.ts";

export interface QuizFeedbackProps {
  /** Optional variant flag the author can target with CSS. */
  variant?: string;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/**
 * Submission feedback (correct / incorrect / partial). Rendered only after
 * submit and only if the host returned a feedback string or the host opted
 * to always show feedback children. The wrapper exposes `data-variant` so
 * authors can style success / failure differently.
 */
export const QuizFeedback = ({
  variant,
  className,
  style,
  id,
  children,
}: QuizFeedbackProps) => {
  const ctx = useQuizFormContext();
  const reveal = ctx?.editorReveal ?? false;
  if (!ctx) return null;
  if (!reveal && !ctx.submitted) return null;
  const autoVariant =
    ctx.earnedScore == null
      ? "neutral"
      : ctx.earnedScore >= (ctx.question.pass_score ?? ctx.totalScore)
        ? "pass"
        : ctx.earnedScore > 0
          ? "partial"
          : "fail";
  const variantStyle: CSSProperties =
    (variant ?? autoVariant) === "pass"
      ? { backgroundColor: "#ecfdf5", color: "#166534", border: "1px solid #86efac" }
      : (variant ?? autoVariant) === "fail"
        ? { backgroundColor: "#fef2f2", color: "#991b1b", border: "1px solid #fca5a5" }
        : (variant ?? autoVariant) === "partial"
          ? { backgroundColor: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d" }
          : { backgroundColor: "#f8fafc", color: "#334155", border: "1px solid #e2e8f0" };

  return (
    <div
      id={id}
      className={className}
      style={{ ...QUIZ_FEEDBACK_DEFAULT_STYLE, ...variantStyle, ...style }}
      data-quiz-slot="feedback"
      data-variant={variant ?? autoVariant}
      role="status"
      aria-live="polite"
    >
      {children}
      {ctx.feedback ? <div data-quiz-slot="feedback-message">{ctx.feedback}</div> : null}
    </div>
  );
};
