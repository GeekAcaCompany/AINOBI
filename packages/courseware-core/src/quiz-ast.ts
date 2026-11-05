// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Quiz React Layout AST
 * =====================
 *
 * The agent authors quiz UI as a JSX-like string; the CLI parses it once at
 * write time into this whitelist AST and stores it on
 * `scene.quiz.questions[].react_layout`. The frontend renders this AST
 * directly with a recursive renderer — there is no runtime JSX parsing, no
 * eval, no Babel, no dangerouslySetInnerHTML, no iframe.
 *
 * The model is deliberately small and strict:
 * - `element` nodes carry a whitelisted tag (functional Quiz components or a
 *   minimal presentational HTML subset), strict-typed props, and child nodes.
 * - `text` nodes carry literal copy.
 * - `interp` nodes are runtime-substituted placeholders (`{$title}`,
 *   `{$score}`, …) the agent can drop into copy.
 *
 * `validateQuizAst()` enforces both syntactic and semantic constraints:
 * - root must be a single `QuizContainer`,
 * - exactly one `QuizSubmitButton`,
 * - the AST input controls match the question type / option list / blank list,
 * - props are restricted to a whitelist (no `on*`, no `dangerouslySetInnerHTML`,
 *   no `href=javascript:`, no inline `position:fixed/absolute`, no `url(...)`).
 */

import type {
  QuizFillBlankQuestion,
  QuizMultipleChoiceQuestion,
  QuizQuestion,
  QuizSingleChoiceQuestion,
} from "./quiz.ts";
import { validateStateBranchChildren } from "./quiz-state-branches.ts";

// ─── Tag whitelist ──────────────────────────────────────────────────────────

/** Functional quiz components — behavior, no styling. */
export const QUIZ_FUNCTIONAL_TAGS = [
  "QuizContainer",
  "QuizTitle",
  "QuizMedia",
  "QuizOptionGroup",
  "QuizOption",
  "QuizInput",
  "QuizTextarea",
  "QuizSubmitButton",
  "QuizSkipButton",
  "QuizResubmitButton",
  "QuizContinueButton",
  "QuizExplanation",
  "QuizFeedback",
  "QuizScore",
  "QuizReferenceAudio",
  "QuizShadowingControl",
  "QuizRecordingTimer",
  "QuizRecordingPlayback",
] as const;

export type QuizFunctionalTag = (typeof QUIZ_FUNCTIONAL_TAGS)[number];

/** Presentational HTML subset (no event hooks, no scripts, no iframes). */
export const QUIZ_HTML_TAGS = [
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "img",
  "figure",
  "figcaption",
  "strong",
  "em",
  "code",
  "pre",
  "hr",
  "br",
  "label",
  "section",
  "small",
  "blockquote",
] as const;

export type QuizHtmlTag = (typeof QUIZ_HTML_TAGS)[number];

export type QuizTag = QuizFunctionalTag | QuizHtmlTag;

const FUNCTIONAL_TAG_SET = new Set<string>(QUIZ_FUNCTIONAL_TAGS);
const HTML_TAG_SET = new Set<string>(QUIZ_HTML_TAGS);

export const isQuizFunctionalTag = (value: string): value is QuizFunctionalTag =>
  FUNCTIONAL_TAG_SET.has(value);

export const isQuizHtmlTag = (value: string): value is QuizHtmlTag => HTML_TAG_SET.has(value);

export const isQuizTag = (value: string): value is QuizTag =>
  isQuizFunctionalTag(value) || isQuizHtmlTag(value);

/** Self-closing presentational tags (no children allowed). */
export const QUIZ_VOID_HTML_TAGS = new Set<QuizHtmlTag>(["img", "hr", "br"]);

// ─── Interpolation keys ─────────────────────────────────────────────────────

/**
 * Runtime substitution placeholders. The agent writes them in text positions
 * (`{$title}`, `{$score}`); the renderer replaces them with current question
 * state at render time.
 */
export const QUIZ_INTERP_KEYS = [
  "title",
  "explanation",
  "reference_text",
  "score",
  "earned_score",
  "total_score",
  "question_number",
  "question_count",
  "type",
  /** Live mm:ss while `QuizShadowingControl` is recording (scoped by nearest `QuizRecordingTimer` `name`). */
  "recording_elapsed",
  /** Integer seconds for the active recording session. */
  "recording_elapsed_sec",
  /** mm:ss of the latest completed take (after stop). */
  "recorded_duration",
  /** Integer seconds of the latest completed take. */
  "recorded_duration_sec",
] as const;

export type QuizInterpKey = (typeof QUIZ_INTERP_KEYS)[number];
const INTERP_KEY_SET = new Set<string>(QUIZ_INTERP_KEYS);
export const isQuizInterpKey = (value: string): value is QuizInterpKey =>
  INTERP_KEY_SET.has(value);

// ─── Style sandbox ──────────────────────────────────────────────────────────

/**
 * Only well-known typographic / layout / color CSS keys are accepted in
 * `style={{...}}`. Everything outside this list (positioning, transforms,
 * filters, iframe controls, etc.) is rejected so untrusted authoring cannot
 * break out of the slide box or fetch foreign resources via `url(...)`.
 */
export const QUIZ_STYLE_ALLOWED_KEYS = new Set<string>([
  "color",
  "background",
  "backgroundColor",
  "background-color",
  "opacity",
  "fontFamily",
  "font-family",
  "fontSize",
  "font-size",
  "fontWeight",
  "font-weight",
  "fontStyle",
  "font-style",
  "lineHeight",
  "line-height",
  "letterSpacing",
  "letter-spacing",
  "textAlign",
  "text-align",
  "textTransform",
  "text-transform",
  "textDecoration",
  "text-decoration",
  "whiteSpace",
  "white-space",
  "wordBreak",
  "word-break",
  "padding",
  "paddingTop",
  "padding-top",
  "paddingRight",
  "padding-right",
  "paddingBottom",
  "padding-bottom",
  "paddingLeft",
  "padding-left",
  "margin",
  "marginTop",
  "margin-top",
  "marginRight",
  "margin-right",
  "marginBottom",
  "margin-bottom",
  "marginLeft",
  "margin-left",
  "gap",
  "rowGap",
  "row-gap",
  "columnGap",
  "column-gap",
  "display",
  "flexDirection",
  "flex-direction",
  "flexWrap",
  "flex-wrap",
  "justifyContent",
  "justify-content",
  "alignItems",
  "align-items",
  "alignContent",
  "align-content",
  "alignSelf",
  "align-self",
  "flex",
  "flexGrow",
  "flex-grow",
  "flexShrink",
  "flex-shrink",
  "flexBasis",
  "flex-basis",
  "gridTemplateColumns",
  "grid-template-columns",
  "gridTemplateRows",
  "grid-template-rows",
  "gridGap",
  "grid-gap",
  "borderRadius",
  "border-radius",
  "border",
  "borderTop",
  "border-top",
  "borderRight",
  "border-right",
  "borderBottom",
  "border-bottom",
  "borderLeft",
  "border-left",
  "borderColor",
  "border-color",
  "borderWidth",
  "border-width",
  "borderStyle",
  "border-style",
  "boxShadow",
  "box-shadow",
  "width",
  "height",
  "minWidth",
  "min-width",
  "minHeight",
  "min-height",
  "maxWidth",
  "max-width",
  "maxHeight",
  "max-height",
  "cursor",
  "userSelect",
  "user-select",
  "pointerEvents",
  "pointer-events",
  "transition",
  "transitionProperty",
  "transition-property",
  "transitionDuration",
  "transition-duration",
  "transitionTimingFunction",
  "transition-timing-function",
  "transitionDelay",
  "transition-delay",
  // Typography & text effects
  "textShadow",
  "text-shadow",
  "textOverflow",
  "text-overflow",
  "textIndent",
  "text-indent",
  "verticalAlign",
  "vertical-align",
  "fontVariant",
  "font-variant",
  "wordWrap",
  "word-wrap",
  "overflowWrap",
  "overflow-wrap",
  "hyphens",
  // Background & surfaces (values with `url(...)` still rejected)
  "backgroundImage",
  "background-image",
  "backgroundSize",
  "background-size",
  "backgroundPosition",
  "background-position",
  "backgroundRepeat",
  "background-repeat",
  "backgroundClip",
  "background-clip",
  "backdropFilter",
  "backdrop-filter",
  // Visual effects (no `url()` in values)
  "filter",
  "outline",
  "outlineColor",
  "outline-color",
  "outlineWidth",
  "outline-width",
  "outlineStyle",
  "outline-style",
  "outlineOffset",
  "outline-offset",
  "mixBlendMode",
  "mix-blend-mode",
  "isolation",
  // Box model & overflow
  "boxSizing",
  "box-sizing",
  "overflow",
  "overflowX",
  "overflow-x",
  "overflowY",
  "overflow-y",
  "objectFit",
  "object-fit",
  "objectPosition",
  "object-position",
  "aspectRatio",
  "aspect-ratio",
  // Extra flex/grid placement
  "placeItems",
  "place-items",
  "placeContent",
  "place-content",
  "placeSelf",
  "place-self",
  "order",
  "gridColumn",
  "grid-column",
  "gridRow",
  "grid-row",
  "gridArea",
  "grid-area",
]);

const STYLE_VALUE_FORBIDDEN_FRAGMENTS = [
  "url(",
  "expression(",
  "javascript:",
  "@import",
  "!important",
  "/*",
  "*/",
  "</",
  "position:fixed",
  "position: fixed",
  "position:absolute",
  "position: absolute",
  "position:sticky",
  "position: sticky",
];

const isForbiddenStyleValue = (value: string): boolean => {
  const lowered = value.toLowerCase();
  return STYLE_VALUE_FORBIDDEN_FRAGMENTS.some((fragment) => lowered.includes(fragment));
};

/** CSS property names we accept in `style={{…}}` (permissive; values still scanned). */
const isCssPropertyKey = (key: string): boolean =>
  /^[a-zA-Z][a-zA-Z0-9-]*$/.test(key) && !/^on[A-Z]/.test(key);

const isForbiddenStyleEntry = (key: string, value: string): boolean => {
  const trimmed = value.trim().toLowerCase();
  if (key === "position") {
    return trimmed === "fixed" || trimmed === "absolute" || trimmed === "sticky";
  }
  return isForbiddenStyleValue(value);
};

/** Sanitize a `style={{...}}` object: permissive keys, block only dangerous values. */
export const sanitizeQuizAstStyleObject = (
  raw: Record<string, unknown>,
): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isCssPropertyKey(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (isForbiddenStyleEntry(key, trimmed)) continue;
      out[key] = trimmed;
    }
  }
  return out;
};

// ─── AST node types ─────────────────────────────────────────────────────────

export type QuizAstPropValue =
  | string
  | number
  | boolean
  | Record<string, string | number>;

export type QuizAstNode =
  | { kind: "element"; tag: QuizTag; props: Record<string, QuizAstPropValue>; children: QuizAstNode[] }
  | { kind: "stateBranch"; when: string; props: Record<string, QuizAstPropValue>; children: QuizAstNode[] }
  | { kind: "text"; text: string }
  | { kind: "interp"; key: QuizInterpKey };

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

const FUNCTIONAL_PROPS: Record<QuizFunctionalTag, Set<string>> = {
  QuizContainer: new Set<string>(["padding", "gap", "narrationAudioUrl", "narrationDurationMs"]),
  QuizTitle: new Set<string>([]),
  QuizMedia: new Set<string>(["type", "src", "alt", "loop", "controls"]),
  QuizOptionGroup: new Set<string>([]),
  QuizOption: new Set<string>(["value", "disabled"]),
  QuizInput: new Set<string>(["name", "placeholder", "inputMode", "autoComplete", "inline"]),
  QuizTextarea: new Set<string>(["name", "placeholder", "rows"]),
  QuizSubmitButton: new Set<string>(["disabledWhenEmpty"]),
  QuizSkipButton: new Set<string>([]),
  QuizResubmitButton: new Set<string>([]),
  QuizContinueButton: new Set<string>([]),
  QuizExplanation: new Set<string>([]),
  QuizFeedback: new Set<string>(["variant"]),
  QuizScore: new Set<string>([]),
  QuizReferenceAudio: new Set<string>(["src", "loop"]),
  QuizShadowingControl: new Set<string>(["name", "recordingStyle"]),
  QuizRecordingTimer: new Set<string>(["name", "hideWhenIdle"]),
  QuizRecordingPlayback: new Set<string>(["name"]),
};

const isDataOrAriaProp = (key: string): boolean => key.startsWith("data-") || key.startsWith("aria-");

const isOnEventProp = (key: string): boolean => /^on[A-Z]/.test(key);

const propAllowedForTag = (tag: QuizTag, key: string, _value: QuizAstPropValue): boolean => {
  if (COMMON_HTML_PROPS.has(key)) return true;
  if (isDataOrAriaProp(key)) return true;
  if (tag === "img" && IMG_PROPS.has(key)) return true;
  if (isQuizFunctionalTag(tag) && FUNCTIONAL_PROPS[tag].has(key)) return true;
  return false;
};

// ─── Validation issues ──────────────────────────────────────────────────────

export interface QuizAstValidationIssue {
  path: string;
  message: string;
}

const pushIssue = (issues: QuizAstValidationIssue[], path: string, message: string): void => {
  issues.push({ path, message });
};

// ─── Structural validation ──────────────────────────────────────────────────

interface ValidationContext {
  questionType: QuizQuestion["type"];
  optionIds: Set<string>;
  blankIds: Set<string>;
  /** Counts of functional tags encountered so we can enforce singletons. */
  counts: Record<QuizFunctionalTag, number>;
  /** Whether we are inside `QuizTitle` (where inline `QuizInput` is allowed). */
  insideTitle: boolean;
  /** Inline `QuizInput name=` occurrences (must cover `blanks[]` for fill_blank). */
  seenInputNames: Set<string>;
  /** Inline `QuizOption value=` occurrences (must cover `options[]` for choice). */
  seenOptionValues: Set<string>;
}

const newContext = (question: QuizQuestion): ValidationContext => {
  const counts: Record<QuizFunctionalTag, number> = {
    QuizContainer: 0,
    QuizTitle: 0,
    QuizMedia: 0,
    QuizOptionGroup: 0,
    QuizOption: 0,
    QuizInput: 0,
    QuizTextarea: 0,
    QuizSubmitButton: 0,
    QuizSkipButton: 0,
    QuizResubmitButton: 0,
    QuizContinueButton: 0,
    QuizExplanation: 0,
    QuizFeedback: 0,
    QuizScore: 0,
    QuizReferenceAudio: 0,
    QuizShadowingControl: 0,
    QuizRecordingTimer: 0,
    QuizRecordingPlayback: 0,
  };
  const optionIds = new Set<string>();
  const blankIds = new Set<string>();
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    for (const opt of (question as QuizSingleChoiceQuestion | QuizMultipleChoiceQuestion).options) {
      optionIds.add(opt.option_id);
    }
  }
  if (question.type === "fill_blank") {
    for (const b of (question as QuizFillBlankQuestion).blanks) blankIds.add(b.blank_id);
  }
  return {
    questionType: question.type,
    optionIds,
    blankIds,
    counts,
    insideTitle: false,
    seenInputNames: new Set<string>(),
    seenOptionValues: new Set<string>(),
  };
};

const validateImgSrc = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith("data:image/")) return true;
  return /^https?:\/\//i.test(value);
};

const validateMediaSrc = (value: string, type: string): boolean => {
  if (!value) return false;
  if (type === "image" && value.startsWith("data:image/")) return true;
  if (type === "audio" && value.startsWith("data:audio/")) return true;
  return /^https?:\/\//i.test(value);
};

const validateAudioSrc = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith("data:audio/")) return true;
  return /^https?:\/\//i.test(value);
};

const validateProps = (
  node: Extract<QuizAstNode, { kind: "element" }>,
  path: string,
  ctx: ValidationContext,
  issues: QuizAstValidationIssue[],
): void => {
  for (const [key, value] of Object.entries(node.props)) {
    if (isOnEventProp(key)) {
      pushIssue(issues, `${path}.${key}`, `event handlers (on*) are not allowed on quiz AST nodes`);
      continue;
    }
    if (key === "dangerouslySetInnerHTML" || key === "ref" || key === "key" || key === "srcDoc") {
      pushIssue(issues, `${path}.${key}`, `prop \`${key}\` is not allowed on quiz AST nodes`);
      continue;
    }
    if (!propAllowedForTag(node.tag, key, value)) {
      pushIssue(issues, `${path}.${key}`, `prop \`${key}\` is not allowed on <${node.tag}>`);
      continue;
    }
    if (key === "href" && typeof value === "string" && /^\s*javascript:/i.test(value)) {
      pushIssue(issues, `${path}.${key}`, `href cannot use the javascript: scheme`);
      continue;
    }
    if (key === "style" || key === "recordingStyle") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        pushIssue(issues, `${path}.${key}`, `${key} must be a plain object literal`);
        continue;
      }
      for (const [styleKey, styleVal] of Object.entries(value as Record<string, unknown>)) {
        if (typeof styleVal !== "string" && typeof styleVal !== "number") {
          pushIssue(
            issues,
            `${path}.${key}.${styleKey}`,
            `${key} value must be a string or number`,
          );
          continue;
        }
        if (typeof styleVal === "string" && isForbiddenStyleEntry(styleKey, styleVal)) {
          pushIssue(
            issues,
            `${path}.${key}.${styleKey}`,
            `${key} value contains forbidden pattern (url()/expression()/!important/position:fixed)`,
          );
        }
      }
    }
  }
};

const validateTagSpecificProps = (
  node: Extract<QuizAstNode, { kind: "element" }>,
  path: string,
  ctx: ValidationContext,
  issues: QuizAstValidationIssue[],
): void => {
  if (node.tag === "img") {
    const src = node.props.src;
    if (typeof src !== "string" || !validateImgSrc(src)) {
      pushIssue(issues, `${path}.src`, `<img src> must be an https:// URL or data:image/... URI`);
    }
  }
  if (node.tag === "QuizMedia") {
    const type = node.props.type;
    if (type !== "image" && type !== "audio") {
      pushIssue(issues, `${path}.type`, `QuizMedia.type must be "image" or "audio"`);
    }
    const src = node.props.src;
    if (typeof src !== "string" || !validateMediaSrc(src, typeof type === "string" ? type : "")) {
      pushIssue(
        issues,
        `${path}.src`,
        `QuizMedia.src must be an https:// URL or data:${type === "audio" ? "audio" : "image"}/... URI`,
      );
    }
  }
  if (node.tag === "QuizReferenceAudio") {
    const src = node.props.src;
    if (src === undefined || src === null) {
      return;
    }
    if (typeof src !== "string") {
      pushIssue(issues, `${path}.src`, `QuizReferenceAudio.src must be a string`);
    } else if (src.trim() && !validateAudioSrc(src)) {
      pushIssue(
        issues,
        `${path}.src`,
        `QuizReferenceAudio.src must be an https:// URL or data:audio/... URI`,
      );
    }
  }
  if (node.tag === "QuizOption") {
    const value = node.props.value;
    if (typeof value !== "string" || !value.trim()) {
      pushIssue(issues, `${path}.value`, `QuizOption.value is required`);
    } else if (!ctx.optionIds.has(value)) {
      pushIssue(
        issues,
        `${path}.value`,
        `QuizOption.value "${value}" does not match any options[].option_id`,
      );
    } else if (ctx.seenOptionValues.has(value)) {
      pushIssue(issues, `${path}.value`, `QuizOption.value "${value}" appears more than once`);
    } else {
      ctx.seenOptionValues.add(value);
    }
  }
  if (node.tag === "QuizInput" || node.tag === "QuizTextarea") {
    const name = node.props.name;
    if (typeof name !== "string" || !name.trim()) {
      pushIssue(issues, `${path}.name`, `<${node.tag}>.name is required`);
    } else if (ctx.questionType === "fill_blank") {
      if (!ctx.blankIds.has(name)) {
        pushIssue(
          issues,
          `${path}.name`,
          `<${node.tag}>.name "${name}" does not match any blanks[].blank_id`,
        );
      } else if (ctx.seenInputNames.has(name)) {
        pushIssue(issues, `${path}.name`, `<${node.tag}>.name "${name}" appears more than once`);
      } else {
        ctx.seenInputNames.add(name);
      }
    } else if (ctx.questionType === "essay" || ctx.questionType === "speech") {
      // essay / speech use a single response field; name is free-form (e.g. "answer").
      ctx.seenInputNames.add(name);
    } else {
      pushIssue(
        issues,
        `${path}.name`,
        `<${node.tag}> is not allowed on question type "${ctx.questionType}"`,
      );
    }
  }
};

const walkAst = (
  node: QuizAstNode,
  path: string,
  ctx: ValidationContext,
  issues: QuizAstValidationIssue[],
): void => {
  if (node.kind === "text") return;
  if (node.kind === "interp") {
    if (!isQuizInterpKey(node.key)) {
      pushIssue(issues, path, `unknown interpolation key {$${String(node.key)}}`);
    }
    return;
  }
  if (node.kind === "stateBranch") {
    pushIssue(
      issues,
      path,
      `<QuizStateView> must be a direct child of a stateful host (e.g. QuizShadowingControl)`,
    );
    return;
  }
  if (!isQuizTag(node.tag)) {
    pushIssue(issues, path, `tag <${String(node.tag)}> is not in the quiz AST whitelist`);
    return;
  }
  if (
    node.tag === "QuizRecordingTimer" &&
    ctx.questionType !== "shadowing" &&
    ctx.questionType !== "speech"
  ) {
    pushIssue(issues, path, `<QuizRecordingTimer> is only allowed on shadowing / speech questions`);
  }
  if (isQuizFunctionalTag(node.tag)) ctx.counts[node.tag] += 1;

  validateProps(node, path, ctx, issues);
  validateTagSpecificProps(node, path, ctx, issues);

  for (const message of validateStateBranchChildren(node.tag as QuizFunctionalTag, node.children)) {
    pushIssue(issues, `${path}.children`, message);
  }

  // Void HTML tags must not have children.
  if (isQuizHtmlTag(node.tag) && QUIZ_VOID_HTML_TAGS.has(node.tag) && node.children.length > 0) {
    pushIssue(issues, `${path}.children`, `<${node.tag}> must be self-closing`);
  }

  const wasInsideTitle = ctx.insideTitle;
  if (node.tag === "QuizTitle") ctx.insideTitle = true;
  // Disallow nested QuizContainer.
  if (node.tag === "QuizContainer" && path !== "react_layout") {
    pushIssue(issues, path, `<QuizContainer> can only appear at the root of react_layout`);
  }
  if (ctx.questionType === "fill_blank" && node.tag === "QuizInput" && !ctx.insideTitle) {
    pushIssue(
      issues,
      path,
      `<QuizInput> on fill_blank must appear inside <QuizTitle> (use underscores in title for blank slots)`,
    );
  }
  if (
    (node.tag === "QuizInput" || node.tag === "QuizTextarea") &&
    ctx.insideTitle &&
    ctx.questionType !== "fill_blank"
  ) {
    pushIssue(
      issues,
      path,
      `inline <${node.tag}> inside <QuizTitle> is only allowed on fill_blank questions`,
    );
  }
  node.children.forEach((child, index) => {
    if (child.kind === "stateBranch") {
      validateStateBranchNode(child, `${path}.children[${index}]`, node.tag, ctx, issues);
      return;
    }
    walkAst(child, `${path}.children[${index}]`, ctx, issues);
  });
  ctx.insideTitle = wasInsideTitle;
};

const STATE_BRANCH_PROPS = new Set<string>([
  "className",
  "style",
  "id",
  "role",
  "tabIndex",
  "title",
  "lang",
  "dir",
]);

const validateStateBranchNode = (
  node: Extract<QuizAstNode, { kind: "stateBranch" }>,
  path: string,
  hostTag: QuizTag,
  ctx: ValidationContext,
  issues: QuizAstValidationIssue[],
): void => {
  if (!isQuizFunctionalTag(hostTag)) {
    pushIssue(issues, path, `<QuizStateView> cannot be nested under <${hostTag}>`);
    return;
  }
  for (const [key, value] of Object.entries(node.props)) {
    if (isOnEventProp(key)) {
      pushIssue(issues, `${path}.${key}`, `event handlers (on*) are not allowed on <QuizStateView>`);
      continue;
    }
    if (
      !STATE_BRANCH_PROPS.has(key) &&
      !isDataOrAriaProp(key)
    ) {
      pushIssue(issues, `${path}.${key}`, `prop \`${key}\` is not allowed on <QuizStateView>`);
      continue;
    }
    if (key === "style") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        pushIssue(issues, `${path}.${key}`, `style must be a plain object literal`);
        continue;
      }
      for (const [styleKey, styleVal] of Object.entries(value as Record<string, unknown>)) {
        if (typeof styleVal !== "string" && typeof styleVal !== "number") {
          pushIssue(issues, `${path}.${key}.${styleKey}`, `style value must be a string or number`);
          continue;
        }
        if (typeof styleVal === "string" && isForbiddenStyleEntry(styleKey, styleVal)) {
          pushIssue(
            issues,
            `${path}.${key}.${styleKey}`,
            `style value contains forbidden pattern (url()/expression()/!important/position:fixed)`,
          );
        }
      }
    }
  }
  node.children.forEach((child, index) => {
    if (child.kind === "stateBranch") {
      pushIssue(issues, `${path}.children[${index}]`, `<QuizStateView> cannot be nested`);
      return;
    }
    walkAst(child, `${path}.children[${index}]`, ctx, issues);
  });
};

const STRUCTURAL_REQUIREMENTS: Record<QuizQuestion["type"], readonly QuizFunctionalTag[]> = {
  single_choice: ["QuizContainer", "QuizTitle", "QuizOptionGroup", "QuizSubmitButton"],
  multiple_choice: ["QuizContainer", "QuizTitle", "QuizOptionGroup", "QuizSubmitButton"],
  fill_blank: ["QuizContainer", "QuizTitle", "QuizSubmitButton"],
  essay: ["QuizContainer", "QuizTitle", "QuizTextarea", "QuizSubmitButton"],
  shadowing: ["QuizContainer", "QuizTitle", "QuizShadowingControl", "QuizSubmitButton"],
  speech: ["QuizContainer", "QuizTitle", "QuizShadowingControl", "QuizSubmitButton"],
};

const validateStructuralRules = (
  ctx: ValidationContext,
  question: QuizQuestion,
  issues: QuizAstValidationIssue[],
): void => {
  for (const required of STRUCTURAL_REQUIREMENTS[question.type]) {
    if (ctx.counts[required] === 0) {
      pushIssue(issues, "react_layout", `missing required <${required}> for ${question.type}`);
    }
  }
  if (ctx.counts.QuizContainer > 1) {
    pushIssue(issues, "react_layout", `<QuizContainer> must appear exactly once`);
  }
  if (ctx.counts.QuizSubmitButton !== 1) {
    pushIssue(issues, "react_layout", `<QuizSubmitButton> must appear exactly once`);
  }
  if (ctx.counts.QuizTitle > 1) {
    pushIssue(issues, "react_layout", `<QuizTitle> must appear at most once`);
  }
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    const remaining = ctx.optionIds.size - ctx.seenOptionValues.size;
    if (remaining > 0) {
      pushIssue(
        issues,
        "react_layout",
        `react_layout must include a <QuizOption value="..."> for every options[].option_id (missing ${remaining})`,
      );
    }
    if (ctx.counts.QuizOptionGroup < 1) {
      pushIssue(issues, "react_layout", `choice questions must wrap options in <QuizOptionGroup>`);
    }
  }
  if (question.type === "fill_blank") {
    const remaining = ctx.blankIds.size - ctx.seenInputNames.size;
    if (remaining > 0) {
      pushIssue(
        issues,
        "react_layout",
        `react_layout must include a <QuizInput name="..."> for every blanks[].blank_id (missing ${remaining})`,
      );
    }
  }
};

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Validate a {@link QuizAstNode} tree against the question's data and the
 * structural rules for its type. Returns an empty array on success.
 */
export const validateQuizAst = (
  node: QuizAstNode,
  question: QuizQuestion,
): QuizAstValidationIssue[] => {
  const issues: QuizAstValidationIssue[] = [];
  if (!node || typeof node !== "object") {
    return [{ path: "react_layout", message: "react_layout must be a QuizAstNode object" }];
  }
  if (node.kind !== "element" || node.tag !== "QuizContainer") {
    return [{ path: "react_layout", message: "react_layout root must be <QuizContainer>" }];
  }
  const ctx = newContext(question);
  walkAst(node, "react_layout", ctx, issues);
  validateStructuralRules(ctx, question, issues);
  return issues;
};

// ─── Runtime helpers ────────────────────────────────────────────────────────

/** Drop props outside the tag whitelist when loading persisted JSON. */
export const stripDisallowedQuizAstProps = (node: QuizAstNode): QuizAstNode => {
  if (node.kind === "text" || node.kind === "interp") return node;
  if (node.kind === "stateBranch") {
    return {
      ...node,
      children: node.children.map(stripDisallowedQuizAstProps),
    };
  }
  const props: Record<string, QuizAstPropValue> = {};
  for (const [key, value] of Object.entries(node.props)) {
    if (isOnEventProp(key)) continue;
    if (key === "dangerouslySetInnerHTML" || key === "ref" || key === "key" || key === "srcDoc") {
      continue;
    }
    if (propAllowedForTag(node.tag, key, value)) {
      props[key] = value;
    }
  }
  return {
    kind: "element",
    tag: node.tag,
    props,
    children: node.children.map(stripDisallowedQuizAstProps),
  };
};

/** @deprecated Use {@link stripDisallowedQuizAstProps}. */
export const stripDeprecatedQuizAstProps = stripDisallowedQuizAstProps;

/** Deep-clone the AST (used when normalizing JSON input). */
export const cloneQuizAst = (node: QuizAstNode): QuizAstNode => {
  if (node.kind === "text") return { kind: "text", text: node.text };
  if (node.kind === "interp") return { kind: "interp", key: node.key };
  if (node.kind === "stateBranch") {
    return {
      kind: "stateBranch",
      when: node.when,
      props: deepCloneProps(node.props),
      children: node.children.map(cloneQuizAst),
    };
  }
  return {
    kind: "element",
    tag: node.tag,
    props: deepCloneProps(node.props),
    children: node.children.map(cloneQuizAst),
  };
};

/** Remap `<QuizOption value="…">` after cloning `options[].option_id`. */
export const remapQuizAstOptionValues = (
  node: QuizAstNode,
  optionIdMap: ReadonlyMap<string, string>,
): QuizAstNode => {
  if (node.kind === "text" || node.kind === "interp") return node;
  if (node.kind === "stateBranch") {
    return {
      ...node,
      children: node.children.map((child) => remapQuizAstOptionValues(child, optionIdMap)),
    };
  }
  const props = { ...node.props };
  if (node.tag === "QuizOption" && typeof props.value === "string") {
    const mapped = optionIdMap.get(props.value);
    if (mapped) props.value = mapped;
  }
  return {
    kind: "element",
    tag: node.tag,
    props,
    children: node.children.map((child) => remapQuizAstOptionValues(child, optionIdMap)),
  };
};

/** Remap `<QuizInput name="…">` / `<QuizTextarea name="…">` after cloning `blanks[].blank_id`. */
export const remapQuizAstBlankIds = (
  node: QuizAstNode,
  blankIdMap: ReadonlyMap<string, string>,
): QuizAstNode => {
  if (node.kind === "text" || node.kind === "interp") return node;
  if (node.kind === "stateBranch") {
    return {
      ...node,
      children: node.children.map((child) => remapQuizAstBlankIds(child, blankIdMap)),
    };
  }
  const props = { ...node.props };
  if (
    (node.tag === "QuizInput" || node.tag === "QuizTextarea") &&
    typeof props.name === "string"
  ) {
    const mapped = blankIdMap.get(props.name);
    if (mapped) props.name = mapped;
  }
  return {
    kind: "element",
    tag: node.tag,
    props,
    children: node.children.map((child) => remapQuizAstBlankIds(child, blankIdMap)),
  };
};

/** Normalize AST after JSX parse: default optional props, sanitize inline styles. */
export const normalizeQuizAst = (
  node: QuizAstNode,
  options?: { fillRootContainer?: boolean },
): QuizAstNode => {
  if (node.kind === "text") return node;
  if (node.kind === "interp") return node;
  if (node.kind === "stateBranch") {
    const branchProps: Record<string, QuizAstPropValue> = { ...node.props };
    if (
      branchProps.style &&
      typeof branchProps.style === "object" &&
      !Array.isArray(branchProps.style)
    ) {
      branchProps.style = sanitizeQuizAstStyleObject(
        branchProps.style as Record<string, unknown>,
      );
    }
    return {
      kind: "stateBranch",
      when: node.when,
      props: branchProps,
      children: node.children.map((child) => normalizeQuizAst(child, options)),
    };
  }
  const props: Record<string, QuizAstPropValue> = { ...node.props };
  if (node.tag === "QuizReferenceAudio" && props.src === undefined) {
    props.src = "";
  }
  if (
    node.tag === "QuizShadowingControl" &&
    props.recordingStyle &&
    typeof props.recordingStyle === "object" &&
    !Array.isArray(props.recordingStyle)
  ) {
    props.recordingStyle = sanitizeQuizAstStyleObject(
      props.recordingStyle as Record<string, unknown>,
    );
  }
  if (options?.fillRootContainer && node.tag === "QuizContainer") {
    const rawStyle =
      props.style && typeof props.style === "object" && !Array.isArray(props.style)
        ? { ...(props.style as Record<string, unknown>) }
        : {};
    if (rawStyle.width === undefined) rawStyle.width = "100%";
    if (rawStyle.height === undefined) rawStyle.height = "100%";
    props.style = sanitizeQuizAstStyleObject(rawStyle);
  } else if (props.style && typeof props.style === "object" && !Array.isArray(props.style)) {
    props.style = sanitizeQuizAstStyleObject(props.style as Record<string, unknown>);
  }
  return {
    kind: "element",
    tag: node.tag,
    props,
    children: node.children.map((child) => normalizeQuizAst(child)),
  };
};

const deepCloneProps = (
  props: Record<string, QuizAstPropValue>,
): Record<string, QuizAstPropValue> => {
  const out: Record<string, QuizAstPropValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = { ...(value as Record<string, string | number>) };
    } else {
      out[key] = value;
    }
  }
  return out;
};

/**
 * Deserialize an unknown JSON value into a {@link QuizAstNode} or throw on
 * malformed input. Strict: rejects extraneous fields.
 */
export const parseQuizAstFromJson = (input: unknown, path = "react_layout"): QuizAstNode => {
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
    if (typeof node.key !== "string" || !isQuizInterpKey(node.key)) {
      throw new Error(`${path}: interp node \`key\` must be one of ${QUIZ_INTERP_KEYS.join(", ")}`);
    }
    return { kind: "interp", key: node.key };
  }
  if (kind === "stateBranch") {
    if (typeof node.when !== "string" || !node.when.trim()) {
      throw new Error(`${path}: stateBranch node must have a non-empty \`when\``);
    }
    const rawProps = node.props;
    const props: Record<string, QuizAstPropValue> = {};
    if (rawProps !== undefined) {
      if (typeof rawProps !== "object" || rawProps === null || Array.isArray(rawProps)) {
        throw new Error(`${path}.props: must be a plain object`);
      }
      for (const [key, value] of Object.entries(rawProps as Record<string, unknown>)) {
        props[key] = normalizePropValue(`${path}.props.${key}`, value);
      }
    }
    const rawChildren = node.children;
    const children: QuizAstNode[] = [];
    if (rawChildren !== undefined) {
      if (!Array.isArray(rawChildren)) {
        throw new Error(`${path}.children: must be an array`);
      }
      rawChildren.forEach((child, index) => {
        children.push(parseQuizAstFromJson(child, `${path}.children[${index}]`));
      });
    }
    return stripDeprecatedQuizAstProps(
      normalizeQuizAst({ kind: "stateBranch", when: node.when, props, children }),
    );
  }
  if (kind !== "element") {
    throw new Error(`${path}: unknown kind "${String(kind)}"`);
  }
  if (typeof node.tag !== "string" || !isQuizTag(node.tag)) {
    throw new Error(`${path}: tag "${String(node.tag)}" is not allowed`);
  }
  const rawProps = node.props;
  const props: Record<string, QuizAstPropValue> = {};
  if (rawProps !== undefined) {
    if (typeof rawProps !== "object" || rawProps === null || Array.isArray(rawProps)) {
      throw new Error(`${path}.props: must be a plain object`);
    }
    for (const [key, value] of Object.entries(rawProps as Record<string, unknown>)) {
      props[key] = normalizePropValue(`${path}.props.${key}`, value);
    }
  }
  const rawChildren = node.children;
  const children: QuizAstNode[] = [];
  if (rawChildren !== undefined) {
    if (!Array.isArray(rawChildren)) {
      throw new Error(`${path}.children: must be an array`);
    }
    rawChildren.forEach((child, index) => {
      children.push(parseQuizAstFromJson(child, `${path}.children[${index}]`));
    });
  }
  return stripDeprecatedQuizAstProps(
    normalizeQuizAst({ kind: "element", tag: node.tag, props, children }, { fillRootContainer: true }),
  );
};

const normalizePropValue = (path: string, value: unknown): QuizAstPropValue => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number") {
        obj[k] = v;
      } else {
        throw new Error(`${path}.${k}: only string/number values are allowed`);
      }
    }
    return obj;
  }
  throw new Error(`${path}: prop value must be string, number, boolean, or object`);
};

const collectQuizAstPlainText = (node: QuizAstNode): string => {
  if (node.kind === "text") return node.text;
  if (node.kind === "interp") return "";
  if (node.kind === "stateBranch") {
    return node.children.map(collectQuizAstPlainText).join("");
  }
  if (node.kind === "element") return node.children.map(collectQuizAstPlainText).join("");
  return "";
};

/** User-visible option label from nested `<QuizOption value={optionId}>…</QuizOption>`. */
export const extractQuizOptionLabelFromAst = (
  root: QuizAstNode | null | undefined,
  optionId: string,
): string => {
  if (!root) return "";
  const find = (node: QuizAstNode): string | null => {
    if (node.kind !== "element") return null;
    if (node.tag === "QuizOption") {
      const value = node.props.value;
      if (typeof value === "string" && value === optionId) {
        return node.children.map(collectQuizAstPlainText).join("").trim();
      }
    }
    for (const child of node.children) {
      if (child.kind === "stateBranch") {
        for (const nested of child.children) {
          const hit = find(nested);
          if (hit != null) return hit;
        }
        continue;
      }
      const hit = find(child);
      if (hit != null) return hit;
    }
    return null;
  };
  const label = find(root);
  return label ?? "";
};

const DEFAULT_QUIZ_OPTION_STYLE: Record<string, string | number> = {
  padding: 14,
  fontSize: 17,
  lineHeight: 1.4,
  borderRadius: 10,
};

type QuizAstElement = Extract<QuizAstNode, { kind: "element" }>;

const quizOptionStyleFromGroup = (group: QuizAstElement): Record<string, string | number> => {
  for (const child of group.children) {
    if (child.kind === "element" && child.tag === "QuizOption") {
      const style = child.props.style;
      if (style && typeof style === "object" && !Array.isArray(style)) {
        return { ...(style as Record<string, string | number>) };
      }
      break;
    }
  }
  return { ...DEFAULT_QUIZ_OPTION_STYLE };
};

const mapQuizAstElementChildren = (
  node: QuizAstElement,
  mapChild: (child: QuizAstNode) => QuizAstNode,
): QuizAstElement => ({
  ...node,
  children: node.children.map((child) => {
    if (child.kind === "stateBranch") {
      return { ...child, children: child.children.map(mapChild) };
    }
    return mapChild(child);
  }),
});

const buildQuizOptionAstNode = (
  optionId: string,
  label: string,
  style: Record<string, string | number>,
): QuizAstElement => ({
  kind: "element",
  tag: "QuizOption",
  props: { value: optionId, style },
  children: label ? [{ kind: "text", text: label }] : [],
});

/** Append `<QuizOption value={optionId}>…</QuizOption>` under the first `<QuizOptionGroup>`. */
export const appendQuizOptionToChoiceAst = (
  root: QuizAstNode | null | undefined,
  optionId: string,
  label = "",
): QuizAstNode | null | undefined => {
  if (!root || root.kind !== "element") return root;
  const visit = (node: QuizAstNode): QuizAstNode => {
    if (node.kind !== "element") return node;
    if (node.tag === "QuizOptionGroup") {
      const style = quizOptionStyleFromGroup(node);
      const nextOption = buildQuizOptionAstNode(optionId, label, style);
      return { ...node, children: [...node.children, nextOption] };
    }
    return mapQuizAstElementChildren(node, visit);
  };
  return visit(root);
};

/** Remove `<QuizOption value={optionId}>` from the first matching `<QuizOptionGroup>`. */
export const removeQuizOptionFromChoiceAst = (
  root: QuizAstNode | null | undefined,
  optionId: string,
): QuizAstNode | null | undefined => {
  if (!root || root.kind !== "element") return root;
  const visit = (node: QuizAstNode): QuizAstNode => {
    if (node.kind !== "element") return node;
    if (node.tag === "QuizOptionGroup") {
      return {
        ...node,
        children: node.children.filter((child) => {
          if (child.kind === "element" && child.tag === "QuizOption") {
            return child.props.value !== optionId;
          }
          return true;
        }),
      };
    }
    return mapQuizAstElementChildren(node, visit);
  };
  return visit(root);
};

/**
 * Update user-visible option copy in `react_layout`. Creates the `<QuizOption>`
 * node when the editor adds a new `options[]` entry before the AST was patched.
 */
export const setQuizOptionTextInChoiceAst = (
  root: QuizAstNode | null | undefined,
  optionId: string,
  nextText: string,
): QuizAstNode | null | undefined => {
  if (!root || root.kind !== "element") return root;
  let found = false;
  const visit = (node: QuizAstNode): QuizAstNode => {
    if (node.kind !== "element") return node;
    if (node.tag === "QuizOption" && node.props.value === optionId) {
      found = true;
      return { ...node, children: [{ kind: "text", text: nextText }] };
    }
    return mapQuizAstElementChildren(node, visit);
  };
  const patched = visit(root);
  if (!found) {
    return appendQuizOptionToChoiceAst(patched, optionId, nextText);
  }
  return patched;
};

// ─── Layout sizing audit (agent guidance) ───────────────────────────────────

const QUIZ_LAYOUT_BOX_TAGS = new Set<string>([
  "div",
  "section",
  "figure",
  "blockquote",
  "label",
  "QuizContainer",
  "QuizTitle",
  "QuizExplanation",
  "QuizFeedback",
]);

const FIXED_LAYOUT_MIN_PX = 400;

const parseStylePx = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(trimmed);
    if (match) return Number(match[1]);
  }
  return null;
};

const styleRecord = (node: Extract<QuizAstNode, { kind: "element" }>): Record<string, unknown> => {
  const style = node.props.style;
  if (style && typeof style === "object" && !Array.isArray(style)) {
    return style as Record<string, unknown>;
  }
  return {};
};

const isFullSpan = (value: unknown): boolean =>
  value === "100%" || value === "100";

/**
 * Non-blocking hints when agents treat the slide quiz element as a viewport and
 * letterbox a fixed-width card inside (e.g. width: 680 centered in a 1200×920 box).
 */
export const auditQuizLayoutSizing = (root: QuizAstNode): string[] => {
  const messages: string[] = [];
  if (root.kind !== "element" || root.tag !== "QuizContainer") return messages;

  const rootStyle = styleRecord(root);
  if (!isFullSpan(rootStyle.width) || !isFullSpan(rootStyle.height)) {
    messages.push(
      'QuizContainer root should use style width/height "100%" to fill the slide quiz element box (editor blue frame). Do not treat it as a page viewport with a smaller centered card inside.',
    );
  }

  const walk = (node: QuizAstNode, isRoot: boolean): void => {
    if (node.kind !== "element") return;
    if (QUIZ_LAYOUT_BOX_TAGS.has(node.tag) && !isRoot) {
      const style = styleRecord(node);
      const widthPx = parseStylePx(style.width);
      const maxWidthPx = parseStylePx(style.maxWidth);
      if (widthPx != null && widthPx >= FIXED_LAYOUT_MIN_PX) {
        messages.push(
          `Inner <${node.tag}> uses fixed width ${widthPx}px; prefer width: "100%" on layout sections and set footprint with quiz element --size-w/--size-h instead of letterboxing inside a large box.`,
        );
      } else if (
        maxWidthPx != null &&
        maxWidthPx >= FIXED_LAYOUT_MIN_PX &&
        !isFullSpan(style.width)
      ) {
        messages.push(
          `Inner <${node.tag}> caps layout at maxWidth ${maxWidthPx}px while the quiz element may be larger; use width: "100%" unless intentionally constraining a single control (not the whole card).`,
        );
      }
    }
    for (const child of node.children) walk(child, false);
  };

  walk(root, true);
  return [...new Set(messages)];
};
