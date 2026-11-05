// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import { fillElementInputGaps, resolveChildRefByIdOrName } from "./element-input-compat.ts";
import { newElementId, newPauseId } from "./ids.ts";
import { cloneSlideWithNewIds } from "./clone-slide.ts";
import {
  FLOW_PAUSE_DISALLOWED_ELEMENT_TYPES,
  resolveFlowPauseAtMsForElement,
} from "@ainobi/courseware-core/flow-pause-agent.ts";
import type { Element } from "@ainobi/courseware-core/elements.ts";
import {
  FLOW_PAUSE_TIME_EPSILON_MS,
  clampFlowPauseAtMs,
  normalizeSlideFlowPausePoints,
  remapSlideFlowPausePoints,
  remapSlideFlowPausePointsOnDurationChange,
} from "@ainobi/courseware-core/slide-flow-pause.ts";
import {
  ELEMENT_PATCH_FORBIDDEN,
  rejectForbiddenPatchKeys,
  rejectInvalidContentLanguagePatch,
  SCENE_PATCH_FORBIDDEN,
  SLIDE_PATCH_FORBIDDEN,
} from "./mutation-guards.ts";
import { deepMerge } from "./patch.ts";
import { assertRichInsertHasLayout } from "./rich-layout-guards.ts";
import { applyDefaultElementNameIfEmpty } from "@ainobi/courseware-core/element-default-names.ts";
import { ELEMENT_TYPES_VALID_AS_SLIDE_CHILD, getElementScaffold } from "./templates.ts";
import {
  applyFillBlankTitleToQuestion,
  buildDefaultQuizAst,
  createDefaultQuestion,
  createDefaultQuestionWithAst,
  coerceFillBlankBlanksFromAgentPatch,
  coerceQuizChoiceOptionsFromAgentPatch,
  createDefaultQuizConfig,
  maybeApplyEvenQuizScores,
  defaultQuizElementLayoutForSlide,
  defaultQuizScoreSummaryElementLayoutForSlide,
  resolveQuizScoreSummaryConfigForCanvasAdd,
  layoutSizingWarningsForQuestion,
  normalizeQuizChoiceOptionValues,
  parsePptSlideRanges,
  parseQuizAstFromJson,
  readSceneContentLanguage,
  ensureScoreSummaryAstInterpSlots,
  parseScoreSummaryAstFromJson,
  validateQuizAst,
  validateQuizScoreSummaryAst,
  type ContentLanguage,
  type ElementType,
  type QuizAstNode,
  type QuizQuestion,
  type QuizQuestionType,
  type QuizScoreSummaryAstNode,
  type SlideElement,
} from "@ainobi/courseware-core";
import { ensureQuizAstInterpSlots } from "@ainobi/courseware-core/quiz-ast-interp-fill.ts";
import { parseQuizJsxWithMeta, QuizJsxParseError } from "./quiz-jsx-parser.ts";
import { parseScoreSummaryJsxWithMeta } from "./score-summary-jsx-parser.ts";

/** Agents keep the CLI's historical two-option single-choice default (reused layouts match). */
const CLI_DEFAULT_QUESTION_OPTIONS = { singleChoiceOptionCount: 2 } as const;

export interface Operation {
  op: string;
  id?: string;
  [key: string]: unknown;
}

export interface OperationApplyResult {
  op: string;
  id?: string;
  data: Record<string, unknown>;
}

const asObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AinobiCliError("INVALID_INPUT", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new AinobiCliError("INVALID_INPUT", `${label} must be a non-empty string.`);
  }
  return value;
};

const asNumber = (value: unknown, label: string, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new AinobiCliError("INVALID_INPUT", `${label} must be a finite number.`);
  }
  return n;
};

/**
 * Courseware content language for copy the CLI bakes into the scene (default quiz labels…).
 * It must be set explicitly (`ainobi init --language`, or `scene.update` after confirming
 * with the user); there is no fallback, so legacy scenes without it are refused here.
 */
const requireSceneLanguage = (scene: Record<string, unknown>): ContentLanguage => {
  const language = readSceneContentLanguage(scene);
  if (language) return language;
  throw new AinobiCliError(
    "USAGE",
    'Scene has no metadata.language. Confirm the courseware language (zh / en / ja) with the user, then run scene.update {"metadata":{"language":"<code>"}} and retry. This applies to every quiz.insert (including ones that pass --jsx / react_layout), to quiz.update with --jsx / react_layout, and to quiz.score_summary.insert without --jsx / react_layout: the question stem placeholder, default button labels, the default score-summary card and any other default copy are generated in this language.',
  );
};

const slidesOf = (scene: Record<string, unknown>): Record<string, unknown>[] =>
  (scene.slide_elements as Record<string, unknown>[] | undefined) ?? [];

const childrenOf = (slide: Record<string, unknown>): Record<string, unknown>[] =>
  (slide.children_elements as Record<string, unknown>[] | undefined) ?? [];

/** Collect `quiz_question_id` values from quiz children on a slide (or a single element). */
const collectQuizQuestionIdsFromElements = (
  elements: readonly Record<string, unknown>[],
): string[] => {
  const ids: string[] = [];
  for (const el of elements) {
    if (el.element_type !== "quiz") continue;
    const qid = String(el.quiz_question_id ?? "").trim();
    if (qid) ids.push(qid);
  }
  return ids;
};

/**
 * Remove `scene.quiz.questions[]` entries whose `question_id` is in `questionIds`.
 * Rebalances even-split scores when any question is removed.
 */
const removeQuizQuestionsByIds = (
  scene: Record<string, unknown>,
  questionIds: readonly string[],
): string[] => {
  if (questionIds.length === 0 || !scene.quiz) return [];
  const wanted = new Set(questionIds.filter(Boolean));
  if (wanted.size === 0) return [];
  const quiz = scene.quiz as Record<string, unknown>;
  const questions = (quiz.questions as Record<string, unknown>[] | undefined) ?? [];
  const removed: string[] = [];
  const kept: Record<string, unknown>[] = [];
  for (const q of questions) {
    const id = String(q.question_id ?? "");
    if (wanted.has(id)) {
      removed.push(id);
    } else {
      kept.push(q);
    }
  }
  if (removed.length === 0) return [];
  quiz.questions = kept;
  scene.quiz = maybeApplyEvenQuizScores(quiz as never) as never;
  return removed;
};

/** Bound question ids currently referenced by any slide quiz element. */
const collectBoundQuizQuestionIds = (scene: Record<string, unknown>): Set<string> => {
  const bound = new Set<string>();
  for (const slide of slidesOf(scene)) {
    for (const id of collectQuizQuestionIdsFromElements(childrenOf(slide))) {
      bound.add(id);
    }
  }
  return bound;
};

/**
 * Drop `scene.quiz.questions[]` entries with no matching slide quiz element.
 * Returns the pruned question ids (empty when nothing changed).
 */
export const pruneOrphanQuizQuestionsInScene = (scene: Record<string, unknown>): string[] => {
  if (!scene.quiz) return [];
  const quiz = scene.quiz as Record<string, unknown>;
  const questions = (quiz.questions as Record<string, unknown>[] | undefined) ?? [];
  if (questions.length === 0) return [];
  const bound = collectBoundQuizQuestionIds(scene);
  const orphanIds = questions
    .map((q) => String(q.question_id ?? ""))
    .filter((id) => id && !bound.has(id));
  return removeQuizQuestionsByIds(scene, orphanIds);
};

/** Minimum gap between successive quiz elements stacked on the same slide (ms). */
const ANIMATION_STAGGER_SKIP_ELEMENT_TYPES = new Set([
  "html",
  "quiz",
  "quiz_score_summary",
  "vtuber",
  "narration",
]);

const slideTimelineBounds = (
  slide: Record<string, unknown>,
): { start_at: number; end_at: number } => {
  const timeline = slide.timeline as { start_at?: number; end_at?: number } | undefined;
  return {
    start_at: Number(timeline?.start_at ?? 0),
    end_at: Number(timeline?.end_at ?? 5000),
  };
};

const payloadHasExplicitTimeline = (payload: Record<string, unknown>): boolean => {
  const timeline = payload.timeline;
  if (timeline === undefined || typeof timeline !== "object" || timeline === null || Array.isArray(timeline)) {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(timeline, "start_at") ||
    Object.prototype.hasOwnProperty.call(timeline, "end_at")
  );
};

const applyInsertTimelineDefaults = (
  element: Record<string, unknown>,
  slide: Record<string, unknown>,
  overrides: Record<string, unknown>,
): void => {
  const slideBounds = slideTimelineBounds(slide);
  if (!payloadHasExplicitTimeline(overrides)) {
    element.timeline = slideBounds;
    return;
  }
  const overrideTimeline = overrides.timeline as Record<string, unknown>;
  const hasStart = Object.prototype.hasOwnProperty.call(overrideTimeline, "start_at");
  const hasEnd = Object.prototype.hasOwnProperty.call(overrideTimeline, "end_at");
  const start_at = hasStart ? Number(overrideTimeline.start_at) : slideBounds.start_at;
  const end_at = hasEnd ? Number(overrideTimeline.end_at) : slideBounds.end_at;
  const timeline = (element.timeline as Record<string, unknown> | undefined) ?? {};
  element.timeline = {
    ...timeline,
    start_at,
    end_at: Math.max(start_at, end_at),
  };
};

/** `html` elements default to the parent slide's full timeline unless timing is explicit. */
const applyDefaultFullSlideTimelineIfNeeded = (
  type: ElementType,
  element: Record<string, unknown>,
  slide: Record<string, unknown>,
  insertPayload: Record<string, unknown>,
): void => {
  if (type !== "html") return;
  applyInsertTimelineDefaults(element, slide, insertPayload);
};

const countScoreSummaryAstNodes = (
  node: { kind: string; children?: unknown[] } | null | undefined,
): number => {
  if (!node || typeof node !== "object") return 0;
  let total = 1;
  const children = (node as { children?: unknown[] }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      total += countScoreSummaryAstNodes(child as { kind: string });
    }
  }
  return total;
};

const applyTimelineStartAt = (element: Record<string, unknown>, startAt: number): void => {
  const timeline = (element.timeline as Record<string, unknown> | undefined) ?? {};
  const previousStart = Number(timeline.start_at ?? 0);
  const endAt = Number(timeline.end_at ?? startAt);
  element.timeline = {
    ...timeline,
    start_at: startAt,
    end_at: Math.max(startAt, endAt),
  };
  const keyframes = element.keyframes as Array<Record<string, unknown>> | undefined;
  if (!keyframes?.length) return;
  const delta = startAt - previousStart;
  if (delta === 0) return;
  element.keyframes = keyframes.map((frame) => ({
    ...frame,
    at: Number(frame.at ?? 0) + delta,
  }));
};

export const findSlideIndexInJson = (
  scene: Record<string, unknown>,
  ref: unknown,
): number => {
  const slides = slidesOf(scene);
  if (ref === undefined || ref === null || ref === "") {
    throw new AinobiCliError("USAGE", "Missing slide reference.");
  }
  if (typeof ref === "number" || /^-?\d+$/.test(String(ref))) {
    const idx = Number(ref);
    if (idx < 0 || idx >= slides.length) {
      throw new AinobiCliError("NOT_FOUND", `slide index ${idx} is out of range (0..${slides.length - 1}).`);
    }
    return idx;
  }
  const idx = slides.findIndex((slide) => slide.element_id === ref);
  if (idx < 0) throw new AinobiCliError("NOT_FOUND", `slide not found: "${String(ref)}".`);
  return idx;
};

export const findChildIndexInJson = (
  slide: Record<string, unknown>,
  ref: unknown,
): number => {
  const children = childrenOf(slide);
  if (ref === undefined || ref === null || ref === "") {
    throw new AinobiCliError("USAGE", "Missing element reference.");
  }
  if (typeof ref === "number" || /^-?\d+$/.test(String(ref))) {
    const idx = Number(ref);
    if (idx < 0 || idx >= children.length) {
      throw new AinobiCliError("NOT_FOUND", `element index ${idx} is out of range (0..${children.length - 1}).`);
    }
    return idx;
  }
  return resolveChildRefByIdOrName(children as Array<Record<string, unknown>>, String(ref));
};

const insertAt = <T>(items: T[], item: T, at: unknown): number => {
  const idx = at === undefined ? items.length : Math.max(0, Math.min(Math.floor(Number(at)), items.length));
  items.splice(idx, 0, item);
  return idx;
};

const fixTransitions = (scene: Record<string, unknown>): void => {
  const slideCount = slidesOf(scene).length;
  const needed = Math.max(0, slideCount - 1);
  const transitions = [...((scene.transitions as string[] | undefined) ?? [])];
  while (transitions.length < needed) transitions.push("none");
  scene.transitions = transitions.slice(0, needed);
};

const buildSlide = (payload: Record<string, unknown> = {}): Record<string, unknown> => {
  const slide = deepMerge(getElementScaffold("slide"), payload) as Record<string, unknown>;
  slide.element_type = "slide";
  slide.element_id = newElementId("slide");
  slide.children_elements = [];
  return slide;
};

const validChildType = (type: string): ElementType => {
  if (!ELEMENT_TYPES_VALID_AS_SLIDE_CHILD.includes(type as ElementType)) {
    throw new AinobiCliError("INVALID_INPUT", `element_type "${type}" is not allowed inside a slide.`);
  }
  return type as ElementType;
};

const buildElement = (
  type: ElementType,
  payload: Record<string, unknown> = {},
  slide?: Pick<SlideElement, "children_elements">,
): Record<string, unknown> => {
  const element = deepMerge(getElementScaffold(type), payload) as Record<string, unknown>;
  element.element_type = type;
  element.element_id = newElementId(type);
  if (type === "group" || type === "html") {
    element.children_elements = (element.children_elements as unknown[] | undefined) ?? [];
  } else {
    delete element.children_elements;
  }
  if (slide) {
    applyDefaultElementNameIfEmpty(element, type, slide);
  }
  return element;
};

const applySlideTemplate = (scene: Record<string, unknown>, op: Operation): OperationApplyResult => {
  const kind = String(op.kind ?? op.template ?? "hero");
  const title = String(op.title ?? "");
  const subtitle = String(op.subtitle ?? "");
  const duration = asNumber(op.duration ?? op.duration_ms, "duration", 10000);
  const background = String(op.background ?? "#FFFFFF");
  const visual = typeof op.visual === "string" ? op.visual : "";
  const slide = buildSlide({
    name: title || kind,
    background_color: background,
    timeline: { start_at: 0, end_at: duration },
  });
  const children = childrenOf(slide);
  const addText = (
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    z: number,
    color: string,
  ): void => {
    children.push(buildElement("text", {
      name,
      text,
      position: { x, y },
      size: { width, height },
      timeline: { start_at: 0, end_at: duration },
      font_size: fontSize,
      color,
      bold: fontSize >= 48,
      style: { opacity: 1, rotation_deg: 0, z_index: z },
    }));
  };
  if (kind === "section") {
    addText("章节标题", title || "章节", 180, 430, 1560, 120, 72, 1, "#0F172A");
    if (subtitle) addText("章节说明", subtitle, 240, 560, 1440, 80, 32, 2, "#475569");
  } else {
    addText("标题", title || "课程标题", 120, 220, visual ? 980 : 1680, 140, 72, 2, "#0F172A");
    if (subtitle) addText("副标题", subtitle, 128, 390, visual ? 900 : 1500, 110, 34, 3, "#475569");
    if (visual) {
      children.push(buildElement("image", {
        name: "主视觉",
        source: visual,
        position: { x: 1120, y: 220 },
        size: { width: 640, height: 520 },
        timeline: { start_at: 0, end_at: duration },
        style: { opacity: 1, rotation_deg: 0, z_index: 1 },
      }));
    }
  }
  slide.children_elements = children;
  const slides = slidesOf(scene);
  const index = insertAt(slides, slide, op.at);
  scene.slide_elements = slides;
  fixTransitions(scene);
  return { op: "slide.template", id: op.id, data: { inserted_at: index, element_id: slide.element_id, kind } };
};

const getElement = (scene: Record<string, unknown>, slideRef: unknown, elementRef: unknown): { slideIndex: number; childIndex: number; slide: Record<string, unknown>; element: Record<string, unknown> } => {
  const slideIndex = findSlideIndexInJson(scene, slideRef);
  const slide = slidesOf(scene)[slideIndex];
  const childIndex = findChildIndexInJson(slide, elementRef);
  const element = childrenOf(slide)[childIndex];
  return { slideIndex, childIndex, slide, element };
};

const baseKeyframe = (element: Record<string, unknown>, at: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  at,
  position: { ...(element.position as Record<string, unknown>) },
  size: { ...(element.size as Record<string, unknown>) },
  rotation_deg: (element.style as Record<string, unknown> | undefined)?.rotation_deg ?? 0,
  opacity: (element.style as Record<string, unknown> | undefined)?.opacity ?? 1,
  easing: "ease-out",
  ...overrides,
});

const applyAnimationPresetToElement = (element: Record<string, unknown>, kind: string, from: number, to: number): void => {
  const style = (element.style as Record<string, unknown> | undefined) ?? {};
  const pos = (element.position as Record<string, number> | undefined) ?? { x: 0, y: 0 };
  const size = (element.size as Record<string, number> | undefined) ?? { width: 1, height: 1 };
  const current = [...((element.keyframes as unknown[] | undefined) ?? [])] as Record<string, unknown>[];
  let next: Record<string, unknown>[];
  switch (kind) {
    case "fade-up":
      next = [
        baseKeyframe(element, from, { position: { x: pos.x, y: pos.y + 40 }, opacity: 0 }),
        baseKeyframe(element, to, { position: pos, opacity: style.opacity ?? 1 }),
      ];
      break;
    case "zoom-in":
      next = [
        baseKeyframe(element, from, { size: { width: size.width * 0.9, height: size.height * 0.9 }, opacity: 0 }),
        baseKeyframe(element, to, { size, opacity: style.opacity ?? 1 }),
      ];
      break;
    case "pan":
      next = [
        baseKeyframe(element, from, { position: pos }),
        baseKeyframe(element, to, { position: { x: pos.x + 80, y: pos.y } }),
      ];
      break;
    case "pulse":
      next = [
        baseKeyframe(element, from),
        baseKeyframe(element, Math.floor((from + to) / 2), { size: { width: size.width * 1.05, height: size.height * 1.05 } }),
        baseKeyframe(element, to),
      ];
      break;
    case "fade-out":
      next = [baseKeyframe(element, from), baseKeyframe(element, to, { opacity: 0 })];
      break;
    case "fade-in":
    default:
      next = [baseKeyframe(element, from, { opacity: 0 }), baseKeyframe(element, to, { opacity: style.opacity ?? 1 })];
      break;
  }
  element.keyframes = [...current.filter((kf) => {
    const at = Number(kf.at);
    return !Number.isFinite(at) || at < from || at > to;
  }), ...next].sort((a, b) => Number(a.at) - Number(b.at));
  const timeline = (element.timeline as Record<string, unknown> | undefined) ?? {};
  element.timeline = {
    start_at: Math.min(Number(timeline.start_at ?? from), from),
    end_at: Math.max(Number(timeline.end_at ?? to), to),
  };
};

const slideEndAtMs = (slide: Record<string, unknown>): number | null => {
  const endAt = Number((slide.timeline as Record<string, unknown> | undefined)?.end_at);
  return Number.isFinite(endAt) ? endAt : null;
};

/** Keep preset/stagger keyframes and element end_at inside the slide bar (e.g. after --fit-slide). */
const clampElementAnimationToSlide = (
  element: Record<string, unknown>,
  slide: Record<string, unknown>,
): void => {
  const slideEnd = slideEndAtMs(slide);
  if (slideEnd === null) return;
  const timeline = (element.timeline as Record<string, unknown> | undefined) ?? {};
  const endAt = Number(timeline.end_at ?? slideEnd);
  if (endAt > slideEnd) {
    element.timeline = { ...timeline, end_at: slideEnd };
  }
  const keyframes = element.keyframes;
  if (!Array.isArray(keyframes)) return;
  element.keyframes = keyframes.map((kf) => {
    if (!kf || typeof kf !== "object") return kf;
    const row = { ...(kf as Record<string, unknown>) };
    const at = Number(row.at);
    if (Number.isFinite(at) && at > slideEnd) row.at = slideEnd;
    return row;
  });
};

const ensureQuiz = (scene: Record<string, unknown>): Record<string, unknown> => {
  if (!scene.quiz) scene.quiz = createDefaultQuizConfig() as unknown as Record<string, unknown>;
  return scene.quiz as Record<string, unknown>;
};

const parseQuizJsxOrThrow = (
  source: string,
  label: string,
  language: ContentLanguage,
): { ast: QuizAstNode; layout_interp_fixes: string[] } => {
  try {
    return parseQuizJsxWithMeta(source, language);
  } catch (error) {
    if (error instanceof QuizJsxParseError) {
      throw new AinobiCliError("INVALID_INPUT", `${label}: ${error.message}`);
    }
    throw new AinobiCliError(
      "INVALID_INPUT",
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const parseQuizAstFromJsonOrThrow = (
  input: unknown,
  label: string,
  language: ContentLanguage,
): { ast: QuizAstNode; layout_interp_fixes: string[] } => {
  try {
    const ast = parseQuizAstFromJson(input, label);
    return ensureQuizAstInterpSlots(ast, language);
  } catch (error) {
    throw new AinobiCliError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : String(error),
    );
  }
};

const parseScoreSummaryJsxOrThrow = (
  source: string,
  label: string,
): { ast: QuizScoreSummaryAstNode; layout_interp_fixes: string[] } => {
  try {
    return parseScoreSummaryJsxWithMeta(source);
  } catch (error) {
    if (error instanceof QuizJsxParseError) {
      throw new AinobiCliError("INVALID_INPUT", `${label}: ${error.message}`);
    }
    throw new AinobiCliError(
      "INVALID_INPUT",
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const parseScoreSummaryAstFromJsonOrThrow = (
  input: unknown,
  label: string,
): { ast: QuizScoreSummaryAstNode; layout_interp_fixes: string[] } => {
  try {
    const ast = parseScoreSummaryAstFromJson(input, label);
    return ensureScoreSummaryAstInterpSlots(ast);
  } catch (error) {
    throw new AinobiCliError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : String(error),
    );
  }
};

/**
 * Parse a CUSTOM score-summary layout (JSX first, then JSON). The default card is not
 * built here: it bakes learner-visible copy, so callers build it with the scene language.
 */
const resolveScoreSummaryLayoutAst = (
  jsxSource: string | undefined,
  reactLayoutFromJson: unknown | undefined,
  label: string,
): { ast: QuizScoreSummaryAstNode; layout_interp_fixes: string[] } => {
  if (jsxSource !== undefined) {
    return parseScoreSummaryJsxOrThrow(jsxSource, `${label}.jsx`);
  }
  if (reactLayoutFromJson !== undefined) {
    return parseScoreSummaryAstFromJsonOrThrow(reactLayoutFromJson, `${label}.react_layout`);
  }
  throw new AinobiCliError("INTERNAL", `${label}: expected jsx or react_layout`);
};

const assertValidScoreSummaryLayout = (
  ast: QuizScoreSummaryAstNode,
  label: string,
): void => {
  const astIssues = validateQuizScoreSummaryAst(ast);
  if (astIssues.length > 0) {
    throw new AinobiCliError(
      "INVALID_INPUT",
      `${label} react_layout: ${astIssues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  }
};

const questionIndex = (quiz: Record<string, unknown>, ref: unknown): number => {
  const questions = (quiz.questions as Record<string, unknown>[] | undefined) ?? [];
  if (ref === undefined || ref === null || ref === "") {
    throw new AinobiCliError("USAGE", "Missing question reference.");
  }
  if (typeof ref === "number" || /^-?\d+$/.test(String(ref))) {
    const idx = Number(ref);
    if (idx < 0 || idx >= questions.length) throw new AinobiCliError("NOT_FOUND", `question index ${idx} is out of range.`);
    return idx;
  }
  const idx = questions.findIndex((q) => q.question_id === ref);
  if (idx < 0) throw new AinobiCliError("NOT_FOUND", `question not found: "${String(ref)}".`);
  return idx;
};

/** Same input-gap fixes as `element insert/update` commands, applied to a batch element in place. */
const fillElementGapsInPlace = (element: Record<string, unknown>): string[] => {
  const { record, fixes } = fillElementInputGaps(element);
  if (fixes.length === 0) return fixes;
  for (const key of Object.keys(element)) if (!(key in record)) delete element[key];
  Object.assign(element, record);
  return fixes;
};

export const applyOperation = (scene: Record<string, unknown>, operation: Operation): OperationApplyResult => {
  const opName = asString(operation.op, "operation.op");
  switch (opName) {
    case "scene.update": {
      const patch = asObject(operation.patch ?? {}, "scene.update.patch");
      rejectForbiddenPatchKeys(patch, SCENE_PATCH_FORBIDDEN, "scene.update.patch");
      rejectInvalidContentLanguagePatch(patch, "scene.update.patch");
      Object.assign(scene, deepMerge(scene, patch));
      return { op: opName, id: operation.id, data: { updated_fields: Object.keys(patch) } };
    }
    case "slide.insert": {
      const slide = buildSlide(asObject(operation.slide ?? operation.patch ?? {}, "slide.insert.slide"));
      const slides = slidesOf(scene);
      const index = insertAt(slides, slide, operation.at);
      scene.slide_elements = slides;
      fixTransitions(scene);
      return { op: opName, id: operation.id, data: { inserted_at: index, element_id: slide.element_id } };
    }
    case "slide.template":
      return applySlideTemplate(scene, operation);
    case "slide.update": {
      const idx = findSlideIndexInJson(scene, operation.slide ?? operation.ref);
      const slides = slidesOf(scene);
      const current = slides[idx] as Record<string, unknown>;
      const patch = asObject(operation.patch ?? {}, "slide.update.patch");
      rejectForbiddenPatchKeys(patch, SLIDE_PATCH_FORBIDDEN, "slide.update.patch");
      const previousTimeline = { ...(asObject(current.timeline ?? {}, "slide.timeline")) };
      const merged = deepMerge(current, patch) as Record<string, unknown>;
      merged.element_id = current.element_id;
      merged.children_elements = current.children_elements;
      remapSlideFlowPausePointsOnDurationChange(merged, previousTimeline);
      slides[idx] = merged;
      return { op: opName, id: operation.id, data: { updated_index: idx, updated_fields: Object.keys(patch) } };
    }
    case "slide.delete": {
      const idx = findSlideIndexInJson(scene, operation.slide ?? operation.ref);
      const removed = slidesOf(scene).splice(idx, 1)[0];
      const removedQuestionIds = removeQuizQuestionsByIds(
        scene,
        collectQuizQuestionIdsFromElements(childrenOf(removed)),
      );
      fixTransitions(scene);
      return {
        op: opName,
        id: operation.id,
        data: {
          removed_index: idx,
          removed_element_id: removed.element_id,
          removed_question_ids: removedQuestionIds,
        },
      };
    }
    case "slide.duplicate": {
      const idx = findSlideIndexInJson(scene, operation.slide ?? operation.ref);
      const { slide: clone } = cloneSlideWithNewIds(slidesOf(scene)[idx]);
      if (operation.name) clone.name = operation.name;
      const inserted = insertAt(slidesOf(scene), clone, operation.at ?? idx + 1);
      fixTransitions(scene);
      return { op: opName, id: operation.id, data: { source_index: idx, inserted_at: inserted, element_id: clone.element_id } };
    }
    case "slide.move": {
      const from = findSlideIndexInJson(scene, operation.slide ?? operation.ref);
      const slides = slidesOf(scene);
      const [slide] = slides.splice(from, 1);
      const to = Math.max(0, Math.min(Math.floor(asNumber(operation.to, "slide.move.to")), slides.length));
      slides.splice(to, 0, slide);
      fixTransitions(scene);
      return { op: opName, id: operation.id, data: { from, to } };
    }
    case "element.insert": {
      const slideIdx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[slideIdx];
      const type = validChildType(asString(operation.type ?? (operation.element as Record<string, unknown> | undefined)?.element_type, "element.insert.type"));
      const insertPayload = asObject(operation.element ?? operation.patch ?? {}, "element.insert.element");
      rejectForbiddenPatchKeys(insertPayload, ELEMENT_PATCH_FORBIDDEN, "element.insert.element");
      assertRichInsertHasLayout(type, insertPayload, "element.insert.element");
      const element = buildElement(type, insertPayload, slide as Pick<SlideElement, "children_elements">);
      applyDefaultFullSlideTimelineIfNeeded(type, element, slide, insertPayload);
      const insertFixes = fillElementGapsInPlace(element as Record<string, unknown>);
      const children = childrenOf(slide);
      const index = insertAt(children, element, operation.at);
      slide.children_elements = children;
      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIdx,
          inserted_at: index,
          element_id: element.element_id,
          ...(insertFixes.length > 0 ? { auto_fixed: insertFixes } : {}),
        },
      };
    }
    case "element.update": {
      const { slideIndex, childIndex, element } = getElement(scene, operation.slide, operation.element ?? operation.ref);
      const patch = asObject(operation.patch ?? {}, "element.update.patch");
      rejectForbiddenPatchKeys(patch, ELEMENT_PATCH_FORBIDDEN, "element.update.patch");
      const preservedId = element.element_id;
      const preservedChildren = element.children_elements;
      Object.assign(element, deepMerge(element, patch));
      element.element_id = preservedId;
      if (preservedChildren !== undefined) {
        element.children_elements = preservedChildren;
      } else {
        delete element.children_elements;
      }
      const updateFixes = fillElementGapsInPlace(element as Record<string, unknown>);
      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIndex,
          element_index: childIndex,
          updated_fields: Object.keys(patch),
          ...(updateFixes.length > 0 ? { auto_fixed: updateFixes } : {}),
        },
      };
    }
    case "element.delete": {
      const slideIdx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[slideIdx];
      const childIdx = findChildIndexInJson(slide, operation.element ?? operation.ref);
      const removed = childrenOf(slide).splice(childIdx, 1)[0];
      const removedQuestionIds = removeQuizQuestionsByIds(
        scene,
        collectQuizQuestionIdsFromElements([removed]),
      );
      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIdx,
          removed_index: childIdx,
          removed_element_id: removed.element_id,
          removed_question_ids: removedQuestionIds,
        },
      };
    }
    case "element.align": {
      const slide = slidesOf(scene)[findSlideIndexInJson(scene, operation.slide)];
      const ids = String(operation.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const mode = String(operation.mode ?? "center-x");
      const slideSize = slide.size as { width: number; height: number };
      const selected = ids.map((id) => childrenOf(slide)[findChildIndexInJson(slide, id)]);
      const bounds = selected.map((el) => ({ el, pos: el.position as Record<string, number>, size: el.size as Record<string, number> }));
      const target = mode.endsWith("-y")
        ? bounds.reduce((sum, b) => sum + b.pos.y + b.size.height / 2, 0) / Math.max(1, bounds.length)
        : bounds.reduce((sum, b) => sum + b.pos.x + b.size.width / 2, 0) / Math.max(1, bounds.length);
      for (const b of bounds) {
        if (mode === "slide-center-x") b.pos.x = (slideSize.width - b.size.width) / 2;
        else if (mode === "slide-center-y") b.pos.y = (slideSize.height - b.size.height) / 2;
        else if (mode === "left") b.pos.x = Math.min(...bounds.map((x) => x.pos.x));
        else if (mode === "right") b.pos.x = Math.max(...bounds.map((x) => x.pos.x + x.size.width)) - b.size.width;
        else if (mode === "top") b.pos.y = Math.min(...bounds.map((x) => x.pos.y));
        else if (mode === "bottom") b.pos.y = Math.max(...bounds.map((x) => x.pos.y + x.size.height)) - b.size.height;
        else if (mode.endsWith("-y")) b.pos.y = target - b.size.height / 2;
        else b.pos.x = target - b.size.width / 2;
      }
      return { op: opName, id: operation.id, data: { aligned: ids.length, mode } };
    }
    case "element.distribute": {
      const slide = slidesOf(scene)[findSlideIndexInJson(scene, operation.slide)];
      const ids = String(operation.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const axis = String(operation.axis ?? "x");
      const gap = asNumber(operation.gap, "element.distribute.gap", 24);
      const selected = ids.map((id) => childrenOf(slide)[findChildIndexInJson(slide, id)]);
      selected.sort((a, b) => Number((a.position as Record<string, number>)[axis]) - Number((b.position as Record<string, number>)[axis]));
      let cursor = Number((selected[0]?.position as Record<string, number> | undefined)?.[axis] ?? 0);
      for (const el of selected) {
        const pos = el.position as Record<string, number>;
        const size = el.size as Record<string, number>;
        pos[axis] = cursor;
        cursor += Number(size[axis === "x" ? "width" : "height"] ?? 0) + gap;
      }
      return { op: opName, id: operation.id, data: { distributed: ids.length, axis, gap } };
    }
    case "element.layer": {
      const { element } = getElement(scene, operation.slide, operation.element ?? operation.ref);
      const style = (element.style as Record<string, unknown> | undefined) ?? {};
      const children = childrenOf(slidesOf(scene)[findSlideIndexInJson(scene, operation.slide)]);
      const zValues = children.map((child) => Number((child.style as Record<string, unknown> | undefined)?.z_index ?? 0));
      const current = Number(style.z_index ?? 0);
      if (operation.front) style.z_index = Math.max(...zValues, current) + 1;
      else if (operation.back) style.z_index = Math.min(...zValues, current) - 1;
      else style.z_index = asNumber(operation.z ?? operation.z_index, "element.layer.z_index", current);
      element.style = style;
      return { op: opName, id: operation.id, data: { element_id: element.element_id, z_index: style.z_index } };
    }
    case "animation.preset": {
      const { slide, element } = getElement(scene, operation.slide, operation.element ?? operation.ref);
      const slideEnd = slideEndAtMs(slide);
      const from = asNumber(operation.from, "animation.preset.from", 0);
      let to = asNumber(operation.to, "animation.preset.to", from + 800);
      if (slideEnd !== null) to = Math.min(to, slideEnd);
      const kind = String(operation.kind ?? "fade-in");
      applyAnimationPresetToElement(element, kind, from, to);
      clampElementAnimationToSlide(element, slide);
      return { op: opName, id: operation.id, data: { element_id: element.element_id, kind, from, to } };
    }
    case "animation.stagger": {
      const slideIndex = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[slideIndex];
      const slideEnd = slideEndAtMs(slide);
      const ids = String(operation.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const from = asNumber(operation.from, "animation.stagger.from", 0);
      const duration = asNumber(operation.duration, "animation.stagger.duration", 800);
      const gap = asNumber(operation.gap, "animation.stagger.gap", 200);
      const kind = String(operation.kind ?? "fade-up");
      let animated = 0;
      let skipped = 0;
      ids.forEach((id) => {
        const { element } = getElement(scene, operation.slide, id);
        const elementType = String(element.element_type ?? "");
        if (ANIMATION_STAGGER_SKIP_ELEMENT_TYPES.has(elementType) || element.locked === true) {
          skipped += 1;
          return;
        }
        const start = from + animated * gap;
        let to = start + duration;
        if (slideEnd !== null) to = Math.min(to, slideEnd);
        applyAnimationPresetToElement(element, kind, start, to);
        clampElementAnimationToSlide(element, slide);
        animated += 1;
      });
      return { op: opName, id: operation.id, data: { animated, skipped, kind } };
    }
    case "animation.timeline": {
      const idx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[idx];
      const duration = asNumber(operation.duration ?? operation.duration_ms, "animation.timeline.duration");
      slide.timeline = { ...asObject(slide.timeline ?? {}, "slide.timeline"), end_at: duration };
      slide.flow_pause_points = remapSlideFlowPausePoints(
        slide.flow_pause_points as { pause_id: string; at_ms: number }[] | undefined,
        Math.max(1, duration - Number((slide.timeline as Record<string, unknown>).start_at ?? 0)),
      );
      if (operation.fit_elements) {
        for (const el of childrenOf(slide)) {
          const t = asObject(el.timeline ?? {}, "element.timeline");
          el.timeline = { ...t, end_at: Math.min(duration, Number(t.end_at ?? duration)) };
        }
      }
      return { op: opName, id: operation.id, data: { slide_index: idx, duration } };
    }
    case "highlight.add": {
      const { element } = getElement(scene, operation.slide, operation.element ?? operation.ref);
      const from = asNumber(operation.from, "highlight.add.from");
      const to = asNumber(operation.to, "highlight.add.to");
      const highlights = [...((element.highlight_segments as unknown[] | undefined) ?? [])];
      highlights.push({
        highlight_id: newElementId("highlight"),
        start_at: from,
        end_at: to,
        padding_px: asNumber(operation.padding, "highlight.add.padding", 12),
        border_radius_px: asNumber(operation.radius, "highlight.add.radius", 24),
        overlay_color: String(operation.color ?? "#000000"),
        overlay_opacity: asNumber(operation.opacity, "highlight.add.opacity", 0.62),
      });
      element.highlight_segments = highlights;
      return { op: opName, id: operation.id, data: { element_id: element.element_id, highlight_count: highlights.length } };
    }
    case "flow_pause.add": {
      const idx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[idx] as Record<string, unknown>;
      const timeline = asObject(slide.timeline ?? {}, "slide.timeline");
      const slideStartAt = Number(timeline.start_at ?? 0);
      const slideEndAt = Number(timeline.end_at ?? slideStartAt);
      const slideDur = Math.max(1, slideEndAt - slideStartAt);
      let atMs: number | null =
        operation.at !== undefined ? asNumber(operation.at, "flow_pause.add.at") : null;
      const elementRef = operation.element ?? operation.ref;
      if (elementRef !== undefined && String(elementRef).trim()) {
        const { element } = getElement(scene, operation.slide, String(elementRef));
        const elementType = String(element.element_type ?? "");
        if (FLOW_PAUSE_DISALLOWED_ELEMENT_TYPES.has(elementType)) {
          throw new AinobiCliError(
            "INVALID_INPUT",
            "flow_pause.add: do not attach flow pauses to quiz or quiz_score_summary elements — quizzes already pause during playback.",
          );
        }
        const when = String(operation.when ?? "end").toLowerCase() === "start" ? "start" : "end";
        atMs = resolveFlowPauseAtMsForElement(
          slide as unknown as SlideElement,
          element as unknown as Element,
          when,
          slideDur,
        );
      }
      if (atMs === null || !Number.isFinite(atMs)) {
        throw new AinobiCliError(
          "USAGE",
          "flow_pause.add: provide --at <ms> or --element <ref> [--when start|end].",
        );
      }
      const clampedAt = clampFlowPauseAtMs(atMs, slideDur);
      const pauseAbs = clampedAt + slideStartAt;
      for (const child of childrenOf(slide)) {
        if (String(child.element_type) !== "quiz") continue;
        const qTimeline = asObject(child.timeline ?? {}, "quiz.timeline");
        const qStart = Number(qTimeline.start_at ?? slideStartAt);
        const qEnd = Number(qTimeline.end_at ?? slideEndAt);
        if (pauseAbs + FLOW_PAUSE_TIME_EPSILON_MS >= qStart && pauseAbs <= qEnd + FLOW_PAUSE_TIME_EPSILON_MS) {
          throw new AinobiCliError(
            "INVALID_INPUT",
            "flow_pause.add: at_ms overlaps a quiz element timeline — quizzes already pause automatically; add flow_pause on rich/text/html content instead.",
          );
        }
      }
      const existing = normalizeSlideFlowPausePoints(
        slide.flow_pause_points as { pause_id: string; at_ms: number }[] | undefined,
        slideDur,
      );
      if (existing.some((p) => Math.abs(p.at_ms - clampedAt) < FLOW_PAUSE_TIME_EPSILON_MS)) {
        throw new AinobiCliError(
          "INVALID_INPUT",
          `flow_pause.add: a pause point already exists near ${clampedAt}ms on this slide.`,
        );
      }
      const pauseId = newPauseId();
      const nextPoints = [...existing, { pause_id: pauseId, at_ms: clampedAt }];
      slide.flow_pause_points = nextPoints;
      return {
        op: opName,
        id: operation.id,
        data: { slide_index: idx, pause_id: pauseId, at_ms: clampedAt, count: nextPoints.length },
      };
    }
    case "flow_pause.remove": {
      const idx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[idx] as Record<string, unknown>;
      const timeline = asObject(slide.timeline ?? {}, "slide.timeline");
      const slideDur = Math.max(
        1,
        Number(timeline.end_at ?? 0) - Number(timeline.start_at ?? 0),
      );
      const pauseId = String(operation.pause_id ?? operation.ref ?? "");
      if (!pauseId.trim()) {
        throw new AinobiCliError("USAGE", "flow_pause.remove: provide <pause_id>.");
      }
      const current = (slide.flow_pause_points as { pause_id: string; at_ms: number }[] | undefined) ?? [];
      const next = current.filter((p) => p.pause_id !== pauseId);
      if (next.length === current.length) {
        throw new AinobiCliError("NOT_FOUND", `flow_pause.remove: pause_id not found: ${pauseId}`);
      }
      slide.flow_pause_points = remapSlideFlowPausePoints(next, slideDur);
      return {
        op: opName,
        id: operation.id,
        data: { slide_index: idx, pause_id: pauseId, remaining: next.length },
      };
    }
    case "quiz.init": {
      const existing = scene.quiz as Record<string, unknown> | undefined;
      const quiz = existing
        ? { ...existing }
        : (createDefaultQuizConfig() as unknown as Record<string, unknown>);
      quiz.enabled = operation.enabled !== undefined ? !!operation.enabled : true;
      if (operation.total_score !== undefined) quiz.total_score = asNumber(operation.total_score, "quiz.init.total_score");
      if (operation.time_limit_minutes !== undefined || operation.time_limit_seconds !== undefined) {
        delete quiz.time_limit_seconds;
        delete quiz.time_limit;
        if (operation.time_limit_minutes !== undefined) {
          quiz.time_limit_minutes = operation.time_limit_minutes === null
            ? null
            : asNumber(operation.time_limit_minutes, "quiz.init.time_limit_minutes");
        } else if (operation.time_limit_seconds === null) {
          quiz.time_limit_minutes = null;
        } else {
          const seconds = asNumber(operation.time_limit_seconds, "quiz.init.time_limit_seconds");
          quiz.time_limit_minutes = seconds / 60;
        }
      }
      scene.quiz = quiz;
      return { op: opName, id: operation.id, data: { enabled: quiz.enabled, total_score: quiz.total_score } };
    }
    case "quiz.insert": {
      const slideIdx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[slideIdx];
      const type = asString(operation.type, "quiz.insert.type") as QuizQuestionType;
      const language = requireSceneLanguage(scene);
      const questionOverrides = asObject(operation.question ?? {}, "quiz.insert.question");
      const elementOverrides = asObject(operation.element ?? {}, "quiz.insert.element");
      const jsxSource = typeof operation.jsx === "string" ? operation.jsx : undefined;
      let reactLayoutFromJson = operation.react_layout;
      if (reactLayoutFromJson === undefined && questionOverrides.react_layout !== undefined) {
        reactLayoutFromJson = questionOverrides.react_layout;
        delete questionOverrides.react_layout;
      }
      const hasCustomLayout = jsxSource !== undefined || reactLayoutFromJson !== undefined;

      let draftQuestion = deepMerge(
        hasCustomLayout
          ? createDefaultQuestion(type, language, CLI_DEFAULT_QUESTION_OPTIONS)
          : createDefaultQuestionWithAst(type, language, CLI_DEFAULT_QUESTION_OPTIONS),
        questionOverrides,
      ) as unknown as QuizQuestion;
      // Given lists replace the defaults: merging by index would keep a default fourth option after three were given.
      if (Array.isArray(questionOverrides.options) && "options" in draftQuestion) {
        draftQuestion.options = questionOverrides.options as never;
      }
      if (Array.isArray(questionOverrides.blanks) && "blanks" in draftQuestion) {
        draftQuestion.blanks = questionOverrides.blanks as never;
      }
      if (draftQuestion.type === "single_choice" || draftQuestion.type === "multiple_choice") {
        draftQuestion.options = coerceQuizChoiceOptionsFromAgentPatch(
          draftQuestion.options as Parameters<typeof coerceQuizChoiceOptionsFromAgentPatch>[0],
        );
        if (draftQuestion.options.length < 2) {
          throw new AinobiCliError(
            "INVALID_INPUT",
            "quiz.insert: single_choice / multiple_choice need at least 2 options (use --set options[0]… options[1]… or --jsx). option_text is removed — use option labels in react_layout or --set options[i].value=<label> before save.",
          );
        }
      }
      if (draftQuestion.type === "fill_blank") {
        draftQuestion.blanks = coerceFillBlankBlanksFromAgentPatch(draftQuestion.blanks);
        draftQuestion = applyFillBlankTitleToQuestion(draftQuestion);
      }
      let layoutInterpFixes: string[] = [];
      let layoutAst: QuizAstNode;
      if (jsxSource !== undefined) {
        const parsed = parseQuizJsxOrThrow(jsxSource, "quiz.insert.jsx", language);
        layoutInterpFixes = parsed.layout_interp_fixes;
        layoutAst = parsed.ast;
      } else if (reactLayoutFromJson !== undefined) {
        const parsed = parseQuizAstFromJsonOrThrow(reactLayoutFromJson, "quiz.insert.react_layout", language);
        layoutInterpFixes = parsed.layout_interp_fixes;
        layoutAst = parsed.ast;
      } else {
        layoutAst = buildDefaultQuizAst(draftQuestion, language);
      }
      draftQuestion.react_layout = layoutAst;
      if (draftQuestion.type === "fill_blank") {
        draftQuestion = applyFillBlankTitleToQuestion(draftQuestion);
      }
      if (draftQuestion.type === "single_choice" || draftQuestion.type === "multiple_choice") {
        normalizeQuizChoiceOptionValues(draftQuestion.options);
      }
      const astIssues = validateQuizAst(draftQuestion.react_layout, draftQuestion);
      if (astIssues.length > 0) {
        throw new AinobiCliError(
          "INVALID_INPUT",
          `quiz.insert react_layout: ${astIssues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
        );
      }

      const quiz = ensureQuiz(scene);
      const questions = [...((quiz.questions as unknown[] | undefined) ?? [])];
      questions.push(draftQuestion as unknown as Record<string, unknown>);
      quiz.questions = questions;
      scene.quiz = maybeApplyEvenQuizScores(quiz as never) as never;

      const quizBox = defaultQuizElementLayoutForSlide(
        slide as { size?: { width?: number; height?: number } },
      );
      const element = buildElement(
        "quiz",
        deepMerge(
          {
            quiz_question_id: draftQuestion.question_id,
            position: quizBox.position,
            size: quizBox.size,
          },
          elementOverrides,
        ),
        slide as Pick<SlideElement, "children_elements">,
      );
      applyInsertTimelineDefaults(element, slide, elementOverrides);
      applyTimelineStartAt(element, Number((element.timeline as Record<string, unknown>).start_at));
      const children = childrenOf(slide);
      children.push(element);
      slide.children_elements = children;

      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIdx,
          quiz_element_id: element.element_id,
          question_id: draftQuestion.question_id,
          // Actual box after --position/--size overrides (was the default box, which
          // made agents think their size flags were ignored).
          quiz_element_size: element.size,
          quiz_element_position: element.position,
          layout_sizing_warnings: layoutSizingWarningsForQuestion(draftQuestion),
          layout_interp_fixes: layoutInterpFixes,
        },
      };
    }
    case "quiz.update": {
      const slideIdx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[slideIdx];
      const elementRef = operation.element ?? operation.ref;
      const childIdx = findChildIndexInJson(slide, elementRef);
      const element = childrenOf(slide)[childIdx];
      if (element.element_type !== "quiz") {
        throw new AinobiCliError(
          "INVALID_INPUT",
          `element at ${childIdx} is type "${element.element_type}", not "quiz"`,
        );
      }
      const quizQuestionId = String(element.quiz_question_id ?? "");
      if (!quizQuestionId) {
        throw new AinobiCliError(
          "INVALID_INPUT",
          `quiz element ${element.element_id} has no quiz_question_id binding`,
        );
      }
      const quiz = ensureQuiz(scene);
      const qIdx = questionIndex(quiz, quizQuestionId);
      const questions = quiz.questions as Record<string, unknown>[];
      const current = questions[qIdx] as unknown as QuizQuestion;

      const questionPatch = asObject(operation.question ?? {}, "quiz.update.question");
      const elementPatch = asObject(operation.element_patch ?? {}, "quiz.update.element_patch");
      rejectForbiddenPatchKeys(elementPatch, ELEMENT_PATCH_FORBIDDEN, "quiz.update.element_patch");
      const jsxSource = typeof operation.jsx === "string" ? operation.jsx : undefined;
      let reactLayoutFromJson = operation.react_layout;
      if (reactLayoutFromJson === undefined && questionPatch.react_layout !== undefined) {
        reactLayoutFromJson = questionPatch.react_layout;
        delete questionPatch.react_layout;
      }
      let layoutInterpFixes: string[] = [];

      let nextQuestion = deepMerge(current, questionPatch) as QuizQuestion;
      if (nextQuestion.type === "single_choice" || nextQuestion.type === "multiple_choice") {
        if (questionPatch.options !== undefined) {
          nextQuestion.options = coerceQuizChoiceOptionsFromAgentPatch(
            nextQuestion.options as Parameters<typeof coerceQuizChoiceOptionsFromAgentPatch>[0],
          );
        }
      }
      if (nextQuestion.type === "fill_blank" && questionPatch.blanks !== undefined) {
        nextQuestion.blanks = coerceFillBlankBlanksFromAgentPatch(nextQuestion.blanks);
      }
      // Only a custom layout bakes default copy (button labels), so plain title /
      // option patches on scenes without metadata.language keep working.
      if (jsxSource !== undefined) {
        const language = requireSceneLanguage(scene);
        const parsed = parseQuizJsxOrThrow(jsxSource, "quiz.update.jsx", language);
        nextQuestion.react_layout = parsed.ast;
        layoutInterpFixes = parsed.layout_interp_fixes;
      } else if (reactLayoutFromJson !== undefined) {
        const language = requireSceneLanguage(scene);
        const parsed = parseQuizAstFromJsonOrThrow(
          reactLayoutFromJson,
          "quiz.update.react_layout",
          language,
        );
        nextQuestion.react_layout = parsed.ast;
        layoutInterpFixes = parsed.layout_interp_fixes;
      }
      if (nextQuestion.type === "fill_blank") {
        nextQuestion = applyFillBlankTitleToQuestion(nextQuestion);
      }
      const astIssues = validateQuizAst(nextQuestion.react_layout, nextQuestion);
      if (astIssues.length > 0) {
        throw new AinobiCliError(
          "INVALID_INPUT",
          `quiz.update react_layout: ${astIssues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
        );
      }
      if (nextQuestion.type === "single_choice" || nextQuestion.type === "multiple_choice") {
        normalizeQuizChoiceOptionValues(nextQuestion.options);
      }
      questions[qIdx] = nextQuestion as unknown as Record<string, unknown>;
      scene.quiz = maybeApplyEvenQuizScores(quiz as never) as never;

      if (Object.keys(elementPatch).length > 0) {
        const preservedId = element.element_id;
        Object.assign(element, deepMerge(element, elementPatch));
        element.element_id = preservedId;
        element.element_type = "quiz";
      }

      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIdx,
          quiz_element_id: element.element_id,
          question_id: quizQuestionId,
          layout_sizing_warnings: layoutSizingWarningsForQuestion(nextQuestion),
          layout_interp_fixes: layoutInterpFixes,
        },
      };
    }
    case "quiz.score_summary.insert": {
      const slideIdx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[slideIdx];
      const jsxSource = typeof operation.jsx === "string" ? operation.jsx : undefined;
      const reactLayoutFromJson = operation.react_layout;
      const elementOverrides = asObject(operation.element ?? {}, "quiz.score_summary.insert.element");
      const quizBefore = ensureQuiz(scene);
      let layoutAst: QuizScoreSummaryAstNode;
      let layoutInterpFixes: string[] = [];
      if (jsxSource !== undefined || reactLayoutFromJson !== undefined) {
        const parsed = resolveScoreSummaryLayoutAst(
          jsxSource,
          reactLayoutFromJson,
          "quiz.score_summary.insert",
        );
        layoutAst = parsed.ast;
        layoutInterpFixes = parsed.layout_interp_fixes;
      } else {
        // The default card bakes learner-visible copy, so the scene language is required
        // here (a custom layout above carries its own wording).
        layoutAst = resolveQuizScoreSummaryConfigForCanvasAdd(
          quizBefore.score_summary as { react_layout: QuizScoreSummaryAstNode } | null | undefined,
          slidesOf(scene) as unknown as readonly SlideElement[],
          requireSceneLanguage(scene),
        ).react_layout;
      }
      assertValidScoreSummaryLayout(layoutAst, "quiz.score_summary.insert");

      const quiz = ensureQuiz(scene);
      quiz.score_summary = { react_layout: layoutAst };
      scene.quiz = quiz;

      const slideDuration = Number((slide.timeline as Record<string, unknown> | undefined)?.end_at ?? 5000);
      const summaryBox = defaultQuizScoreSummaryElementLayoutForSlide(
        slide as { size?: { width?: number; height?: number } },
      );
      const element = buildElement(
        "quiz_score_summary",
        deepMerge(
          {
            timeline: { start_at: 0, end_at: slideDuration },
            position: summaryBox.position,
            size: summaryBox.size,
          },
          elementOverrides,
        ),
        slide as Pick<SlideElement, "children_elements">,
      );
      applyTimelineStartAt(element, Number((element.timeline as Record<string, unknown>).start_at));
      const children = childrenOf(slide);
      children.push(element);
      slide.children_elements = children;

      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIdx,
          score_summary_element_id: element.element_id,
          ast_node_count: countScoreSummaryAstNodes(layoutAst),
          layout_interp_fixes: layoutInterpFixes,
        },
      };
    }
    case "quiz.score_summary.update": {
      const jsxSource = typeof operation.jsx === "string" ? operation.jsx : undefined;
      const reactLayoutFromJson = operation.react_layout;
      const elementPatch = asObject(operation.element_patch ?? {}, "quiz.score_summary.update.element_patch");
      rejectForbiddenPatchKeys(elementPatch, ELEMENT_PATCH_FORBIDDEN, "quiz.score_summary.update.element_patch");

      const quiz = ensureQuiz(scene);
      // No default card is built here: an element-only patch leaves quiz.score_summary as is.
      const currentLayout = (quiz.score_summary as { react_layout?: QuizScoreSummaryAstNode } | null | undefined)
        ?.react_layout;

      let layoutInterpFixes: string[] = [];
      let nextLayout: QuizScoreSummaryAstNode | undefined = currentLayout;
      if (jsxSource !== undefined || reactLayoutFromJson !== undefined) {
        const parsed = resolveScoreSummaryLayoutAst(
          jsxSource,
          reactLayoutFromJson,
          "quiz.score_summary.update",
        );
        nextLayout = parsed.ast;
        layoutInterpFixes = parsed.layout_interp_fixes;
        assertValidScoreSummaryLayout(nextLayout, "quiz.score_summary.update");
        quiz.score_summary = { react_layout: nextLayout };
        scene.quiz = quiz;
      }

      let updatedElementId: string | null = null;
      let slideIndex: number | null = null;
      if (operation.slide !== undefined && (operation.element ?? operation.ref) !== undefined) {
        const slideIdx = findSlideIndexInJson(scene, operation.slide);
        const slide = slidesOf(scene)[slideIdx];
        const elementRef = operation.element ?? operation.ref;
        const childIdx = findChildIndexInJson(slide, elementRef);
        const element = childrenOf(slide)[childIdx];
        if (element.element_type !== "quiz_score_summary") {
          throw new AinobiCliError(
            "INVALID_INPUT",
            `element at ${childIdx} is type "${element.element_type}", not "quiz_score_summary"`,
          );
        }
        if (Object.keys(elementPatch).length > 0) {
          deepMerge(element, elementPatch);
        }
        updatedElementId = String(element.element_id);
        slideIndex = slideIdx;
      } else if (Object.keys(elementPatch).length > 0) {
        throw new AinobiCliError(
          "USAGE",
          "quiz.score_summary.update: pass <slide> <element_ref> when using --position-x/y, --size-w/h, --start, or --duration.",
        );
      }

      if (
        jsxSource === undefined &&
        reactLayoutFromJson === undefined &&
        Object.keys(elementPatch).length === 0
      ) {
        throw new AinobiCliError(
          "USAGE",
          "quiz.score_summary.update: provide --jsx, --jsx-file, --react-layout-file, and/or element layout flags with slide + element ref.",
        );
      }

      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIndex,
          updated_element_id: updatedElementId,
          ast_node_count: nextLayout ? countScoreSummaryAstNodes(nextLayout) : 0,
          layout_interp_fixes: layoutInterpFixes,
        },
      };
    }
    case "quiz.delete": {
      const slideIdx = findSlideIndexInJson(scene, operation.slide);
      const slide = slidesOf(scene)[slideIdx];
      const elementRef = operation.element ?? operation.ref;
      const childIdx = findChildIndexInJson(slide, elementRef);
      const element = childrenOf(slide)[childIdx];
      if (element.element_type !== "quiz") {
        throw new AinobiCliError(
          "INVALID_INPUT",
          `element at ${childIdx} is type "${element.element_type}", not "quiz"`,
        );
      }
      const quizQuestionId = String(element.quiz_question_id ?? "");
      const removed = childrenOf(slide).splice(childIdx, 1)[0];
      const removedIds = removeQuizQuestionsByIds(scene, quizQuestionId ? [quizQuestionId] : []);
      return {
        op: opName,
        id: operation.id,
        data: {
          slide_index: slideIdx,
          removed_element_id: removed.element_id,
          removed_question_id: removedIds[0] ?? null,
        },
      };
    }
    case "quiz.prune_orphans": {
      const removedQuestionIds = pruneOrphanQuizQuestionsInScene(scene);
      return {
        op: opName,
        id: operation.id,
        data: {
          removed_count: removedQuestionIds.length,
          removed_question_ids: removedQuestionIds,
        },
      };
    }
    case "ppt.ranges": {
      const { element } = getElement(scene, operation.slide, operation.element ?? operation.ref);
      element.slide_ranges = parsePptSlideRanges(String(operation.ranges ?? ""));
      return { op: opName, id: operation.id, data: { element_id: element.element_id, slide_ranges: element.slide_ranges as unknown as Record<string, unknown> } };
    }
    default:
      throw new AinobiCliError("UNSUPPORTED", `Unsupported batch operation "${opName}".`, {
        hint: `Supported ops: ${SUPPORTED_BATCH_OPS.join(", ")}. Narration / TTS and asset upload are not batch ops (run them as commands). See references/batch-operations.md.`,
      });
  }
};

/** Keep in sync with the `switch (opName)` above (covered by operations tests). */
export const SUPPORTED_BATCH_OPS = [
  "scene.update",
  "slide.insert",
  "slide.template",
  "slide.update",
  "slide.delete",
  "slide.duplicate",
  "slide.move",
  "element.insert",
  "element.update",
  "element.delete",
  "element.align",
  "element.distribute",
  "element.layer",
  "animation.preset",
  "animation.stagger",
  "animation.timeline",
  "highlight.add",
  "flow_pause.add",
  "flow_pause.remove",
  "quiz.init",
  "quiz.insert",
  "quiz.update",
  "quiz.score_summary.insert",
  "quiz.score_summary.update",
  "quiz.delete",
  "quiz.prune_orphans",
  "ppt.ranges",
] as const;

export const applyOperations = (
  scene: Record<string, unknown>,
  operations: Operation[],
): OperationApplyResult[] => {
  const results: OperationApplyResult[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    try {
      results.push(applyOperation(scene, operations[index]));
    } catch (error) {
      if (error instanceof AinobiCliError) {
        throw new AinobiCliError(error.code, `Operation ${index} failed: ${error.message}`, {
          hint: error.hint,
          issues: [
            { path: `operations[${index}]`, message: error.message, value: operations[index] },
            ...error.issues,
          ],
        });
      }
      throw error;
    }
  }
  return results;
};
