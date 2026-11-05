// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rich component React Layout AST
 * ===============================
 *
 * A presentational, Tailwind-enabled component subtree for the `rich` slide
 * element. Agents author it as a tiny JSX subset; the CLI parses it once into
 * this whitelist AST (stored on `element.react_layout`), and the frontend
 * renders it recursively with `createElement` — no runtime JSX parsing.
 *
 * Unlike the quiz AST this carries **no behavior**: only HTML tags, `className`
 * (Tailwind), sanitized inline `style`, and `data-*` / `aria-*`. There are no
 * functional components, no `{$interp}` placeholders, and no event handlers.
 *
 * The HTML tag set and the style sanitizer are shared with the quiz AST so the
 * security model (no `url()`, no `position:fixed/absolute/sticky`, no `on*`,
 * etc.) stays in one place.
 */

import {
  QUIZ_HTML_TAGS,
  QUIZ_VOID_HTML_TAGS,
  isQuizHtmlTag,
  sanitizeQuizAstStyleObject,
  type QuizAstPropValue,
  type QuizHtmlTag,
} from "./quiz-ast.ts";

export type { QuizAstPropValue as RichAstPropValue };

// ─── Tag whitelist ──────────────────────────────────────────────────────────

/** Rich blocks render the same presentational HTML subset as quiz layouts. */
export const RICH_HTML_TAGS = QUIZ_HTML_TAGS;
export const RICH_VOID_HTML_TAGS = QUIZ_VOID_HTML_TAGS;

export type RichTag = QuizHtmlTag;

export const isRichTag = (value: string): value is RichTag => isQuizHtmlTag(value);

// ─── AST node types ─────────────────────────────────────────────────────────

export type RichAstNode =
  | {
      kind: "element";
      tag: RichTag;
      props: Record<string, QuizAstPropValue>;
      children: RichAstNode[];
    }
  | { kind: "text"; text: string };

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

const isDataOrAriaProp = (key: string): boolean =>
  key.startsWith("data-") || key.startsWith("aria-");

const isOnEventProp = (key: string): boolean => /^on[A-Z]/.test(key);

const propAllowedForTag = (tag: RichTag, key: string): boolean => {
  if (COMMON_HTML_PROPS.has(key)) return true;
  if (isDataOrAriaProp(key)) return true;
  if (tag === "img" && IMG_PROPS.has(key)) return true;
  return false;
};

// ─── Validation ─────────────────────────────────────────────────────────────

export interface RichAstValidationIssue {
  path: string;
  message: string;
}

const pushIssue = (
  issues: RichAstValidationIssue[],
  path: string,
  message: string,
): void => {
  issues.push({ path, message });
};

const validateNode = (
  node: RichAstNode,
  path: string,
  issues: RichAstValidationIssue[],
): void => {
  if (node.kind === "text") return;
  if (node.kind !== "element") {
    pushIssue(issues, path, `unsupported node kind "${String((node as { kind?: unknown }).kind)}"`);
    return;
  }

  if (!isRichTag(node.tag)) {
    pushIssue(
      issues,
      path,
      `<${node.tag}> is not allowed in a rich component (allowed: ${RICH_HTML_TAGS.join(", ")})`,
    );
    return;
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

  if (RICH_VOID_HTML_TAGS.has(node.tag) && node.children.length > 0) {
    pushIssue(issues, path, `<${node.tag}> must not have children`);
    return;
  }

  node.children.forEach((child, index) => {
    validateNode(child, `${path}.children[${index}]`, issues);
  });
};

/** Validate a rich AST against the tag / prop / style whitelist. Root must be an element. */
export const validateRichAst = (node: RichAstNode): RichAstValidationIssue[] => {
  const issues: RichAstValidationIssue[] = [];
  if (!node || node.kind !== "element") {
    return [{ path: "react_layout", message: "rich react_layout root must be an HTML element" }];
  }
  validateNode(node, "react_layout", issues);
  return issues;
};

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Recursively sanitize inline styles. When `fillRootContainer` is set, the root
 * element is given `width/height: 100%` (and `box-sizing: border-box`) so it
 * fills its slide canvas box by default — mirroring the quiz container contract.
 */
export const normalizeRichAst = (
  node: RichAstNode,
  options?: { fillRootContainer?: boolean },
): RichAstNode => {
  if (node.kind === "text") return node;
  if (node.kind !== "element") return node;
  let props = { ...node.props };
  const rawStyle = props.style;
  const style =
    rawStyle && typeof rawStyle === "object" && !Array.isArray(rawStyle)
      ? { ...(rawStyle as Record<string, string | number>) }
      : {};
  if (options?.fillRootContainer) {
    if (style.width === undefined) style.width = "100%";
    if (style.height === undefined) style.height = "100%";
    if (style.boxSizing === undefined) style.boxSizing = "border-box";
  }
  if (Object.keys(style).length > 0) {
    props = { ...props, style: sanitizeQuizAstStyleObject(style) };
  }
  const children = node.children.map((child) => normalizeRichAst(child));
  return { ...node, props, children };
};

const normalizePropValue = (path: string, value: unknown): QuizAstPropValue => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return sanitizeQuizAstStyleObject(value as Record<string, unknown>);
  }
  throw new Error(`${path}: invalid prop value`);
};

/** Deserialize a rich AST from already-parsed JSON (e.g. round-trip / direct AST input). */
export const parseRichAstFromJson = (input: unknown, path = "react_layout"): RichAstNode => {
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
  if (kind !== "element") {
    throw new Error(`${path}: unknown kind "${String(kind)}"`);
  }
  if (typeof node.tag !== "string" || !isRichTag(node.tag)) {
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
  const children: RichAstNode[] = [];
  const rawChildren = node.children;
  if (rawChildren !== undefined) {
    if (!Array.isArray(rawChildren)) {
      throw new Error(`${path}.children: must be an array`);
    }
    rawChildren.forEach((child, index) => {
      children.push(parseRichAstFromJson(child, `${path}.children[${index}]`));
    });
  }
  return normalizeRichAst(
    { kind: "element", tag: node.tag, props, children },
    { fillRootContainer: path === "react_layout" },
  );
};

/** Default starter AST for a freshly-inserted rich element. */
export const buildDefaultRichAst = (): RichAstNode =>
  normalizeRichAst(
    {
      kind: "element",
      tag: "div",
      props: {
        className: "flex h-full w-full flex-col items-center justify-center gap-4 p-12",
      },
      children: [
        {
          kind: "element",
          tag: "h2",
          props: { className: "text-5xl font-bold text-slate-900" },
          children: [{ kind: "text", text: "Rich component" }],
        },
        {
          kind: "element",
          tag: "p",
          props: { className: "text-2xl text-slate-600" },
          children: [
            {
              kind: "text",
              text: "Edit this block with Tailwind classes and nested HTML.",
            },
          ],
        },
      ],
    },
    { fillRootContainer: true },
  );

const richNodeSrcValue = (node: RichAstNode): string | null => {
  if (node.kind !== "element") return null;
  const src = node.props.src;
  return typeof src === "string" && src.trim() ? src : null;
};

/** Collect the media srcs to sign across the whole AST. */
export const collectAssetUrlsFromRichAst = (node: RichAstNode, urls: string[]): void => {
  const src = richNodeSrcValue(node);
  if (src) urls.push(src);
  if (node.kind === "element") {
    node.children.forEach((child) => collectAssetUrlsFromRichAst(child, urls));
  }
};

/** Return a new AST with every media src replaced through mapUrl (non-destructive). */
export const mapRichAstAssetUrl = (
  node: RichAstNode,
  mapUrl: (url: string) => string,
): RichAstNode => {
  const src = richNodeSrcValue(node);
  if (node.kind !== "element") {
    return src ? { ...node, text: node.text } : node;
  }
  const nextSrc = src ? mapUrl(src) : undefined;
  return {
    ...node,
    props: nextSrc === undefined ? node.props : { ...node.props, src: nextSrc },
    children: node.children.map((child) => mapRichAstAssetUrl(child, mapUrl)),
  };
};
