// SPDX-License-Identifier: AGPL-3.0-only
import type { QuizAstNode, QuizAstPropValue } from "@ainobi/courseware-core/quiz-ast.ts";
import { QUIZ_STATE_VIEW_TAG } from "@ainobi/courseware-core/quiz-state-branches.ts";

/**
 * Quiz AST → JSX (the subset {@link parseQuizJsx} accepts), so an agent can read an
 * existing question's layout, copy or edit it, and write it back with `--jsx-file`.
 * Prod: agents had no way to read `react_layout` and re-invented layouts by guessing.
 * Callers round-trip the result through the parser to tell whether it is lossless.
 */

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const quote = (value: string): string =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;

const printObject = (value: Record<string, string | number>): string => {
  const entries = Object.entries(value).map(
    ([key, item]) => `${IDENT_RE.test(key) ? key : quote(key)}: ${typeof item === "number" ? String(item) : quote(String(item))}`,
  );
  return entries.length === 0 ? "{{}}" : `{{ ${entries.join(", ")} }}`;
};

const printProp = (name: string, value: QuizAstPropValue): string => {
  if (value === true) return name;
  if (value === false) return `${name}={false}`;
  if (typeof value === "number") return `${name}={${value}}`;
  if (typeof value === "string") return `${name}=${quote(value)}`;
  return `${name}=${printObject(value)}`;
};

const printProps = (props: Record<string, QuizAstPropValue>): string =>
  Object.entries(props)
    .map(([name, value]) => ` ${printProp(name, value)}`)
    .join("");

const printNode = (node: QuizAstNode, depth: number): string[] => {
  const pad = "  ".repeat(depth);
  if (node.kind === "text") return [`${pad}${node.text}`];
  if (node.kind === "interp") return [`${pad}{$${node.key}}`];
  const tag = node.kind === "stateBranch" ? QUIZ_STATE_VIEW_TAG : node.tag;
  const props =
    node.kind === "stateBranch" ? printProps({ when: node.when, ...node.props }) : printProps(node.props);
  if (node.children.length === 0) return [`${pad}<${tag}${props} />`];
  return [
    `${pad}<${tag}${props}>`,
    ...node.children.flatMap((child) => printNode(child, depth + 1)),
    `${pad}</${tag}>`,
  ];
};

export const quizAstToJsx = (root: QuizAstNode): string => printNode(root, 0).join("\n");
