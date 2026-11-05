// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auto-fill missing dynamic slots in score-summary layouts at CLI write time.
 *
 * Agents often emit self-closing `<QuizGradeLabel />` / `<QuizGradeDescription />`.
 * Runtime components can fall back to snapshot data, but injecting {$grade_label}
 * into the AST keeps editor diagnostics and custom styling predictable.
 */

import type { QuizScoreSummaryAstNode, QuizScoreSummaryInterpKey } from "./quiz-score-summary-ast.ts";
import { isQuizScoreSummaryFunctionalTag } from "./quiz-score-summary-ast.ts";

export type ScoreSummaryAstInterpFillResult = {
  ast: QuizScoreSummaryAstNode;
  layout_interp_fixes: string[];
};

const interp = (key: QuizScoreSummaryInterpKey): QuizScoreSummaryAstNode => ({ kind: "interp", key });

const isWhitespaceOnlyChildren = (children: QuizScoreSummaryAstNode[]): boolean =>
  children.every((child) => child.kind === "text" && child.text.trim() === "");

const subtreeHasInterp = (
  node: QuizScoreSummaryAstNode,
  key: QuizScoreSummaryInterpKey,
): boolean => {
  if (node.kind === "interp") return node.key === key;
  if (node.kind === "text") return false;
  return node.children.some((child) => subtreeHasInterp(child, key));
};

const GRADE_SLOT_BY_TAG = {
  QuizGradeLabel: "grade_label",
  QuizGradeDescription: "grade_description",
} as const satisfies Record<string, QuizScoreSummaryInterpKey>;

const patchNode = (node: QuizScoreSummaryAstNode, fixes: string[]): QuizScoreSummaryAstNode => {
  if (node.kind === "text" || node.kind === "interp") return node;

  let children = node.children.map((child) => patchNode(child, fixes));
  if (node.kind === "element" && isQuizScoreSummaryFunctionalTag(node.tag)) {
    const slotKey = GRADE_SLOT_BY_TAG[node.tag as keyof typeof GRADE_SLOT_BY_TAG];
    if (slotKey) {
      const probe: QuizScoreSummaryAstNode = { ...node, children };
      if (!subtreeHasInterp(probe, slotKey) && isWhitespaceOnlyChildren(children)) {
        fixes.push(`<${node.tag}> was empty — injected {$${slotKey}}`);
        children = [interp(slotKey)];
      }
    }
  }

  return { ...node, children };
};

export const ensureScoreSummaryAstInterpSlots = (
  layout: QuizScoreSummaryAstNode,
): ScoreSummaryAstInterpFillResult => {
  const fixes: string[] = [];
  return {
    ast: patchNode(layout, fixes),
    layout_interp_fixes: fixes,
  };
};

export const inspectScoreSummaryAstInterpSlots = (
  layout: QuizScoreSummaryAstNode,
): {
  present_keys: QuizScoreSummaryInterpKey[];
  missing_recommended: QuizScoreSummaryInterpKey[];
} => {
  const recommended: QuizScoreSummaryInterpKey[] = [
    "total_score",
    "grade_label",
    "grade_description",
    "answered_count",
    "question_count",
  ];
  const present = new Set<QuizScoreSummaryInterpKey>();
  const walk = (node: QuizScoreSummaryAstNode): void => {
    if (node.kind === "interp") {
      present.add(node.key);
      return;
    }
    if (node.kind === "element") {
      for (const child of node.children) walk(child);
    }
  };
  walk(layout);
  return {
    present_keys: [...present].sort(),
    missing_recommended: recommended.filter((key) => !present.has(key)),
  };
};
