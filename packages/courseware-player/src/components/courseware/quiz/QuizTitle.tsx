// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from "react";

export interface QuizTitleProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

/**
 * The question stem. Carries no behavior — pure layout slot. Agents may put
 * literal text, interpolations (`{$title}`), media, or inline `<QuizInput>`
 * for fill-blank inline blanks inside.
 */
export const QuizTitle = ({ className, style, id, children }: QuizTitleProps) => (
  <div
    className={className}
    style={{ whiteSpace: "pre-line", ...style }}
    id={id}
    data-quiz-slot="title"
  >
    {children}
  </div>
);
