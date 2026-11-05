// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auto-fill missing dynamic text slots in agent-authored quiz layouts.
 *
 * Agents often emit empty `<QuizTitle />`, self-closing `<p />`, or button tags
 * without labels. The runtime only substitutes `question.title` / `explanation`
 * through `{$title}` / `{$explanation}` interp nodes — literal placeholders and
 * empty shells render as blank. This pass repairs common omissions at CLI write
 * time and returns human-readable fix notes for the caller. Button labels are
 * filled in the courseware content language (`scene.metadata.language`).
 */

import type { ContentLanguage } from "./content-language.ts";
import type { QuizAstNode, QuizInterpKey, QuizTag } from "./quiz-ast.ts";
import { isQuizFunctionalTag, type QuizFunctionalTag } from "./quiz-ast.ts";
import { getDefaultQuizActionButtonLabels } from "./quiz-default-asts.ts";

export type QuizAstInterpFillResult = {
  ast: QuizAstNode;
  layout_interp_fixes: string[];
};

const interp = (key: QuizInterpKey): QuizAstNode => ({ kind: "interp", key });
const textNode = (text: string): QuizAstNode => ({ kind: "text", text });

const subtreeHasInterp = (node: QuizAstNode, key: QuizInterpKey): boolean => {
  if (node.kind === "interp") return node.key === key;
  if (node.kind === "text") return false;
  return node.children.some((child) => subtreeHasInterp(child, key));
};

const subtreeHasInlineQuizInput = (node: QuizAstNode): boolean => {
  if (node.kind === "element" && node.tag === "QuizInput" && node.props.inline === true) {
    return true;
  }
  if (node.kind === "text" || node.kind === "interp") return false;
  return node.children.some(subtreeHasInlineQuizInput);
};

const isWhitespaceOnlyChildren = (children: QuizAstNode[]): boolean =>
  children.every((child) => child.kind === "text" && child.text.trim() === "");

type ButtonDefaultLabels = Partial<Record<QuizFunctionalTag, string>>;

const patchChildren = (
  children: QuizAstNode[],
  fixes: string[],
  buttonLabels: ButtonDefaultLabels,
): QuizAstNode[] => children.map((child) => patchQuizAstInterpSlotsNode(child, fixes, buttonLabels));

const patchQuizAstInterpSlotsNode = (
  node: QuizAstNode,
  fixes: string[],
  buttonLabels: ButtonDefaultLabels,
): QuizAstNode => {
  if (node.kind === "text" || node.kind === "interp") return node;
  if (node.kind === "stateBranch") {
    return { ...node, children: patchChildren(node.children, fixes, buttonLabels) };
  }

  let children = patchChildren(node.children, fixes, buttonLabels);
  const tag = node.tag;

  if (isQuizFunctionalTag(tag)) {
    const defaultLabel = buttonLabels[tag as QuizFunctionalTag];
    if (defaultLabel && children.length === 0) {
      fixes.push(`<${tag}> had no label — defaulted to "${defaultLabel}"`);
      children = [textNode(defaultLabel)];
    }
  }

  if (tag === "QuizTitle") {
    const hasTitleInterp = subtreeHasInterp({ ...node, children }, "title");
    const hasInlineInput = subtreeHasInlineQuizInput({ ...node, children });
    if (!hasTitleInterp && !hasInlineInput && isWhitespaceOnlyChildren(children)) {
      fixes.push("<QuizTitle> was empty — injected {$title}");
      children = [interp("title")];
    }
  }

  if (tag === "QuizExplanation") {
    const probe: QuizAstNode = { ...node, children };
    if (!subtreeHasInterp(probe, "explanation")) {
      const emptyParagraph = children.find(
        (child): child is Extract<QuizAstNode, { kind: "element" }> =>
          child.kind === "element" && child.tag === "p" && isWhitespaceOnlyChildren(child.children),
      );
      if (emptyParagraph) {
        fixes.push("<QuizExplanation><p> was empty — injected {$explanation}");
        children = children.map((child) =>
          child === emptyParagraph
            ? { ...emptyParagraph, children: [interp("explanation")] }
            : child,
        );
      } else if (isWhitespaceOnlyChildren(children)) {
        fixes.push("<QuizExplanation> was empty — injected <p>{$explanation}</p>");
        children = [
          {
            kind: "element",
            tag: "p" as QuizTag,
            props: {},
            children: [interp("explanation")],
          },
        ];
      }
    }
  }

  return { kind: "element", tag, props: node.props, children };
};

/**
 * Repair empty title/explanation/button shells; idempotent when slots already exist.
 * `language` selects the default button copy (zh / en / ja) — resolve it from the
 * scene first, there is no fallback.
 */
export const ensureQuizAstInterpSlots = (
  layout: QuizAstNode,
  language: ContentLanguage,
): QuizAstInterpFillResult => {
  const fixes: string[] = [];
  return {
    ast: patchQuizAstInterpSlotsNode(layout, fixes, getDefaultQuizActionButtonLabels(language)),
    layout_interp_fixes: fixes,
  };
};

/** Inspect a layout for missing dynamic slots (post-repair diagnostics / quiz get). */
export const inspectQuizAstInterpSlots = (
  layout: QuizAstNode,
): {
  has_title_interp: boolean;
  has_explanation_interp: boolean;
  missing_slots: string[];
} => {
  const has_title_interp = subtreeHasInterp(layout, "title");
  const has_explanation_interp = subtreeHasInterp(layout, "explanation");
  const missing_slots: string[] = [];
  if (!has_title_interp && !subtreeHasInlineQuizInput(layout)) {
    missing_slots.push("title");
  }
  if (!has_explanation_interp) {
    missing_slots.push("explanation");
  }
  return { has_title_interp, has_explanation_interp, missing_slots };
};
