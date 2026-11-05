// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fill-blank stems use runs of underscores in `question.title` as blank slots.
 * At render time each run becomes an inline `<QuizInput inline />` inside `<QuizTitle>`.
 */

import type { ContentLanguage } from "./content-language.ts";
import type { QuizAstNode, QuizAstPropValue, QuizTag } from "./quiz-ast.ts";
import type { QuizFillBlank, QuizFillBlankQuestion } from "./quiz.ts";
import { newBlankId, newQuizBlank } from "./quiz.ts";

/** Minimum underscores that form one blank slot (e.g. `___`). */
export const FILL_BLANK_UNDERSCORE_MIN_RUN = 2;

/** Canonical blank marker appended in the editor (distinct from neighboring runs). */
export const FILL_BLANK_SLOT_MARKER = "____";

const UNDERSCORE_BLANK_RE = new RegExp(`_{${FILL_BLANK_UNDERSCORE_MIN_RUN},}`, "g");

export type FillBlankTitleSegment =
  | { kind: "text"; text: string }
  | { kind: "blank"; index: number };

/** Split title into literal text and blank slot indices (0-based). */
export const parseFillBlankTitleSegments = (title: string): FillBlankTitleSegment[] => {
  const segments: FillBlankTitleSegment[] = [];
  let lastIndex = 0;
  let blankIndex = 0;
  const re = new RegExp(UNDERSCORE_BLANK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(title)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: title.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "blank", index: blankIndex });
    blankIndex += 1;
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < title.length) {
    segments.push({ kind: "text", text: title.slice(lastIndex) });
  }
  return segments;
};

export const countFillBlankSlotsInTitle = (title: string): number =>
  parseFillBlankTitleSegments(title).filter((s) => s.kind === "blank").length;

export const titleHasFillBlankUnderscores = (title: string): boolean =>
  countFillBlankSlotsInTitle(title) > 0;

/** Parse equivalent-answer aliases from a comma-separated editor string (English or Chinese comma). */
export const parseCommaSeparatedAliases = (raw: string): string[] =>
  raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Remove the blank slot at `slotIndex` (0-based) from `title`, preserving other runs. */
export const removeFillBlankSlotAtIndex = (title: string, slotIndex: number): string => {
  if (slotIndex < 0) return title;
  const re = new RegExp(UNDERSCORE_BLANK_RE.source, "g");
  let match: RegExpExecArray | null;
  let currentIndex = 0;
  while ((match = re.exec(title)) !== null) {
    if (currentIndex === slotIndex) {
      return title.slice(0, match.index) + title.slice(match.index + match[0].length);
    }
    currentIndex += 1;
  }
  return title;
};

/**
 * Append a new blank slot after question content. Inserts a space before the marker when
 * `title` already ends with an underscore run so the new slot stays distinct.
 */
export const appendFillBlankSlotToTitle = (
  title: string,
  marker: string = FILL_BLANK_SLOT_MARKER,
): string => {
  if (marker.length < FILL_BLANK_UNDERSCORE_MIN_RUN || !/^_{2,}$/.test(marker)) {
    return title;
  }
  const trimmed = title.trimEnd();
  if (/_{2,}$/.test(trimmed)) {
    return `${trimmed} ${marker}`;
  }
  return `${title}${marker}`;
};

/** Default stem for new fill-blank questions (one blank), by courseware content language. */
const DEFAULT_FILL_BLANK_QUESTION_TITLE_BY_LANGUAGE: Record<ContentLanguage, string> = {
  zh: "请输入题干：_____",
  en: "Enter the stem here: _____",
  ja: "設問を入力：_____",
};

export const getDefaultFillBlankQuestionTitle = (language: ContentLanguage): string =>
  DEFAULT_FILL_BLANK_QUESTION_TITLE_BY_LANGUAGE[language];

/** zh default stem (legacy constant; new questions use `getDefaultFillBlankQuestionTitle`). */
export const DEFAULT_FILL_BLANK_QUESTION_TITLE = DEFAULT_FILL_BLANK_QUESTION_TITLE_BY_LANGUAGE.zh;

/** Default reference label for the starter blank, by courseware content language. */
const DEFAULT_FILL_BLANK_ANSWER_LABEL_BY_LANGUAGE: Record<ContentLanguage, string> = {
  zh: "答案",
  en: "Answer",
  ja: "解答",
};

export const getDefaultFillBlankAnswerLabel = (language: ContentLanguage): string =>
  DEFAULT_FILL_BLANK_ANSWER_LABEL_BY_LANGUAGE[language];

/** zh default label; also the width fallback for blanks whose answer is still empty. */
export const DEFAULT_FILL_BLANK_ANSWER_LABEL = DEFAULT_FILL_BLANK_ANSWER_LABEL_BY_LANGUAGE.zh;

/** Extra `em` beyond the longest reference answer (typing comfort). */
export const FILL_BLANK_INLINE_WIDTH_EXTRA_EM = 2;

/** Width in `em` from reference answer only (aliases do not affect layout) plus extra margin. */
export const inlineBlankWidthEmForBlank = (
  blank: Pick<QuizFillBlank, "answer">,
): number => {
  const raw = blank.answer.trim();
  const contentLen =
    raw.length > 0 ? Array.from(raw).length : Array.from(DEFAULT_FILL_BLANK_ANSWER_LABEL).length;
  return Math.max(2, contentLen) + FILL_BLANK_INLINE_WIDTH_EXTRA_EM;
};

export const inlineBlankInputStyleForBlank = (
  blank: Pick<QuizFillBlank, "answer" | "aliases">,
): Record<string, string | number> => {
  const em = inlineBlankWidthEmForBlank(blank);
  return {
    width: `${em}em`,
    minWidth: `${em}em`,
    textAlign: "center",
  };
};

const normalizeBlank = (blank: QuizFillBlank): QuizFillBlank => ({
  ...blank,
  aliases: Array.isArray(blank.aliases) ? [...blank.aliases] : [],
});

/**
 * Resize `blanks[]` to match underscore slot count. Preserves existing entries in order.
 * When the title has no `___` markers, keeps explicit `blanks[]` (custom JSX workflows).
 */
export const syncFillBlankEntriesForTitle = (
  title: string,
  blanks: readonly QuizFillBlank[],
): QuizFillBlank[] => {
  const need = countFillBlankSlotsInTitle(title);
  if (need === 0) {
    return blanks.map((b) => normalizeBlank(b));
  }
  const out: QuizFillBlank[] = [];
  for (let i = 0; i < need; i += 1) {
    const existing = blanks[i];
    out.push(existing ? normalizeBlank(existing) : newQuizBlank({ blank_id: newBlankId() }));
  }
  return out;
};

const t = (text: string): QuizAstNode => ({ kind: "text", text });
const e = (
  tag: QuizTag,
  props: Record<string, QuizAstPropValue> = {},
  children: QuizAstNode[] = [],
): QuizAstNode => ({
  kind: "element",
  tag,
  props,
  children,
});

const DEFAULT_TITLE_STYLE: Record<string, string | number> = {
  fontSize: 30,
  fontWeight: 600,
  lineHeight: 1.35,
  marginBottom: 4,
  color: "#4a4a46",
};

const mergeTitleStyle = (
  authorStyle: Record<string, QuizAstPropValue> | undefined,
): Record<string, string | number> => {
  const base = { ...DEFAULT_TITLE_STYLE };
  if (!authorStyle || typeof authorStyle !== "object") return base;
  for (const [key, value] of Object.entries(authorStyle)) {
    if (typeof value === "string" || typeof value === "number") {
      (base as Record<string, string | number>)[key] = value;
    }
  }
  return base;
};

/** Build inline stem children (text + `<QuizInput inline />`) for a title. */
export const buildFillBlankTitleChildNodes = (
  title: string,
  blanks: readonly QuizFillBlank[],
): QuizAstNode[] => {
  const segments = parseFillBlankTitleSegments(title);
  const children: QuizAstNode[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      if (seg.text) children.push(t(seg.text));
      continue;
    }
    const blank = blanks[seg.index];
    if (!blank) continue;
    children.push(
      e(
        "QuizInput",
        {
          name: blank.blank_id,
          inline: true,
          style: inlineBlankInputStyleForBlank(blank),
        },
        [],
      ),
    );
  }
  return children;
};

/** Build `<QuizTitle>…</QuizTitle>` from title + blank ids. */
export const buildFillBlankQuizTitleAst = (
  title: string,
  blanks: readonly QuizFillBlank[],
  titleStyle: Record<string, string | number> = DEFAULT_TITLE_STYLE,
): QuizAstNode => {
  return e("QuizTitle", { style: titleStyle }, buildFillBlankTitleChildNodes(title, blanks));
};

const patchQuizAstTree = (
  node: QuizAstNode,
  visit: (node: QuizAstNode, ctx: { insideTitle: boolean }) => QuizAstNode | null,
  insideTitle = false,
): QuizAstNode | null => {
  const mapped = visit(node, { insideTitle });
  if (mapped === null) return null;
  const next = mapped;
  if (next.kind === "element" || next.kind === "stateBranch") {
    const childInside = insideTitle || (next.kind === "element" && next.tag === "QuizTitle");
    const children: QuizAstNode[] = [];
    for (const child of next.children) {
      const patched = patchQuizAstTree(child, visit, childInside);
      if (patched) children.push(patched);
    }
    return { ...next, children };
  }
  return next;
};

/** Rebind inline `<QuizInput>` nodes under the first `<QuizTitle>` to `blanks[]` order. */
const rebindInlineInputsUnderTitle = (
  titleNode: Extract<QuizAstNode, { kind: "element" }>,
  blanks: readonly QuizFillBlank[],
): QuizAstNode => {
  let inputIndex = 0;
  const visit = (node: QuizAstNode): QuizAstNode | null => {
    if (node.kind !== "element" || node.tag !== "QuizInput" || !node.props.inline) {
      return node;
    }
    const blank = blanks[inputIndex];
    inputIndex += 1;
    if (!blank) return node;
    return {
      ...node,
      props: {
        ...node.props,
        name: blank.blank_id,
        inline: true,
        style: inlineBlankInputStyleForBlank(blank),
      },
    };
  };
  const patched = patchQuizAstTree(titleNode, (n, ctx) => {
    if (n.kind === "element" && n.tag === "QuizInput" && ctx.insideTitle && n.props.inline) {
      return visit(n);
    }
    return n;
  });
  return (patched ?? titleNode) as Extract<QuizAstNode, { kind: "element" }>;
};

/**
 * Patch custom `react_layout`: keep one `<QuizTitle>`, inject stem from `title`/`blanks`,
 * drop duplicate titles, legacy `ol`, and stray `<QuizInput>`.
 */
export const patchFillBlankTitleInLayout = (
  layout: QuizAstNode,
  title: string,
  blanks: readonly QuizFillBlank[],
): QuizAstNode => {
  if (layout.kind !== "element" || layout.tag !== "QuizContainer") {
    return layout;
  }
  const slots = countFillBlankSlotsInTitle(title);
  const stemChildren = slots > 0 ? buildFillBlankTitleChildNodes(title, blanks) : null;
  let titleSeen = false;

  const patched = patchQuizAstTree(layout, (node, ctx) => {
    if (node.kind !== "element") return node;
    if (node.tag === "QuizTitle") {
      if (titleSeen) return null;
      titleSeen = true;
      const style = mergeTitleStyle(node.props.style as Record<string, QuizAstPropValue> | undefined);
      if (stemChildren && stemChildren.length > 0) {
        return e("QuizTitle", { ...node.props, style }, stemChildren);
      }
      return rebindInlineInputsUnderTitle(
        e("QuizTitle", { ...node.props, style }, node.children) as Extract<QuizAstNode, { kind: "element" }>,
        blanks,
      );
    }
    if (node.tag === "ol") return null;
    if (node.tag === "QuizInput" && !ctx.insideTitle) return null;
    return node;
  });

  if (!patched || patched.kind !== "element" || patched.tag !== "QuizContainer") {
    return layout;
  }
  if (!titleSeen && stemChildren && stemChildren.length > 0) {
    return {
      ...patched,
      children: [
        buildFillBlankQuizTitleAst(title, blanks, mergeTitleStyle(undefined)),
        ...patched.children,
      ],
    };
  }
  return patched;
};

/** Sync `title` → `blanks[]` and inline `QuizTitle` AST for a fill-blank question. */
export const applyFillBlankTitleToQuestion = <Q extends QuizFillBlankQuestion>(question: Q): Q => {
  const blanks = syncFillBlankEntriesForTitle(question.title, question.blanks);
  const react_layout = patchFillBlankTitleInLayout(question.react_layout, question.title, blanks);
  return { ...question, blanks, react_layout };
};

export const validateFillBlankTitleModel = (
  question: QuizFillBlankQuestion,
  pathPrefix = "questions[]",
): string[] => {
  const issues: string[] = [];
  const slots = countFillBlankSlotsInTitle(question.title);
  if (slots === 0) {
    if (question.blanks.length < 1) {
      issues.push(
        `${pathPrefix}.title: fill_blank needs \`___\` blank markers in title, or at least one entry in blanks[] for custom JSX`,
      );
    }
    return issues;
  }
  if (question.blanks.length !== slots) {
    issues.push(
      `${pathPrefix}.blanks: expected ${slots} blank(s) to match title underscore slots, got ${question.blanks.length}`,
    );
  }
  return issues;
};
