// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, type CSSProperties, type ReactNode } from "react";

import type { QuizAstNode, QuizAstPropValue } from "@ainobi/courseware-core/quiz-ast.ts";
import {
  isStateBranchNode,
  resolveStateBranchContent,
  type QuizStateBranchWhen,
} from "@ainobi/courseware-core/quiz-state-branches.ts";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import { QuizShadowingControl } from "./QuizShadowingControl.tsx";
import { normalizeQuizAstStyle } from "./quiz-style-allowlist.ts";

type ShadowingAstNode = Extract<QuizAstNode, { kind: "element" }> & {
  tag: "QuizShadowingControl";
};

const propsForShadowingRender = (
  raw: Record<string, QuizAstPropValue>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "style" || key === "recordingStyle") {
      out[key] = normalizeQuizAstStyle(value);
      continue;
    }
    out[key] = value;
  }
  return out;
};

const resolveShadowingActiveWhen = (
  name: string,
  ctx: ReturnType<typeof useQuizFormContext>,
): QuizStateBranchWhen<"QuizShadowingControl"> => {
  const submitted = ctx?.submitted ?? false;
  const recording = ctx?.recordingFieldName === name;
  const disabled = !ctx || submitted || !ctx.onToggleRecord;
  if (submitted) return "submitted";
  if (disabled) return "disabled";
  if (recording) return "recording";
  return "idle";
};

export interface QuizShadowingControlAstProps {
  node: ShadowingAstNode;
  renderChildren: (children: QuizAstNode[]) => ReactNode;
}

/**
 * Renders {@link QuizShadowingControl} from AST, resolving
 * {@code <QuizStateView when="…">} branches when present.
 */
export const QuizShadowingControlAst = ({
  node,
  renderChildren,
}: QuizShadowingControlAstProps) => {
  const ctx = useQuizFormContext();
  const name = typeof node.props.name === "string" ? node.props.name : "recording";
  const props = propsForShadowingRender(node.props);
  const hasBranches = node.children.some(isStateBranchNode);

  if (!hasBranches) {
    return createElement(QuizShadowingControl, props, renderChildren(node.children));
  }

  const activeWhen = resolveShadowingActiveWhen(name, ctx);
  const { hostStyle, contentNodes } = resolveStateBranchContent(node.children, activeWhen);

  if (hostStyle && Object.keys(hostStyle).length > 0) {
    if (activeWhen === "recording") {
      props.recordingStyle = {
        ...(props.recordingStyle as CSSProperties | undefined),
        ...hostStyle,
      };
    } else {
      props.style = {
        ...(props.style as CSSProperties | undefined),
        ...hostStyle,
      };
    }
  }

  return createElement(QuizShadowingControl, props, renderChildren(contentNodes));
};
