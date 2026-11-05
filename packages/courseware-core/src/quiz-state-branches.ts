// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Declarative runtime state branches for quiz functional components.
 *
 * Authors wrap alternate markup in `<QuizStateView when="…">` inside a stateful
 * host (e.g. `QuizShadowingControl`). At render time the host picks the branch
 * whose `when` matches the current interaction state and merges optional branch
 * `style` onto the host chrome.
 */

// @ts-ignore
import type { Properties } from "csstype";

/** React's CSSProperties is csstype's Properties<string | number>; the engine stays React-free. */
type CSSProperties = Properties<string | number>;

import type { QuizAstNode, QuizAstPropValue, QuizFunctionalTag } from "./quiz-ast.ts";
import { sanitizeQuizAstStyleObject } from "./quiz-ast.ts";

/** JSX tag parsed into {@link QuizAstStateBranchNode} (`kind: "stateBranch"`). */
export const QUIZ_STATE_VIEW_TAG = "QuizStateView";

/** Host tags that may contain {@link QuizAstStateBranchNode} children. */
export const QUIZ_STATE_BRANCH_HOSTS = {
  QuizShadowingControl: ["idle", "recording", "disabled", "submitted"] as const,
} as const;

export type QuizStateBranchHostTag = keyof typeof QUIZ_STATE_BRANCH_HOSTS;

export type QuizStateBranchWhen<T extends QuizStateBranchHostTag> =
  (typeof QUIZ_STATE_BRANCH_HOSTS)[T][number];

export const isQuizStateBranchHostTag = (tag: string): tag is QuizStateBranchHostTag =>
  tag in QUIZ_STATE_BRANCH_HOSTS;

export const isAllowedStateBranchWhen = (
  hostTag: QuizStateBranchHostTag,
  when: string,
): boolean =>
  (QUIZ_STATE_BRANCH_HOSTS[hostTag] as readonly string[]).includes(when);

export type QuizAstStateBranchNode = {
  kind: "stateBranch";
  when: string;
  props: Record<string, QuizAstPropValue>;
  children: QuizAstNode[];
};

export const isStateBranchNode = (node: QuizAstNode): node is QuizAstStateBranchNode =>
  node.kind === "stateBranch";

export interface ResolvedStateBranchContent {
  /** Optional host chrome overlay from the active branch's `style`. */
  hostStyle?: CSSProperties;
  /** AST nodes to render inside the host for the active branch. */
  contentNodes: QuizAstNode[];
}

const branchHostStyle = (props: Record<string, QuizAstPropValue>): CSSProperties | undefined => {
  const raw = props.style;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const cleaned = sanitizeQuizAstStyleObject(raw as Record<string, unknown>);
  if (Object.keys(cleaned).length === 0) return undefined;
  return cleaned as CSSProperties;
};

/**
 * Partition host children into state branches vs legacy unbranched content.
 * Legacy nodes (no `QuizStateView`) are treated as `idle` content.
 */
export const resolveStateBranchContent = (
  children: readonly QuizAstNode[],
  activeWhen: string,
): ResolvedStateBranchContent => {
  const branches = new Map<string, { props: Record<string, QuizAstPropValue>; nodes: QuizAstNode[] }>();
  const legacy: QuizAstNode[] = [];

  for (const child of children) {
    if (isStateBranchNode(child)) {
      branches.set(child.when, { props: child.props, nodes: child.children });
    } else {
      legacy.push(child);
    }
  }

  const active = branches.get(activeWhen);
  if (active) {
    return {
      hostStyle: branchHostStyle(active.props),
      contentNodes: active.nodes,
    };
  }

  if (activeWhen === "idle" && legacy.length > 0) {
    return { contentNodes: legacy };
  }

  const idle = branches.get("idle");
  if (idle) {
    return {
      hostStyle: branchHostStyle(idle.props),
      contentNodes: idle.nodes,
    };
  }

  return { contentNodes: legacy };
};

/** Collect duplicate / invalid `when` values among direct child branches. */
export const validateStateBranchChildren = (
  hostTag: QuizFunctionalTag,
  children: readonly QuizAstNode[],
): string[] => {
  const issues: string[] = [];
  if (!isQuizStateBranchHostTag(hostTag)) {
    for (const child of children) {
      if (isStateBranchNode(child)) {
        issues.push(
          `<QuizStateView> is not allowed inside <${hostTag}>; supported hosts: ${Object.keys(QUIZ_STATE_BRANCH_HOSTS).join(", ")}`,
        );
      }
    }
    return issues;
  }

  const seen = new Set<string>();
  for (const child of children) {
    if (!isStateBranchNode(child)) continue;
    if (!isAllowedStateBranchWhen(hostTag, child.when)) {
      issues.push(
        `<QuizStateView when="${child.when}"> is not allowed on <${hostTag}>; allowed: ${QUIZ_STATE_BRANCH_HOSTS[hostTag].join(", ")}`,
      );
    }
    if (seen.has(child.when)) {
      issues.push(`duplicate <QuizStateView when="${child.when}"> under <${hostTag}>`);
    }
    seen.add(child.when);
  }
  return issues;
};
