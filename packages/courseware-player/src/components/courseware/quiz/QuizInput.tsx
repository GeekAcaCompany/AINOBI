// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, type CSSProperties } from "react";

import { inlineBlankInputStyleForBlank } from "@ainobi/courseware-core/quiz-fill-blank-title.ts";

import { useQuizFormContext } from "./QuizFormContext.tsx";

export interface QuizInputProps {
  /**
   * For fill_blank: must be a `blanks[].blank_id`. For essay/speech: any
   * stable identifier (the CLI default uses `"answer"`).
   */
  name: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "search" | "url";
  autoComplete?: string;
  /** Fill-blank inline blank: underline only, no box chrome. */
  inline?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/**
 * Controlled single-line input bound to the quiz form context. Used by
 * fill_blank, essay (rare; prefer `<QuizTextarea>`) and speech (transcription).
 */
export const QuizInput = ({
  name,
  placeholder,
  inputMode,
  autoComplete,
  disabled,
  inline = false,
  className,
  style,
  id,
}: QuizInputProps) => {
  const ctx = useQuizFormContext();
  const value = ctx?.getInputValue(name) ?? "";
  const submitted = ctx?.submitted ?? false;
  const blankSizingStyle = useMemo((): CSSProperties => {
    if (!inline || !ctx || ctx.question.type !== "fill_blank") return {};
    const blank = ctx.question.blanks.find((b) => b.blank_id === name);
    if (!blank) return {};
    return inlineBlankInputStyleForBlank(blank) as CSSProperties;
  }, [inline, ctx, name]);
  const inlineStyle: CSSProperties = inline
    ? {
        display: "inline-block",
        verticalAlign: "baseline",
        maxWidth: "100%",
        padding: "0 2px",
        margin: "0 1px",
        border: "none",
        borderBottom: "2px solid currentColor",
        borderRadius: 0,
        outline: "none",
        boxShadow: "none",
        background: "transparent",
        backgroundColor: "transparent",
        textAlign: "center",
        ...style,
        ...blankSizingStyle,
      }
    : (style ?? {});
  return (
    <input
      type="text"
      id={id}
      className={className}
      style={inlineStyle}
      name={name}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete={autoComplete ?? "off"}
      disabled={disabled || !ctx || submitted}
      readOnly={submitted}
      value={value}
      data-quiz-input={name}
      data-quiz-submitted={submitted ? "true" : "false"}
      onChange={(event) => ctx?.setInputValue(name, event.target.value)}
    />
  );
};
