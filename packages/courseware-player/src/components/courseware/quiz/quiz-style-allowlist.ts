// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runtime style sanitization for the quiz AST renderer.
 *
 * The CLI already validates `style={{...}}` against {@link QUIZ_STYLE_ALLOWED_KEYS}
 * at write time, but we re-sanitize on render to defend against malformed
 * scenes loaded from older snapshots, manual edits, or future schema drift.
 */

import {
  QUIZ_STYLE_ALLOWED_KEYS,
  sanitizeQuizAstStyleObject,
} from "@ainobi/courseware-core/quiz-ast.ts";

export { QUIZ_STYLE_ALLOWED_KEYS, sanitizeQuizAstStyleObject };

/** Normalize whatever shape `style` has into a `React.CSSProperties`. */
export const normalizeQuizAstStyle = (raw: unknown): React.CSSProperties | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const cleaned = sanitizeQuizAstStyleObject(raw as Record<string, unknown>);
  if (Object.keys(cleaned).length === 0) return undefined;
  return cleaned as React.CSSProperties;
};
