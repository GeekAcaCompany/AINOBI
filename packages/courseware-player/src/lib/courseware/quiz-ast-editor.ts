// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Quiz layout AST editor helpers — path-addressable, immutable mutations for the
 * visual layout editor modal.
 *
 * Design notes:
 * - A *path* is a stable address from the root `QuizContainer`, e.g.
 *   `children[2].children[0]`. The empty string addresses the root container.
 * - All structural mutations return the *new path* of the affected node so the
 *   caller can keep its selection in sync (this is what fixes "move up/down
 *   acts on the wrong node").
 * - Every write should funnel through {@link applyQuizLayoutAstMutation} so that
 *   `normalizeQuizAst` + `validateQuizAst` run before the change is accepted.
 * - Text editing operates on a *single* `text` node. Interp nodes (`{$title}`)
 *   are bound to question fields and are never edited as raw text here.
 */

import type { QuizQuestion } from "@ainobi/courseware-core/quiz.ts";
import {
  isQuizFunctionalTag,
  isQuizHtmlTag,
  normalizeQuizAst,
  sanitizeQuizAstStyleObject,
  validateQuizAst,
  type QuizAstNode,
  type QuizAstValidationIssue,
  type QuizFunctionalTag,
  type QuizInterpKey,
} from "@ainobi/courseware-core/quiz-ast.ts";

/** Stable path from root `QuizContainer` (empty string = root). */
export type QuizAstPath = string;

export type QuizAstNodeRole =
  | "root"
  | "decorative"
  | "functional_locked"
  | "functional_style"
  | "text_editable"
  | "interp_field"
  | "interp_locked"
  | "state_branch";

/** Functional tags whose structure is load-bearing — style only, never delete/reorder freely. */
const LOCKED_FUNCTIONAL_TAGS = new Set<QuizFunctionalTag>([
  "QuizContainer",
  "QuizSubmitButton",
  "QuizOptionGroup",
  "QuizInput",
  "QuizTextarea",
  "QuizShadowingControl",
  "QuizReferenceAudio",
  "QuizRecordingTimer",
  "QuizRecordingPlayback",
  "QuizMedia",
]);

/** Functional tags whose `style` is safe to tweak (no structural impact). */
const STYLE_EDITABLE_FUNCTIONAL_TAGS = new Set<QuizFunctionalTag>([
  "QuizTitle",
  "QuizOption",
  "QuizExplanation",
  "QuizFeedback",
  "QuizScore",
  "QuizSkipButton",
  "QuizResubmitButton",
  "QuizContinueButton",
]);

/** Interp keys that map to an editable question text field. */
export type QuizInterpEditableField = "title" | "explanation" | "reference_text";

export const quizInterpEditableField = (
  key: QuizInterpKey,
): QuizInterpEditableField | null => {
  if (key === "title" || key === "explanation" || key === "reference_text") return key;
  return null;
};

const PATH_CHILDREN_RE = /children\[(\d+)\]/g;

export const parseQuizAstPath = (path: QuizAstPath): number[] => {
  if (!path) return [];
  const indices: number[] = [];
  let match: RegExpExecArray | null;
  PATH_CHILDREN_RE.lastIndex = 0;
  while ((match = PATH_CHILDREN_RE.exec(path)) !== null) {
    indices.push(Number(match[1]));
  }
  return indices;
};

const joinIndices = (indices: number[]): QuizAstPath =>
  indices.map((i) => `children[${i}]`).join(".");

export const joinQuizAstPath = (parentPath: QuizAstPath, childIndex: number): QuizAstPath => {
  const seg = `children[${childIndex}]`;
  return parentPath ? `${parentPath}.${seg}` : seg;
};

const deepCloneNode = (node: QuizAstNode): QuizAstNode => {
  if (node.kind === "text") return { kind: "text", text: node.text };
  if (node.kind === "interp") return { kind: "interp", key: node.key };
  if (node.kind === "stateBranch") {
    return {
      kind: "stateBranch",
      when: node.when,
      props: { ...node.props },
      children: node.children.map(deepCloneNode),
    };
  }
  return {
    kind: "element",
    tag: node.tag,
    props: { ...node.props },
    children: node.children.map(deepCloneNode),
  };
};

const nodeHasChildren = (
  node: QuizAstNode,
): node is Extract<QuizAstNode, { kind: "element" | "stateBranch" }> =>
  node.kind === "element" || node.kind === "stateBranch";

export const getQuizAstNodeAtPath = (
  root: QuizAstNode,
  path: QuizAstPath,
): QuizAstNode | null => {
  if (!path) return root;
  let current: QuizAstNode = root;
  for (const index of parseQuizAstPath(path)) {
    if (!nodeHasChildren(current)) return null;
    const next = current.children[index];
    if (!next) return null;
    current = next;
  }
  return current;
};

export interface QuizAstParentInfo {
  parent: Extract<QuizAstNode, { kind: "element" | "stateBranch" }>;
  childIndex: number;
  parentPath: QuizAstPath;
  siblingCount: number;
}

export const getQuizAstParentInfo = (
  root: QuizAstNode,
  path: QuizAstPath,
): QuizAstParentInfo | null => {
  const indices = parseQuizAstPath(path);
  if (indices.length === 0) return null;
  const childIndex = indices[indices.length - 1]!;
  const parentPath = indices.length === 1 ? "" : joinIndices(indices.slice(0, -1));
  const parent = getQuizAstNodeAtPath(root, parentPath);
  if (!parent || !nodeHasChildren(parent)) return null;
  return { parent, childIndex, parentPath, siblingCount: parent.children.length };
};

/** Immutably replace the node at `path` (cloning only along the touched spine). */
export const updateQuizAstNodeAtPath = (
  root: QuizAstNode,
  path: QuizAstPath,
  updater: (node: QuizAstNode) => QuizAstNode,
): QuizAstNode => {
  const indices = parseQuizAstPath(path);
  const visit = (node: QuizAstNode, depth: number): QuizAstNode => {
    if (depth === indices.length) return updater(deepCloneNode(node));
    if (!nodeHasChildren(node)) return node;
    const idx = indices[depth]!;
    const child = node.children[idx];
    if (!child) return node;
    const nextChildren = [...node.children];
    nextChildren[idx] = visit(child, depth + 1);
    return { ...node, children: nextChildren } as QuizAstNode;
  };
  return visit(root, 0);
};

/** Replace a single `text` node's content. No-op on non-text nodes. */
export const setQuizAstTextAtPath = (
  root: QuizAstNode,
  path: QuizAstPath,
  text: string,
): QuizAstNode =>
  updateQuizAstNodeAtPath(root, path, (node) => {
    if (node.kind !== "text") return node;
    return { kind: "text", text };
  });

const styleRecordOf = (node: QuizAstNode): Record<string, string | number> => {
  if (node.kind !== "element" && node.kind !== "stateBranch") return {};
  const style = node.props.style;
  if (style && typeof style === "object" && !Array.isArray(style)) {
    return { ...(style as Record<string, string | number>) };
  }
  return {};
};

export const getQuizAstStyleRecord = styleRecordOf;

/** Merge a partial style patch into the node at `path` (sanitized). */
export const patchQuizAstStyleAtPath = (
  root: QuizAstNode,
  path: QuizAstPath,
  patch: Record<string, string | number>,
): QuizAstNode =>
  updateQuizAstNodeAtPath(root, path, (node) => {
    if (node.kind !== "element" && node.kind !== "stateBranch") return node;
    const merged = sanitizeQuizAstStyleObject({ ...styleRecordOf(node), ...patch });
    return { ...node, props: { ...node.props, style: merged } };
  });

/** Remove a single style key from the node at `path`. */
export const removeQuizAstStyleKeyAtPath = (
  root: QuizAstNode,
  path: QuizAstPath,
  key: string,
): QuizAstNode =>
  updateQuizAstNodeAtPath(root, path, (node) => {
    if (node.kind !== "element" && node.kind !== "stateBranch") return node;
    const next = styleRecordOf(node);
    delete next[key];
    return { ...node, props: { ...node.props, style: sanitizeQuizAstStyleObject(next) } };
  });

const subtreeContainsFunctionalTag = (node: QuizAstNode): boolean => {
  if (node.kind === "element" && isQuizFunctionalTag(node.tag)) return true;
  if (!nodeHasChildren(node)) return false;
  return node.children.some(subtreeContainsFunctionalTag);
};

export const classifyQuizAstNodeRole = (
  node: QuizAstNode,
  path: QuizAstPath,
): QuizAstNodeRole => {
  if (!path) return "root";
  if (node.kind === "stateBranch") return "state_branch";
  if (node.kind === "interp") {
    return quizInterpEditableField(node.key) ? "interp_field" : "interp_locked";
  }
  if (node.kind === "text") return "text_editable";
  if (node.kind !== "element") return "functional_locked";
  if (isQuizHtmlTag(node.tag)) return "decorative";
  if (LOCKED_FUNCTIONAL_TAGS.has(node.tag as QuizFunctionalTag)) return "functional_locked";
  if (STYLE_EDITABLE_FUNCTIONAL_TAGS.has(node.tag as QuizFunctionalTag)) return "functional_style";
  return "functional_locked";
};

/** Whether the node can carry a `style` object (element / stateBranch). */
export const quizAstNodeSupportsStyle = (node: QuizAstNode): boolean =>
  node.kind === "element" || node.kind === "stateBranch";

export const canDeleteQuizAstNode = (root: QuizAstNode, path: QuizAstPath): boolean => {
  if (!path) return false;
  const node = getQuizAstNodeAtPath(root, path);
  if (!node) return false;
  if (classifyQuizAstNodeRole(node, path) !== "decorative") return false;
  if (subtreeContainsFunctionalTag(node)) return false;
  return true;
};

/** Collapse upward from the current selection path to a resizable (style) node. */
export const resolveQuizAstResizePath = (
  root: QuizAstNode,
  path: QuizAstPath,
): QuizAstPath | null => {
  if (!path) return null;
  let current: QuizAstPath = path;
  for (;;) {
    const node = getQuizAstNodeAtPath(root, current);
    if (!node) return null;
    if (quizAstNodeSupportsStyle(node)) {
      const role = classifyQuizAstNodeRole(node, current);
      if (
        role === "decorative" ||
        role === "functional_style" ||
        role === "functional_locked" ||
        role === "state_branch"
      ) {
        return current;
      }
    }
    const info = getQuizAstParentInfo(root, current);
    if (!info || info.parentPath === "") return null;
    current = info.parentPath;
  }
};

/** Collapse upward from the current selection path to a deletable decorative node (similar to drag-and-drop path resolution). */
export const resolveQuizAstDeletePath = (
  root: QuizAstNode,
  path: QuizAstPath,
): QuizAstPath | null => {
  if (!path) return null;
  let current: QuizAstPath = path;
  for (;;) {
    if (canDeleteQuizAstNode(root, current)) return current;
    const info = getQuizAstParentInfo(root, current);
    if (!info || info.parentPath === "") return null;
    current = info.parentPath;
  }
};

/**
 * AST paths allowed to move as a whole in layout drag and drop.
 * Decorative HTML / text / interpolations inside functional components collapse upward to the outer functional block (e.g. a whole QuizExplanation).
 * Layout blocks directly under the root container (such as a row div) can be drag units.
 */
export const resolveQuizAstDragPath = (
  root: QuizAstNode,
  path: QuizAstPath,
): QuizAstPath | null => {
  if (!path) return null;
  let current = path;
  for (;;) {
    const node = getQuizAstNodeAtPath(root, current);
    if (!node) return null;
    const role = classifyQuizAstNodeRole(node, current);
    if (role === "root") return null;
    if (
      role === "functional_style" ||
      role === "functional_locked" ||
      role === "state_branch"
    ) {
      return current;
    }
    if (role === "decorative") {
      const info = getQuizAstParentInfo(root, current);
      if (!info || info.parentPath === "") return current;
    }
    const info = getQuizAstParentInfo(root, current);
    if (!info) return null;
    current = info.parentPath;
    if (current === "") return null;
  }
};

/**
 * Resolve the text/interpolation path to open on double-click editing (drilling inward from the functional component).
 */
export const resolveQuizAstTextEditPath = (
  root: QuizAstNode,
  hitPath: QuizAstPath,
): QuizAstPath | null => {
  if (!hitPath) return null;
  const node = getQuizAstNodeAtPath(root, hitPath);
  if (!node) return null;
  const role = classifyQuizAstNodeRole(node, hitPath);
  if (role === "text_editable") return hitPath;
  if (role === "interp_field") return hitPath;

  const walk = (current: QuizAstNode, path: QuizAstPath): QuizAstPath | null => {
    if (current.kind === "text") return path;
    if (current.kind === "interp" && quizInterpEditableField(current.key)) return path;
    if (!nodeHasChildren(current)) return null;
    for (let i = 0; i < current.children.length; i += 1) {
      const child = current.children[i]!;
      const childPath = joinQuizAstPath(path, i);
      const childRole = classifyQuizAstNodeRole(child, childPath);
      if (childRole === "text_editable" || childRole === "interp_field") return childPath;
      if (
        childRole === "decorative" ||
        childRole === "functional_style" ||
        childRole === "functional_locked"
      ) {
        const nested = walk(child, childPath);
        if (nested) return nested;
      }
    }
    return null;
  };

  if (
    role === "functional_style" ||
    role === "functional_locked" ||
    role === "decorative"
  ) {
    return walk(node, hitPath);
  }
  return null;
};

/** Hit testing prefers editable text/interpolations (at equal area). */
export const quizAstHitTestAreaWeight = (node: QuizAstNode, path: QuizAstPath): number => {
  const role = classifyQuizAstNodeRole(node, path);
  if (role === "text_editable" || role === "interp_field") return 0.02;
  if (role === "interp_locked") return 0.08;
  if (node.kind === "element" && isQuizHtmlTag(node.tag)) return 0.35;
  if (role === "functional_style" || role === "functional_locked") return 0.55;
  return 1;
};

export const canReorderQuizAstNode = (root: QuizAstNode, path: QuizAstPath): boolean => {
  if (!path) return false;
  const dragPath = resolveQuizAstDragPath(root, path);
  if (!dragPath || dragPath !== path) return false;
  const node = getQuizAstNodeAtPath(root, path);
  return node?.kind === "element";
};

export interface QuizAstStructuralResult {
  layout: QuizAstNode;
  /** New selection path for the affected node (null if it no longer exists). */
  nextPath: QuizAstPath | null;
}

export const removeQuizAstNodeAtPath = (
  root: QuizAstNode,
  path: QuizAstPath,
): QuizAstStructuralResult | null => {
  if (!canDeleteQuizAstNode(root, path)) return null;
  const info = getQuizAstParentInfo(root, path);
  if (!info) return null;
  const layout = updateQuizAstNodeAtPath(root, info.parentPath, (parent) => {
    if (!nodeHasChildren(parent)) return parent;
    return { ...parent, children: parent.children.filter((_, i) => i !== info.childIndex) };
  });
  return { layout, nextPath: info.parentPath || null };
};

/** Move a node among its element siblings by `delta` (selection follows it). */
export const moveQuizAstNodeAtPath = (
  root: QuizAstNode,
  path: QuizAstPath,
  delta: number,
): QuizAstStructuralResult | null => {
  if (!canReorderQuizAstNode(root, path)) return null;
  const info = getQuizAstParentInfo(root, path);
  if (!info) return null;
  const fromIndex = info.childIndex;
  const toIndex = fromIndex + delta;
  if (toIndex < 0 || toIndex >= info.siblingCount) return null;
  const layout = updateQuizAstNodeAtPath(root, info.parentPath, (parent) => {
    if (!nodeHasChildren(parent)) return parent;
    const siblings = [...parent.children];
    const [moved] = siblings.splice(fromIndex, 1);
    if (!moved) return parent;
    siblings.splice(toIndex, 0, moved);
    return { ...parent, children: siblings };
  });
  return { layout, nextPath: joinQuizAstPath(info.parentPath, toIndex) };
};

/** Tags that cannot hold children — never valid drop targets. */
const VOID_HTML_TAGS = new Set(["img", "hr", "br"]);

/**
 * Functional tags that may hold *layout* children (not just label text /
 * interpolations). Buttons, options, inputs, etc. are excluded so the editor
 * inserts *beside* them instead of treating them as nested containers.
 */
const LAYOUT_CONTAINER_FUNCTIONAL_TAGS = new Set<QuizFunctionalTag>([
  "QuizContainer",
  "QuizTitle",
  "QuizOptionGroup",
  "QuizExplanation",
  "QuizFeedback",
  "QuizShadowingControl",
  "QuizMedia",
]);

/** Whether a node can act as a drop container in the layout editor. */
export const isQuizAstDropContainer = (node: QuizAstNode | null): boolean => {
  if (!node) return false;
  if (node.kind === "stateBranch") return true;
  if (node.kind !== "element") return false;
  if (VOID_HTML_TAGS.has(node.tag)) return false;
  if (isQuizHtmlTag(node.tag)) return true;
  if (isQuizFunctionalTag(node.tag)) {
    return LAYOUT_CONTAINER_FUNCTIONAL_TAGS.has(node.tag as QuizFunctionalTag);
  }
  return false;
};

/** Cross-axis alignment of a flex child inside its parent (column parent → horizontal). */
export type QuizAstContainerAlign = "left" | "center" | "right";

export const inferQuizAstContainerAlign = (node: QuizAstNode): QuizAstContainerAlign | null => {
  if (!quizAstNodeSupportsStyle(node)) return null;
  const s = getQuizAstStyleRecord(node);
  const alignSelf = String(s.alignSelf ?? "");
  const ml = String(s.marginLeft ?? "");
  const mr = String(s.marginRight ?? "");
  if (alignSelf === "center" || (ml === "auto" && mr === "auto")) return "center";
  if (alignSelf === "flex-end" || alignSelf === "end" || (ml === "auto" && mr !== "auto")) {
    return "right";
  }
  if (alignSelf === "flex-start" || alignSelf === "start" || alignSelf === "self-start") {
    return "left";
  }
  return null;
};

export const patchQuizAstContainerAlign = (
  root: QuizAstNode,
  path: QuizAstPath,
  align: QuizAstContainerAlign,
): QuizAstNode => {
  const patch: Record<string, string | number> = { alignSelf: "flex-start" };
  if (align === "left") {
    patch.alignSelf = "flex-start";
    patch.marginLeft = 0;
    patch.marginRight = 0;
  } else if (align === "center") {
    patch.alignSelf = "center";
    patch.marginLeft = "auto";
    patch.marginRight = "auto";
  } else {
    patch.alignSelf = "flex-end";
    patch.marginLeft = "auto";
    patch.marginRight = 0;
  }
  return patchQuizAstStyleAtPath(root, path, patch);
};

const isIndexPrefix = (prefix: number[], full: number[]): boolean => {
  if (prefix.length > full.length) return false;
  return prefix.every((v, i) => full[i] === v);
};

const indicesEqual = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => b[i] === v);

const removeChildAt = (root: QuizAstNode, parentPath: QuizAstPath, index: number): QuizAstNode =>
  updateQuizAstNodeAtPath(root, parentPath, (parent) => {
    if (!nodeHasChildren(parent)) return parent;
    return { ...parent, children: parent.children.filter((_, i) => i !== index) };
  });

const insertChildAt = (
  root: QuizAstNode,
  parentPath: QuizAstPath,
  index: number,
  node: QuizAstNode,
): QuizAstNode =>
  updateQuizAstNodeAtPath(root, parentPath, (parent) => {
    if (!nodeHasChildren(parent)) return parent;
    const children = [...parent.children];
    children.splice(index, 0, node);
    return { ...parent, children };
  });

/** Default style for auto-created horizontal button/action rows. */
export const QUIZ_AST_ROW_GROUP_STYLE: Record<string, string | number> = {
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};

export const isQuizAstRowGroup = (node: QuizAstNode | null): boolean => {
  if (!node || node.kind !== "element" || node.tag !== "div") return false;
  const style = getQuizAstStyleRecord(node);
  const display = String(style.display ?? "");
  const dir = String(style.flexDirection ?? "");
  return display.includes("flex") && dir.startsWith("row");
};

export const createQuizAstRowGroup = (children: QuizAstNode[]): QuizAstNode => ({
  kind: "element",
  tag: "div",
  props: { style: sanitizeQuizAstStyleObject({ ...QUIZ_AST_ROW_GROUP_STYLE }) },
  children,
});

export type QuizAstDropPlan =
  | { kind: "container"; parentPath: QuizAstPath; index: number }
  | { kind: "horizontal-buddy"; anchorPath: QuizAstPath; side: "left" | "right" };

/**
 * Place `fromPath` immediately to the left/right of `anchorPath`. When the anchor
 * lives in a column parent, wraps both nodes in a new row `div`. When the anchor
 * is already inside a row group, performs a simple sibling insert.
 */
export const computeQuizAstHorizontalBuddyDrop = (
  root: QuizAstNode,
  question: QuizQuestion,
  fromPath: QuizAstPath,
  anchorPath: QuizAstPath,
  side: "left" | "right",
): { layout: QuizAstNode; nextPath: QuizAstPath } | null => {
  if (!fromPath || !anchorPath || fromPath === anchorPath) return null;
  const fromPathIdx = parseQuizAstPath(fromPath);
  const anchorPathIdx = parseQuizAstPath(anchorPath);
  if (isIndexPrefix(fromPathIdx, anchorPathIdx) || isIndexPrefix(anchorPathIdx, fromPathIdx)) {
    return null;
  }

  const anchorInfo = getQuizAstParentInfo(root, anchorPath);
  const fromInfo = getQuizAstParentInfo(root, fromPath);
  if (!anchorInfo || !fromInfo) return null;

  if (isQuizAstRowGroup(anchorInfo.parent)) {
    const toIndex = side === "right" ? anchorInfo.childIndex + 1 : anchorInfo.childIndex;
    return computeQuizAstMoveToContainer(root, question, fromPath, anchorInfo.parentPath, toIndex);
  }

  const moved = getQuizAstNodeAtPath(root, fromPath);
  if (!moved || moved.kind !== "element") return null;
  const movedClone = deepCloneNode(moved);

  let draft = removeChildAt(root, fromInfo.parentPath, fromInfo.childIndex);

  let anchorIdx = anchorInfo.childIndex;
  if (fromInfo.parentPath === anchorInfo.parentPath && fromInfo.childIndex < anchorIdx) {
    anchorIdx -= 1;
  }

  const anchorParent = getQuizAstNodeAtPath(draft, anchorInfo.parentPath);
  if (!anchorParent || !nodeHasChildren(anchorParent)) return null;
  const anchorNode = anchorParent.children[anchorIdx];
  if (!anchorNode) return null;

  draft = updateQuizAstNodeAtPath(draft, anchorInfo.parentPath, (parent) => {
    if (!nodeHasChildren(parent)) return parent;
    const kids = [...parent.children];
    const anchor = kids[anchorIdx];
    if (!anchor) return parent;
    kids.splice(anchorIdx, 1);
    const row = createQuizAstRowGroup(
      side === "left" ? [movedClone, anchor] : [anchor, movedClone],
    );
    kids.splice(anchorIdx, 0, row);
    return { ...parent, children: kids };
  });

  const normalized = normalizeQuizAst(draft, { fillRootContainer: true });
  const issues = validateQuizAst(normalized, question);
  if (issues.length > 0) return null;

  const movedIdxInRow = side === "left" ? 0 : 1;
  const nextPath = joinQuizAstPath(
    joinQuizAstPath(anchorInfo.parentPath, anchorIdx),
    movedIdxInRow,
  );
  return { layout: normalized, nextPath };
};

/** Apply a drop plan produced by the layout editor hit-testing. */
export const executeQuizAstDrop = (
  root: QuizAstNode,
  question: QuizQuestion,
  fromPath: QuizAstPath,
  plan: QuizAstDropPlan,
): { layout: QuizAstNode; nextPath: QuizAstPath } | null => {
  if (plan.kind === "horizontal-buddy") {
    return computeQuizAstHorizontalBuddyDrop(
      root,
      question,
      fromPath,
      plan.anchorPath,
      plan.side,
    );
  }
  return computeQuizAstMoveToContainer(
    root,
    question,
    fromPath,
    plan.parentPath,
    plan.index,
  );
};

/**
 * Compute the result of dragging the element at `fromPath` into `toParentPath`
 * at `toIndex`. Returns the normalized layout + the dragged node's new path, or
 * `null` when the move is structurally impossible OR fails AST validation
 * (callers use null to render the "cannot drop" / red state).
 */
export const computeQuizAstMoveToContainer = (
  root: QuizAstNode,
  question: QuizQuestion,
  fromPath: QuizAstPath,
  toParentPath: QuizAstPath,
  toIndex: number,
): { layout: QuizAstNode; nextPath: QuizAstPath } | null => {
  if (!fromPath) return null; // root is not draggable
  const node = getQuizAstNodeAtPath(root, fromPath);
  if (!node || node.kind !== "element") return null;
  const targetParent = getQuizAstNodeAtPath(root, toParentPath);
  if (!isQuizAstDropContainer(targetParent) || !targetParent || !nodeHasChildren(targetParent)) {
    return null;
  }

  const fromIdx = parseQuizAstPath(fromPath);
  const toParentIdx = parseQuizAstPath(toParentPath);
  // Cannot drop into itself or any of its descendants.
  if (isIndexPrefix(fromIdx, toParentIdx)) return null;

  const srcParentIdx = fromIdx.slice(0, -1);
  const srcPos = fromIdx[fromIdx.length - 1]!;

  // Removing the source shifts indices of later siblings on the source level.
  const adjToParentIdx = [...toParentIdx];
  if (toParentIdx.length > srcParentIdx.length && isIndexPrefix(srcParentIdx, toParentIdx)) {
    const d = srcParentIdx.length;
    if (toParentIdx[d]! > srcPos) adjToParentIdx[d] = toParentIdx[d]! - 1;
  }
  let adjToIndex = toIndex;
  if (indicesEqual(toParentIdx, srcParentIdx) && toIndex > srcPos) adjToIndex -= 1;

  const srcParentPath = joinIndices(srcParentIdx);
  const removed = removeChildAt(root, srcParentPath, srcPos);

  const adjParentPath = joinIndices(adjToParentIdx);
  const newParent = getQuizAstNodeAtPath(removed, adjParentPath);
  if (!newParent || !nodeHasChildren(newParent)) return null;
  const clampedIndex = Math.max(0, Math.min(adjToIndex, newParent.children.length));

  const inserted = insertChildAt(removed, adjParentPath, clampedIndex, deepCloneNode(node));
  const normalized = normalizeQuizAst(inserted, { fillRootContainer: true });
  const issues = validateQuizAst(normalized, question);
  if (issues.length > 0) return null;
  return { layout: normalized, nextPath: joinQuizAstPath(adjParentPath, clampedIndex) };
};

export interface QuizLayoutAstMutationResult {
  layout: QuizAstNode;
  issues: QuizAstValidationIssue[];
}

/**
 * Run a draft mutation, normalize + validate it, and either accept (issues: [])
 * or reject (returns the original layout plus issues). Returns null when the
 * mutation itself was a no-op (mutate returned null).
 */
export const applyQuizLayoutAstMutation = (
  layout: QuizAstNode,
  question: QuizQuestion,
  mutate: (current: QuizAstNode) => QuizAstNode | null,
): QuizLayoutAstMutationResult | null => {
  const draft = mutate(deepCloneNode(layout));
  if (!draft) return null;
  const normalized = normalizeQuizAst(draft, { fillRootContainer: true });
  const issues = validateQuizAst(normalized, question);
  if (issues.length > 0) return { layout, issues };
  return { layout: normalized, issues: [] };
};

export interface QuizAstPathEntry {
  path: QuizAstPath;
  node: QuizAstNode;
  role: QuizAstNodeRole;
}

/** Depth-first walk emitting editor paths for every node (incl. stateBranch). */
export const walkQuizAstWithPath = (
  root: QuizAstNode,
  visit: (entry: QuizAstPathEntry) => void,
): void => {
  const walk = (node: QuizAstNode, path: QuizAstPath): void => {
    visit({ path, node, role: classifyQuizAstNodeRole(node, path) });
    if (!nodeHasChildren(node)) return;
    node.children.forEach((child, index) => walk(child, joinQuizAstPath(path, index)));
  };
  walk(root, "");
};
