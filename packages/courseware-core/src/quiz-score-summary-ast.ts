// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Quiz score-summary React Layout AST
 * ===================================
 *
 * Agents author the aggregate score panel as JSX; the CLI parses it once into
 * this whitelist AST stored on `scene.quiz.score_summary.react_layout`. The
 * frontend renders recursively — no runtime JSX parsing.
 */

import {
  QUIZ_HTML_TAGS,
  QUIZ_VOID_HTML_TAGS,
  isQuizHtmlTag,
  sanitizeQuizAstStyleObject,
  type QuizAstPropValue,
  type QuizHtmlTag,
} from "./quiz-ast.ts";

export type { QuizAstPropValue };

// ─── Tag whitelist ──────────────────────────────────────────────────────────

export const QUIZ_SCORE_SUMMARY_FUNCTIONAL_TAGS = [
  "QuizScoreSummaryContainer",
  "QuizTotalScore",
  "QuizGradeLabel",
  "QuizGradeDescription",
] as const;

export type QuizScoreSummaryFunctionalTag = (typeof QUIZ_SCORE_SUMMARY_FUNCTIONAL_TAGS)[number];

export type QuizScoreSummaryTag = QuizScoreSummaryFunctionalTag | QuizHtmlTag;

const FUNCTIONAL_TAG_SET = new Set<string>(QUIZ_SCORE_SUMMARY_FUNCTIONAL_TAGS);

export const isQuizScoreSummaryFunctionalTag = (
  value: string,
): value is QuizScoreSummaryFunctionalTag => FUNCTIONAL_TAG_SET.has(value);

export const isQuizScoreSummaryTag = (value: string): value is QuizScoreSummaryTag =>
  isQuizScoreSummaryFunctionalTag(value) || isQuizHtmlTag(value);

export { QUIZ_HTML_TAGS, QUIZ_VOID_HTML_TAGS, isQuizHtmlTag };

// ─── Interpolation keys ─────────────────────────────────────────────────────

export const QUIZ_SCORE_SUMMARY_INTERP_KEYS = [
  "earned_score",
  "total_score",
  "score",
  "grade_label",
  "grade_description",
  "question_count",
  "answered_count",
] as const;

export type QuizScoreSummaryInterpKey = (typeof QUIZ_SCORE_SUMMARY_INTERP_KEYS)[number];

const INTERP_KEY_SET = new Set<string>(QUIZ_SCORE_SUMMARY_INTERP_KEYS);

export const isQuizScoreSummaryInterpKey = (value: string): value is QuizScoreSummaryInterpKey =>
  INTERP_KEY_SET.has(value);

// ─── AST node types ─────────────────────────────────────────────────────────

export type QuizScoreSummaryAstNode =
  | {
      kind: "element";
      tag: QuizScoreSummaryTag;
      props: Record<string, QuizAstPropValue>;
      children: QuizScoreSummaryAstNode[];
    }
  | { kind: "text"; text: string }
  | { kind: "interp"; key: QuizScoreSummaryInterpKey };

// ─── Prop whitelist ─────────────────────────────────────────────────────────

const COMMON_HTML_PROPS = new Set<string>([
  "className",
  "style",
  "id",
  "role",
  "tabIndex",
  "title",
  "lang",
  "dir",
]);

const IMG_PROPS = new Set<string>(["src", "alt", "width", "height", "loading"]);

const FUNCTIONAL_PROPS: Record<QuizScoreSummaryFunctionalTag, Set<string>> = {
  QuizScoreSummaryContainer: new Set<string>(["padding", "gap"]),
  QuizTotalScore: new Set<string>([]),
  QuizGradeLabel: new Set<string>([]),
  QuizGradeDescription: new Set<string>([]),
};

const isDataOrAriaProp = (key: string): boolean => key.startsWith("data-") || key.startsWith("aria-");

const isOnEventProp = (key: string): boolean => /^on[A-Z]/.test(key);

const propAllowedForTag = (
  tag: QuizScoreSummaryTag,
  key: string,
): boolean => {
  if (COMMON_HTML_PROPS.has(key)) return true;
  if (isDataOrAriaProp(key)) return true;
  if (tag === "img" && IMG_PROPS.has(key)) return true;
  if (isQuizScoreSummaryFunctionalTag(tag) && FUNCTIONAL_PROPS[tag].has(key)) return true;
  return false;
};

// ─── Validation ─────────────────────────────────────────────────────────────

export interface QuizScoreSummaryAstValidationIssue {
  path: string;
  message: string;
}

const pushIssue = (
  issues: QuizScoreSummaryAstValidationIssue[],
  path: string,
  message: string,
): void => {
  issues.push({ path, message });
};

interface ValidationContext {
  counts: Record<QuizScoreSummaryFunctionalTag, number>;
}

const newContext = (): ValidationContext => ({
  counts: {
    QuizScoreSummaryContainer: 0,
    QuizTotalScore: 0,
    QuizGradeLabel: 0,
    QuizGradeDescription: 0,
  },
});

const validateNode = (
  node: QuizScoreSummaryAstNode,
  path: string,
  ctx: ValidationContext,
  issues: QuizScoreSummaryAstValidationIssue[],
): void => {
  if (node.kind === "text") return;
  if (node.kind === "interp") {
    if (!isQuizScoreSummaryInterpKey(node.key)) {
      pushIssue(issues, path, `unknown interpolation key "${node.key}"`);
    }
    return;
  }
  if (node.kind !== "element") return;

  if (!isQuizScoreSummaryTag(node.tag)) {
    pushIssue(issues, path, `unknown tag <${node.tag}>`);
    return;
  }

  if (node.tag === "QuizScoreSummaryContainer" && path !== "react_layout") {
    pushIssue(issues, path, `<QuizScoreSummaryContainer> can only appear at the root`);
  }

  if (isQuizScoreSummaryFunctionalTag(node.tag)) {
    ctx.counts[node.tag] += 1;
  }

  for (const [key, value] of Object.entries(node.props)) {
    if (isOnEventProp(key)) {
      pushIssue(issues, `${path}.props.${key}`, `event props are not allowed`);
      continue;
    }
    if (!propAllowedForTag(node.tag, key)) {
      pushIssue(issues, `${path}.props.${key}`, `prop "${key}" is not allowed on <${node.tag}>`);
      continue;
    }
    if (key === "style" && value && typeof value === "object" && !Array.isArray(value)) {
      node.props.style = sanitizeQuizAstStyleObject(value as Record<string, unknown>);
    }
  }

  if (QUIZ_VOID_HTML_TAGS.has(node.tag as QuizHtmlTag) && node.children.length > 0) {
    pushIssue(issues, path, `<${node.tag}> must not have children`);
    return;
  }

  node.children.forEach((child, index) => {
    validateNode(child, `${path}.children[${index}]`, ctx, issues);
  });
};

export const validateQuizScoreSummaryAst = (
  node: QuizScoreSummaryAstNode,
): QuizScoreSummaryAstValidationIssue[] => {
  const issues: QuizScoreSummaryAstValidationIssue[] = [];
  if (node.kind !== "element" || node.tag !== "QuizScoreSummaryContainer") {
    return [
      {
        path: "react_layout",
        message: "score_summary react_layout root must be <QuizScoreSummaryContainer>",
      },
    ];
  }
  const ctx = newContext();
  validateNode(node, "react_layout", ctx, issues);
  if (ctx.counts.QuizScoreSummaryContainer > 1) {
    pushIssue(issues, "react_layout", `<QuizScoreSummaryContainer> must appear exactly once`);
  }
  return issues;
};

const normalizePropValue = (path: string, value: unknown): QuizAstPropValue => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (path.endsWith(".style") || path.includes(".style.")) {
      return sanitizeQuizAstStyleObject(value as Record<string, unknown>);
    }
    return sanitizeQuizAstStyleObject(value as Record<string, unknown>);
  }
  throw new Error(`${path}: invalid prop value`);
};

/** Complete width/height 100% on the root container, matching the question QuizContainer convention. */
export const normalizeScoreSummaryAst = (
  node: QuizScoreSummaryAstNode,
  options?: { fillRootContainer?: boolean },
): QuizScoreSummaryAstNode => {
  if (node.kind === "text" || node.kind === "interp") return node;
  if (node.kind !== "element") return node;
  let props = { ...node.props };
  if (options?.fillRootContainer && node.tag === "QuizScoreSummaryContainer") {
    const rawStyle = props.style;
    const style =
      rawStyle && typeof rawStyle === "object" && !Array.isArray(rawStyle)
        ? { ...(rawStyle as Record<string, string | number>) }
        : {};
    if (style.width === undefined) style.width = "100%";
    if (style.height === undefined) style.height = "100%";
    props = { ...props, style: sanitizeQuizAstStyleObject(style) };
  }
  const children = node.children.map((child) => normalizeScoreSummaryAst(child, options));
  return { ...node, props, children };
};

/** CLI / Agent: deserialize JSON into a score-summary AST. */
export const parseScoreSummaryAstFromJson = (
  input: unknown,
  path = "react_layout",
): QuizScoreSummaryAstNode => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${path}: expected an object`);
  }
  const node = input as Record<string, unknown>;
  const kind = node.kind;
  if (kind === "text") {
    if (typeof node.text !== "string") {
      throw new Error(`${path}: text node must have a string \`text\``);
    }
    return { kind: "text", text: node.text };
  }
  if (kind === "interp") {
    if (typeof node.key !== "string" || !isQuizScoreSummaryInterpKey(node.key)) {
      throw new Error(
        `${path}: interp node \`key\` must be one of ${QUIZ_SCORE_SUMMARY_INTERP_KEYS.join(", ")}`,
      );
    }
    return { kind: "interp", key: node.key };
  }
  if (kind !== "element") {
    throw new Error(`${path}: unknown kind "${String(kind)}"`);
  }
  if (typeof node.tag !== "string" || !isQuizScoreSummaryTag(node.tag)) {
    throw new Error(`${path}: tag "${String(node.tag)}" is not allowed`);
  }
  const props: Record<string, QuizAstPropValue> = {};
  const rawProps = node.props;
  if (rawProps !== undefined) {
    if (typeof rawProps !== "object" || rawProps === null || Array.isArray(rawProps)) {
      throw new Error(`${path}.props: must be a plain object`);
    }
    for (const [key, value] of Object.entries(rawProps as Record<string, unknown>)) {
      props[key] = normalizePropValue(`${path}.props.${key}`, value);
    }
  }
  const children: QuizScoreSummaryAstNode[] = [];
  const rawChildren = node.children;
  if (rawChildren !== undefined) {
    if (!Array.isArray(rawChildren)) {
      throw new Error(`${path}.children: must be an array`);
    }
    rawChildren.forEach((child, index) => {
      children.push(parseScoreSummaryAstFromJson(child, `${path}.children[${index}]`));
    });
  }
  return normalizeScoreSummaryAst(
    { kind: "element", tag: node.tag, props, children },
    { fillRootContainer: true },
  );
};
