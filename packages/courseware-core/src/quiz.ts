// SPDX-License-Identifier: AGPL-3.0-only
import * as yup from "yup";
import {
  defaultQuizValidationMessages,
  type QuizValidationMessages,
} from "./quiz-validation-messages.ts";
import type { QuizSlideElement, SlideElement } from "./elements.ts";
import { findSlideIndexForQuizQuestion } from "./slide-stack.ts";
import {
  cloneQuizAst,
  parseQuizAstFromJson,
  remapQuizAstBlankIds,
  remapQuizAstOptionValues,
  validateQuizAst,
  auditQuizLayoutSizing,
  type QuizAstNode,
} from "./quiz-ast.ts";
import { collectQuizSlideMediaPlacementWarnings } from "./quiz-slide-media-placement.ts";
import {
  applyFillBlankTitleToQuestion,
  getDefaultFillBlankAnswerLabel,
  getDefaultFillBlankQuestionTitle,
  syncFillBlankEntriesForTitle,
  validateFillBlankTitleModel,
} from "./quiz-fill-blank-title.ts";
import {
  validateQuizScoreSummaryConfig,
  type QuizScoreSummaryConfig,
} from "./quiz-score-summary.ts";
import type { QuizScoreSummaryAstNode } from "./quiz-score-summary-ast.ts";
import { stripUndefinedDeep } from "./strip-undefined.ts";
import type { ContentLanguage } from "./content-language.ts";

type TimeLimitInputShape = {
  time_limit_seconds?: unknown;
  time_limit_minutes?: unknown;
  time_limit?: unknown;
};

const asFiniteNonNegativeInteger = (value: unknown): number | null => {
  if (value == null || value === "") {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.floor(n);
};

const asFiniteNonNegativeNumber = (value: unknown): number | null => {
  if (value == null || value === "") {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
};

/**
 * Normalized to `time_limit_minutes` (fractions allowed, e.g. 0.5 = 30 seconds).
 * The canonical field wins; the historical `time_limit_seconds` / compound `time_limit` stay compatible.
 */
const deriveTimeLimitMinutes = (input: TimeLimitInputShape): number | null | undefined => {
  if ("time_limit_minutes" in input && input.time_limit_minutes !== undefined) {
    return asFiniteNonNegativeNumber(input.time_limit_minutes);
  }

  const composite = input.time_limit;
  if (composite && typeof composite === "object" && !Array.isArray(composite)) {
    const record = composite as Record<string, unknown>;
    const minutes = asFiniteNonNegativeInteger(record.minutes) ?? 0;
    const seconds = asFiniteNonNegativeInteger(record.seconds) ?? 0;
    if (record.minutes != null || record.seconds != null) {
      return minutes + seconds / 60;
    }
  }

  if ("time_limit_seconds" in input && input.time_limit_seconds !== undefined) {
    if (input.time_limit_seconds === null) {
      return null;
    }
    const fromSeconds = asFiniteNonNegativeNumber(input.time_limit_seconds);
    if (fromSeconds != null) {
      return fromSeconds / 60;
    }
  }

  return undefined;
};

const normalizeTimeLimitFields = <T>(input: T): T => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const record = input as Record<string, unknown>;
  const timeLimitMinutes = deriveTimeLimitMinutes(record);
  if (
    timeLimitMinutes === undefined &&
    record.time_limit_seconds === undefined &&
    record.time_limit_minutes === undefined &&
    record.time_limit === undefined
  ) {
    return input;
  }
  const normalized = { ...record };
  delete normalized.time_limit_seconds;
  delete normalized.time_limit;
  normalized.time_limit_minutes = timeLimitMinutes ?? null;
  return normalized as T;
};

export type { QuizScoreSummaryConfig } from "./quiz-score-summary.ts";

const randomId = (): string => {
  const nativeCrypto = globalThis.crypto;
  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return nativeCrypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

const stripCoursewareAssetSignatureFromUrl = (value: string): string => {
  const raw = value.trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    // oxlint-disable-next-line no-useless-spread -- copy the keys: deleting while iterating the live iterator skips entries
    for (const key of [...url.searchParams.keys()]) {
      if (/^(x-amz-|signature|expires|credential|policy|key-pair-id)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
};

const newQuestionId = (): string => `qz_q_${randomId().slice(0, 12)}`;
const newOptionId = (): string => `qz_op_${randomId().slice(0, 10)}`;
const newGradeLevelId = (): string => `qz_gl_${randomId().slice(0, 10)}`;
export const newBlankId = (): string => `qz_bl_${randomId().slice(0, 10)}`;

export type QuizQuestionType =
  | "single_choice"
  | "multiple_choice"
  | "fill_blank"
  | "essay"
  | "shadowing"
  | "speech";

export const QUIZ_QUESTION_TYPE_VALUES = [
  "single_choice",
  "multiple_choice",
  "fill_blank",
  "essay",
  "shadowing",
  "speech",
] as const satisfies readonly QuizQuestionType[];

/** Multiple-choice scoring. */
export type QuizMultipleChoiceGrading = "all_or_nothing" | "partial_credit";

export const QUIZ_MULTIPLE_CHOICE_GRADING_VALUES = [
  "all_or_nothing",
  "partial_credit",
] as const satisfies readonly QuizMultipleChoiceGrading[];

/** Fill-in-the-blank scoring. */
export type QuizFillBlankGrading = "exact_match" | "ai";

export const QUIZ_FILL_BLANK_GRADING_VALUES = [
  "exact_match",
  "ai",
] as const satisfies readonly QuizFillBlankGrading[];

/** Score distribution strategy. */
export type QuizScoreAllocation = "even_split" | "custom";

export const QUIZ_SCORE_ALLOCATION_VALUES = [
  "even_split",
  "custom",
] as const satisfies readonly QuizScoreAllocation[];

/**
 * Choice option. Display text is part of the `react_layout` AST
 * (`<QuizOption value="op_a">Apple</QuizOption>`); this entry only carries
 * scoring metadata and a stable answer code.
 */
export interface QuizChoiceOption {
  option_id: string;
  /** Stable answer payload code (defaults to `option_id`). */
  value: string;
  is_correct: boolean;
}

export interface QuizFillBlank {
  blank_id: string;
  answer: string;
  aliases: string[];
}

export interface QuizQuestionBase {
  question_id: string;
  type: QuizQuestionType;
  title: string;
  explanation: string;
  score: number;
  required: boolean;
  /** The question's score must reach this value to count; default = score. */
  pass_score: number;
  /** The question's pass threshold; below it, continuing is blocked. Default = score; 0 = never blocks. */
  advance_score: number;
  /** Whether re-answering is allowed after scoring. */
  allow_resubmit: boolean;
  /** Whether to show the score to the learner. */
  show_feedback_score: boolean;
  /** Per-question time limit (minutes, fractions allowed, e.g. 0.5 = 30 seconds); null means unlimited. */
  time_limit_minutes: number | null;
  /**
   * Question read-aloud narration (generated by concatenating TTS; different from `<QuizReferenceAudio>`). An empty string means not generated.
   */
  content_narration_audio_url: string;
  content_narration_duration_ms: number;
  /** id of the canvas VTuber element used to generate the read-aloud audio. */
  content_narration_vtuber_element_id: string;
  /**
   * Question UI structure (allowlisted AST, parsed+validated from JSX by the CLI on write).
   * The frontend renders the tree recursively; there is no runtime JSX parsing.
   */
  react_layout: QuizAstNode;
}

export interface QuizSingleChoiceQuestion extends QuizQuestionBase {
  type: "single_choice";
  options: QuizChoiceOption[];
}

export interface QuizMultipleChoiceQuestion extends QuizQuestionBase {
  type: "multiple_choice";
  options: QuizChoiceOption[];
  grading: QuizMultipleChoiceGrading;
}

export interface QuizFillBlankQuestion extends QuizQuestionBase {
  type: "fill_blank";
  blanks: QuizFillBlank[];
  case_sensitive: boolean;
  grading: QuizFillBlankGrading;
  /** AI fill-in scoring instructions (grading === "ai"). */
  grading_criteria: string;
}

export interface QuizEssayQuestion extends QuizQuestionBase {
  type: "essay";
  reference_answer: string;
  keywords: string[];
  grading_criteria: string;
}

export interface QuizShadowingQuestion extends QuizQuestionBase {
  type: "shadowing";
  /** Reference text for scoring (hidden from learners; empty means the backend uses the stem). */
  reference_text: string;
  /** Reference audio for scoring (hidden from learners; for AI pronunciation comparison). */
  reference_audio_url: string;
}

export interface QuizSpeechQuestion extends QuizQuestionBase {
  type: "speech";
  prompt: string;
  reference_text: string;
  /** Reference audio for scoring (hidden from learners; for AI pronunciation comparison; kept in sync with `<QuizReferenceAudio src>` in `react_layout`). */
  reference_audio_url: string;
  grading_criteria: string;
}

export type QuizQuestion =
  | QuizSingleChoiceQuestion
  | QuizMultipleChoiceQuestion
  | QuizFillBlankQuestion
  | QuizEssayQuestion
  | QuizShadowingQuestion
  | QuizSpeechQuestion;

/** Mirrors backend `uses_ai` in `courseware.py` quiz submit_answer. */
export const coursewareQuizUsesAiScoring = (
  question: Pick<QuizQuestion, "type"> & { grading?: QuizFillBlankGrading | string },
): boolean =>
  (question.type === "fill_blank" && question.grading === "ai") ||
  question.type === "essay" ||
  question.type === "shadowing" ||
  question.type === "speech";

export interface QuizGradeLevel {
  level_id: string;
  label: string;
  min_score: number;
  description: string;
}

export interface QuizConfig {
  enabled: boolean;
  total_score: number;
  score_allocation: QuizScoreAllocation;
  /** Whole-quiz time limit (minutes, fractions allowed); null means unlimited. */
  time_limit_minutes: number | null;
  questions: QuizQuestion[];
  grade_levels: QuizGradeLevel[];
  /**
   * JSX → AST layout of the whole-quiz score summary panel. The canvas `quiz_score_summary` element renders this tree.
   * `null` means not configured (the editor fills in the default layout when a summary element exists).
   */
  score_summary: QuizScoreSummaryConfig | null;
}

const choiceOptionSchema: yup.ObjectSchema<QuizChoiceOption> = yup
  .object({
    option_id: yup.string().required().default(newOptionId),
    value: yup.string().defined().default(""),
    is_correct: yup.boolean().required().default(false),
  })
  .required();

const fillBlankSchema: yup.ObjectSchema<QuizFillBlank> = yup
  .object({
    blank_id: yup.string().required().default(newBlankId),
    answer: yup.string().defined().default(""),
    aliases: yup.array(yup.string().defined()).required().default([]),
  })
  .required();

/** Yup-side `react_layout` is opaque to avoid duplicating QuizAstNode types; AST is parsed/validated post-yup. */
const reactLayoutSchema = yup
  .mixed<QuizAstNode>()
  .required()
  .test("react-layout-shape", "react_layout must be a QuizContainer AST node", (value) => {
    return Boolean(value) && typeof value === "object" && (value as QuizAstNode).kind === "element";
  });


const baseQuestionSchema = yup
  .object({
    question_id: yup.string().required().default(newQuestionId),
    type: yup
      .mixed<QuizQuestionType>()
      .oneOf(QUIZ_QUESTION_TYPE_VALUES)
      .required(),
    title: yup.string().defined().default(""),
    explanation: yup.string().defined().default(""),
    score: yup.number().required().min(0).default(0),
    required: yup.boolean().required().default(true),
    pass_score: yup.number().required().min(0).default(0),
    advance_score: yup.number().required().min(0).default(0),
    allow_resubmit: yup.boolean().required().default(false),
    show_feedback_score: yup.boolean().required().default(true),
    time_limit_minutes: yup.number().nullable().min(0).default(null),
    content_narration_audio_url: yup.string().defined().default(""),
    content_narration_duration_ms: yup.number().required().min(0).default(0),
    content_narration_vtuber_element_id: yup.string().defined().default(""),
    react_layout: reactLayoutSchema,
  })
  .required();

const singleChoiceSchema = baseQuestionSchema.shape({
  type: yup.mixed<"single_choice">().oneOf(["single_choice"]).required(),
  options: yup.array(choiceOptionSchema).required().default([]),
});

const multipleChoiceSchema = baseQuestionSchema.shape({
  type: yup.mixed<"multiple_choice">().oneOf(["multiple_choice"]).required(),
  options: yup.array(choiceOptionSchema).required().default([]),
  grading: yup
    .mixed<QuizMultipleChoiceGrading>()
    .oneOf(QUIZ_MULTIPLE_CHOICE_GRADING_VALUES)
    .required()
    .default("partial_credit"),
});

const fillBlankQuestionSchema = baseQuestionSchema.shape({
  type: yup.mixed<"fill_blank">().oneOf(["fill_blank"]).required(),
  blanks: yup.array(fillBlankSchema).required().default([]),
  case_sensitive: yup.boolean().required().default(false),
  grading: yup
    .mixed<QuizFillBlankGrading>()
    .oneOf(QUIZ_FILL_BLANK_GRADING_VALUES)
    .required()
    .default("exact_match"),
  grading_criteria: yup.string().defined().default(""),
});

const essayQuestionSchema = baseQuestionSchema.shape({
  type: yup.mixed<"essay">().oneOf(["essay"]).required(),
  reference_answer: yup.string().defined().default(""),
  keywords: yup.array(yup.string().defined()).required().default([]),
  grading_criteria: yup.string().defined().default(""),
});

const shadowingQuestionSchema = baseQuestionSchema.shape({
  type: yup.mixed<"shadowing">().oneOf(["shadowing"]).required(),
  reference_text: yup.string().defined().default(""),
  reference_audio_url: yup.string().defined().default(""),
});

const speechQuestionSchema = baseQuestionSchema.shape({
  type: yup.mixed<"speech">().oneOf(["speech"]).required(),
  prompt: yup.string().defined().default(""),
  reference_text: yup.string().defined().default(""),
  reference_audio_url: yup.string().defined().default(""),
  grading_criteria: yup.string().defined().default(""),
});

const questionSchemaByType = {
  single_choice: singleChoiceSchema,
  multiple_choice: multipleChoiceSchema,
  fill_blank: fillBlankQuestionSchema,
  essay: essayQuestionSchema,
  shadowing: shadowingQuestionSchema,
  speech: speechQuestionSchema,
} as const;

const collectAssetUrlsFromQuizAst = (node: QuizAstNode, urls: string[]): void => {
  if (node.kind === "text" || node.kind === "interp") return;
  if (node.kind === "stateBranch") {
    node.children.forEach((child) => collectAssetUrlsFromQuizAst(child, urls));
    return;
  }
  if (
    (node.tag === "QuizMedia" || node.tag === "QuizReferenceAudio" || node.tag === "img") &&
    typeof node.props.src === "string"
  ) {
    const src = node.props.src.trim();
    if (src) urls.push(src);
  }
  node.children.forEach((child) => collectAssetUrlsFromQuizAst(child, urls));
};

const mapQuizAstAssetUrl = (
  node: QuizAstNode,
  mapUrl: (url: string) => string,
): QuizAstNode => {
  if (node.kind === "text" || node.kind === "interp") return node;
  if (node.kind === "stateBranch") {
    return {
      ...node,
      children: node.children.map((child) => mapQuizAstAssetUrl(child, mapUrl)),
    };
  }
  const shouldMapSrcProp =
    node.tag === "QuizMedia" || node.tag === "QuizReferenceAudio" || node.tag === "img";
  const nextProps =
    shouldMapSrcProp && typeof node.props.src === "string"
      ? { ...node.props, src: mapUrl(node.props.src) }
      : node.props;
  return {
    ...node,
    props: nextProps,
    children: node.children.map((child) => mapQuizAstAssetUrl(child, mapUrl)),
  };
};

const applySignedUrlsToQuizQuestion = (
  q: QuizQuestion,
  signedByOriginal: Record<string, string>,
): QuizQuestion => {
  const r = (url: string): string => signedByOriginal[url] ?? url;
  const base = {
    content_narration_audio_url: r(q.content_narration_audio_url),
    react_layout: mapQuizAstAssetUrl(q.react_layout, r),
  };
  switch (q.type) {
    case "shadowing":
    case "speech":
      return { ...q, ...base, reference_audio_url: r(q.reference_audio_url) };
    case "single_choice":
    case "multiple_choice":
    case "fill_blank":
    case "essay":
      return { ...q, ...base };
    default:
      return q;
  }
};

export const collectQuizAssetUrlsForPresign = (
  quiz: QuizConfig | null | undefined,
): string[] => {
  if (!quiz) return [];
  const urls: string[] = [];
  for (const q of quiz.questions) {
    collectAssetUrlsFromQuizAst(q.react_layout, urls);
    if (q.content_narration_audio_url.trim()) {
      urls.push(q.content_narration_audio_url.trim());
    }
    if (
      (q.type === "shadowing" || q.type === "speech") &&
      q.reference_audio_url.trim()
    ) {
      urls.push(q.reference_audio_url.trim());
    }
  }
  return Array.from(new Set(urls));
};

export const applySignedUrlsToQuizConfig = (
  config: QuizConfig,
  signedByOriginal: Record<string, string>,
): QuizConfig => ({
  ...config,
  questions: config.questions.map((q) => applySignedUrlsToQuizQuestion(q, signedByOriginal)),
});

const stripSignaturesFromQuizQuestion = (q: QuizQuestion): QuizQuestion => {
  const s = stripCoursewareAssetSignatureFromUrl;
  const base = {
    content_narration_audio_url: s(q.content_narration_audio_url),
    react_layout: mapQuizAstAssetUrl(q.react_layout, s),
  };
  switch (q.type) {
    case "shadowing":
    case "speech":
      return { ...q, ...base, reference_audio_url: s(q.reference_audio_url) };
    case "single_choice":
    case "multiple_choice":
    case "fill_blank":
    case "essay":
      return { ...q, ...base };
    default:
      return q;
  }
};

export const stripSignaturesFromQuizConfig = (config: QuizConfig): QuizConfig => ({
  ...config,
  questions: config.questions.map(stripSignaturesFromQuizQuestion),
});

const gradeLevelSchema: yup.ObjectSchema<QuizGradeLevel> = yup
  .object({
    level_id: yup.string().required().default(newGradeLevelId),
    label: yup.string().defined().default(""),
    min_score: yup.number().required().min(0).default(0),
    description: yup.string().defined().default(""),
  })
  .required();

const validateSchema = <T>(schema: yup.Schema<T>, input: unknown): T =>
  schema.validateSync(input, { strict: true, abortEarly: false, stripUnknown: false });

const validateQuestion = (input: unknown, path: string): QuizQuestion => {
  if (typeof input !== "object" || input === null) {
    throw new Error(`${path}: question must be an object`);
  }
  const node = input as { type?: unknown; react_layout?: unknown };
  const type = typeof node.type === "string" ? node.type : undefined;
  if (!type || !(type in questionSchemaByType)) {
    throw new Error(
      `${path}: unsupported question type: ${typeof type === "string" ? type : "unknown"}`,
    );
  }
  // Parse the AST node first so yup gets a typed object.
  let astNode: QuizAstNode;
  try {
    astNode = parseQuizAstFromJson(node.react_layout, `${path}.react_layout`);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  const merged = normalizeTimeLimitFields({
    ...(input as Record<string, unknown>),
    react_layout: astNode,
  });
  const schema = questionSchemaByType[type as QuizQuestionType] as yup.Schema<QuizQuestion>;
  let validated: QuizQuestion;
  try {
    validated = validateSchema(schema, merged);
  } catch (error) {
    if (error instanceof yup.ValidationError) {
      const detail =
        error.inner.length > 0
          ? error.inner.map((item) => `${item.path ?? "(root)"}: ${item.message}`).join("; ")
          : error.message;
      throw new Error(`${path}: ${detail}`);
    }
    throw error;
  }
  validated = applyDefaultsToValidatedQuestion(validated);
  const astIssues = validateQuizAst(validated.react_layout, validated);
  if (astIssues.length > 0) {
    throw new Error(`${path}: ${astIssues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
  return validated;
};

/** Ensure each option entry's `value` defaults to its `option_id` so AST joins stay stable. */
const applyDefaultsToValidatedQuestion = (q: QuizQuestion): QuizQuestion => {
  if (q.type === "single_choice" || q.type === "multiple_choice") {
    const options = q.options.map((opt) =>
      (opt.value ?? "").trim().length === 0 ? { ...opt, value: opt.option_id } : opt,
    );
    return { ...q, options } as QuizQuestion;
  }
  if (q.type === "fill_blank") {
    return applyFillBlankTitleToQuestion(q);
  }
  return q;
};

/** Default stem for a new question, chosen by the courseware content language (`scene.metadata.language`). */
export const DEFAULT_QUIZ_QUESTION_TITLE_BY_LANGUAGE: Record<ContentLanguage, string> = {
  zh: "请在此输入题干",
  en: "Enter the question here",
  ja: "ここに設問を入力",
};

export const getDefaultQuizQuestionTitle = (language: ContentLanguage): string =>
  DEFAULT_QUIZ_QUESTION_TITLE_BY_LANGUAGE[language];

export const createDefaultQuizConfig = (): QuizConfig => ({
  enabled: true,
  total_score: 100,
  score_allocation: "even_split",
  time_limit_minutes: null,
  questions: [],
  grade_levels: [],
  score_summary: null,
});

export const computeEvenQuestionScores = (
  totalScore: number,
  questionCount: number,
): number[] => {
  if (questionCount <= 0 || totalScore < 0) return [];
  const base = Math.floor(totalScore / questionCount);
  const rem = totalScore % questionCount;
  return Array.from({ length: questionCount }, (_, i) => base + (i < rem ? 1 : 0));
};

/**
 * Allocate integer scores that sum exactly to `totalScore`, weighted by `weights`
 * (largest-remainder method). Non-positive / non-finite weights are treated as 0;
 * if every weight is 0, falls back to even split.
 */
export const computeProportionalQuestionScores = (
  totalScore: number,
  weights: number[],
): number[] => {
  const n = weights.length;
  if (n <= 0 || totalScore < 0) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = safe.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) return computeEvenQuestionScores(totalScore, n);

  const exact = safe.map((w) => (totalScore * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let rem = totalScore - floors.reduce((sum, x) => sum + x, 0);
  const byFrac = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const scores = [...floors];
  for (let k = 0; k < rem; k += 1) {
    const idx = byFrac[k]?.i;
    if (idx === undefined) break;
    scores[idx] = (scores[idx] ?? 0) + 1;
  }
  return scores;
};

const rescaleQuestionThresholds = (
  q: QuizQuestion,
  newScore: number,
): Pick<QuizQuestion, "score" | "pass_score" | "advance_score"> => {
  const oldScore = q.score;
  const treatPassAsFull = oldScore > 0 && q.pass_score >= oldScore;
  const treatAdvAsFull = oldScore > 0 && q.advance_score >= oldScore;
  const scaleThreshold = (value: number, treatAsFull: boolean): number => {
    if (treatAsFull) return newScore;
    if (oldScore > 0) {
      return Math.min(newScore, Math.round((value * newScore) / oldScore));
    }
    return Math.min(value, newScore);
  };
  return {
    score: newScore,
    pass_score: scaleThreshold(q.pass_score, treatPassAsFull),
    advance_score: scaleThreshold(q.advance_score, treatAdvAsFull),
  };
};

export const applyEvenSplitToQuizConfig = (config: QuizConfig): QuizConfig => {
  const n = config.questions.length;
  if (n === 0) return config;
  const scores = computeEvenQuestionScores(config.total_score, n);
  const questions = config.questions.map((q, i) => ({
    ...q,
    ...rescaleQuestionThresholds(q, scores[i] ?? 0),
  }));
  return { ...config, questions };
};

/** Keep `total_score`; rewrite each question.score by its current score weight. */
export const applyProportionalScoresToQuizConfig = (config: QuizConfig): QuizConfig => {
  const n = config.questions.length;
  if (n === 0) return config;
  const scores = computeProportionalQuestionScores(
    config.total_score,
    config.questions.map((q) => q.score),
  );
  const questions = config.questions.map((q, i) => ({
    ...q,
    ...rescaleQuestionThresholds(q, scores[i] ?? 0),
  }));
  return { ...config, questions };
};

export const maybeApplyEvenQuizScores = (quiz: QuizConfig | null): QuizConfig | null => {
  if (!quiz || quiz.score_allocation === "custom") return quiz;
  return applyEvenSplitToQuizConfig(quiz);
};

/**
 * Factory: minimal placeholder question. Caller is responsible for assigning
 * `react_layout` before persisting; `quiz-default-asts.ts` provides starter trees.
 */
/**
 * New-question defaults. Single choice starts with four options (the editor menu promises
 * "1 stem + 4 options"); the CLI keeps its historical two so agent-reused layouts still match.
 */
export type DefaultQuestionOptions = { singleChoiceOptionCount?: 2 | 4 };

export const createDefaultQuestion = (
  type: QuizQuestionType,
  language: ContentLanguage,
  options: DefaultQuestionOptions = {},
): QuizQuestion => {
  const base: Omit<QuizQuestionBase, "react_layout"> = {
    question_id: newQuestionId(),
    type,
    title: getDefaultQuizQuestionTitle(language),
    explanation: "",
    score: 0,
    required: true,
    pass_score: 0,
    advance_score: 0,
    allow_resubmit: false,
    show_feedback_score: true,
    time_limit_minutes: null,
    content_narration_audio_url: "",
    content_narration_duration_ms: 0,
    content_narration_vtuber_element_id: "",
  };
  // The AST is filled in by callers via `quiz-default-asts.ts` (createDefaultQuestionWithAst).
  // We use a single empty placeholder here so the type system stays sound.
  const placeholderAst: QuizAstNode = {
    kind: "element",
    tag: "QuizContainer",
    props: {},
    children: [],
  };
  switch (type) {
    case "single_choice": {
      // The menu text promises "1 stem + 4 mutually exclusive options" — so the default placeholder gives 4 options too
      // (it used to insert only A/B, contradicting the text: red team R8). The CLI passes 2 explicitly to keep the agent's existing behavior.
      const count = options.singleChoiceOptionCount ?? 4;
      const ids = Array.from({ length: count }, () => newOptionId());
      return {
        ...base,
        type: "single_choice",
        react_layout: placeholderAst,
        options: ids.map((id, i) => ({ option_id: id, value: id, is_correct: i === 0 })),
      };
    }
    case "multiple_choice": {
      const ids = [newOptionId(), newOptionId(), newOptionId(), newOptionId()];
      return {
        ...base,
        type: "multiple_choice",
        react_layout: placeholderAst,
        grading: "partial_credit",
        options: [
          { option_id: ids[0], value: ids[0], is_correct: true },
          { option_id: ids[1], value: ids[1], is_correct: true },
          { option_id: ids[2], value: ids[2], is_correct: false },
          { option_id: ids[3], value: ids[3], is_correct: false },
        ],
      };
    }
    case "fill_blank": {
      const title = getDefaultFillBlankQuestionTitle(language);
      return {
        ...base,
        type: "fill_blank",
        title,
        react_layout: placeholderAst,
        case_sensitive: false,
        grading: "exact_match",
        grading_criteria: "",
        blanks: syncFillBlankEntriesForTitle(title, [
          newQuizBlank({ answer: getDefaultFillBlankAnswerLabel(language), aliases: [] }),
        ]),
      };
    }
    case "essay":
      return {
        ...base,
        type: "essay",
        react_layout: placeholderAst,
        reference_answer: "",
        keywords: [],
        grading_criteria: "",
      };
    case "shadowing":
      return {
        ...base,
        type: "shadowing",
        react_layout: placeholderAst,
        reference_text: "",
        reference_audio_url: "",
      };
    case "speech":
      return {
        ...base,
        type: "speech",
        react_layout: placeholderAst,
        prompt: "",
        reference_text: base.title,
        reference_audio_url: "",
        grading_criteria: "",
      };
  }
};

export const newQuizChoiceOption = (
  overrides: Partial<QuizChoiceOption> = {},
): QuizChoiceOption => {
  const optionId = overrides.option_id ?? newOptionId();
  return {
    option_id: optionId,
    value: overrides.value ?? optionId,
    is_correct: overrides.is_correct ?? false,
  };
};

/**
 * `options[].value` must equal `option_id` (answer payload id). Display text lives in
 * `react_layout` only. Coerce any agent-supplied labels mistakenly written into `value`.
 */
export const normalizeQuizChoiceOptionValues = (options: QuizChoiceOption[]): void => {
  for (const opt of options) {
    opt.value = opt.option_id;
  }
};

type AgentPatchedChoiceOption = QuizChoiceOption & { option_text?: string };

/**
 * After `deepMerge`, `--set options[i].…` replaces the whole `options[]` array. Agents often
 * send removed fields (`option_text`) without `option_id` / `value`. Repair before building AST.
 */
type AgentPatchedFillBlank = Partial<QuizFillBlank> & {
  /** Legacy agent field — maps to `aliases`. */
  acceptable_answers?: string[] | Record<string, string>;
};

const normalizeAliasList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((s) => s.length > 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((v) => String(v).trim())
      .filter((s) => s.length > 0);
  }
  return [];
};

/** Repair agent patches: `acceptable_answers` → `aliases`, always array. */
export const coerceFillBlankBlanksFromAgentPatch = (
  blanks: AgentPatchedFillBlank[],
): QuizFillBlank[] =>
  (Array.isArray(blanks) ? blanks : []).map((blank) => {
    const blank_id =
      typeof blank.blank_id === "string" && blank.blank_id.trim()
        ? blank.blank_id.trim()
        : newBlankId();
    const fromAliases = normalizeAliasList(blank.aliases);
    const fromLegacy = normalizeAliasList(blank.acceptable_answers);
    const aliases = fromAliases.length > 0 ? fromAliases : fromLegacy;
    return {
      blank_id,
      answer: typeof blank.answer === "string" ? blank.answer : "",
      aliases,
    };
  });

export const coerceQuizChoiceOptionsFromAgentPatch = (
  options: AgentPatchedChoiceOption[],
): QuizChoiceOption[] =>
  options.map((opt) => {
    const optionId =
      typeof opt.option_id === "string" && opt.option_id.trim()
        ? opt.option_id.trim()
        : newOptionId();
    const legacyText =
      typeof opt.option_text === "string" ? opt.option_text.trim() : "";
    const rawValue = (opt.value ?? "").trim();
    const label = legacyText || (rawValue && rawValue !== optionId ? rawValue : "");
    return {
      option_id: optionId,
      value: label || optionId,
      is_correct: Boolean(opt.is_correct),
    };
  });

export const newQuizBlank = (overrides: Partial<QuizFillBlank> = {}): QuizFillBlank => ({
  blank_id: newBlankId(),
  answer: "",
  aliases: [],
  ...overrides,
});

export const newQuizGradeLevel = (overrides: Partial<QuizGradeLevel> = {}): QuizGradeLevel => ({
  level_id: newGradeLevelId(),
  label: "",
  min_score: 0,
  description: "",
  ...overrides,
});

/**
 * Clone a question with a fresh deep-copied AST so callers can mutate safely.
 */
export const cloneQuizQuestion = <Q extends QuizQuestion>(q: Q): Q => ({
  ...q,
  react_layout: cloneQuizAst(q.react_layout),
});

/**
 * Clone a quiz question with fresh `question_id` and regenerated option/blank ids.
 * Keeps `react_layout` in sync so serialize/validate does not fail after paste/duplicate.
 */
export const cloneQuizQuestionWithFreshIds = (q: QuizQuestion): QuizQuestion => {
  const question_id = newQuestionId();
  const react_layout = cloneQuizAst(q.react_layout);

  if (q.type === "single_choice" || q.type === "multiple_choice") {
    const optionIdMap = new Map<string, string>();
    const options = q.options.map((opt) => {
      const next = newQuizChoiceOption({ is_correct: opt.is_correct });
      optionIdMap.set(opt.option_id, next.option_id);
      return next;
    });
    normalizeQuizChoiceOptionValues(options);
    return {
      ...q,
      question_id,
      options,
      react_layout: remapQuizAstOptionValues(react_layout, optionIdMap),
    };
  }

  if (q.type === "fill_blank") {
    const blankIdMap = new Map<string, string>();
    const blanks = q.blanks.map((b) => {
      const next = newQuizBlank({ answer: b.answer, aliases: [...b.aliases] });
      blankIdMap.set(b.blank_id, next.blank_id);
      return next;
    });
    return applyFillBlankTitleToQuestion({
      ...q,
      question_id,
      blanks,
      react_layout: remapQuizAstBlankIds(react_layout, blankIdMap),
    });
  }

  return {
    ...q,
    question_id,
    react_layout,
  };
};

const scoreSummaryReactLayoutSchema = yup
  .mixed<QuizScoreSummaryAstNode>()
  .required()
  .test(
    "score-summary-react-layout-shape",
    "score_summary.react_layout must be a QuizScoreSummaryContainer AST node",
    (value) =>
      Boolean(value) &&
      typeof value === "object" &&
      (value as QuizScoreSummaryAstNode).kind === "element",
  );

/** Optional; old courseware JSON without this key should deserialize to `null`. */
const scoreSummarySchema: yup.ObjectSchema<QuizScoreSummaryConfig> = yup.object({
  react_layout: scoreSummaryReactLayoutSchema,
});

const quizConfigSchema = yup
  .object({
    enabled: yup.boolean().required().default(true),
    total_score: yup.number().required().min(0).default(100),
    score_allocation: yup
      .mixed<QuizScoreAllocation>()
      .oneOf(QUIZ_SCORE_ALLOCATION_VALUES)
      .required()
      .default("even_split"),
    time_limit_minutes: yup.number().nullable().min(0).default(null),
    questions: yup.array(yup.mixed().required()).required().default([]),
    grade_levels: yup.array(gradeLevelSchema).required().default([]),
    score_summary: scoreSummarySchema.nullable().notRequired().default(null),
  })
  .required()
  .unknown(false);

const issueDetail = (error: unknown): string => {
  if (error instanceof yup.ValidationError) {
    return error.inner.length > 0
      ? error.inner.map((item) => `${item.path ?? "(root)"}: ${item.message}`).join("; ")
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
};

export const deserializeQuizConfig = (input: unknown, path = "quiz"): QuizConfig => {
  let base: QuizConfig & { questions: unknown[] };
  try {
    base = quizConfigSchema.validateSync(
      normalizeTimeLimitFields(input),
      {
      strict: true,
      abortEarly: false,
      stripUnknown: false,
      },
    ) as QuizConfig & { questions: unknown[] };
  } catch (error) {
    throw new Error(`${path}: ${issueDetail(error)}`);
  }
  const questions: QuizQuestion[] = [];
  if (Array.isArray(base.questions)) {
    for (let index = 0; index < base.questions.length; index += 1) {
      questions.push(validateQuestion(base.questions[index], `${path}.questions[${index}]`));
    }
  }
  let score_summary: QuizScoreSummaryConfig | null = null;
  if (base.score_summary) {
    // scoreSummaryReactLayoutSchema already requires react_layout, so no default card
    // (which would need the scene language) is ever built here.
    score_summary = base.score_summary;
    const astIssues = validateQuizScoreSummaryConfig(score_summary);
    if (astIssues.length > 0) {
      throw new Error(
        `${path}.score_summary: ${astIssues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
      );
    }
  }

  return {
    enabled: base.enabled,
    total_score: base.total_score,
    score_allocation: base.score_allocation,
    time_limit_minutes: base.time_limit_minutes,
    questions,
    grade_levels: base.grade_levels,
    score_summary,
  };
};

export const serializeQuizConfig = (config: QuizConfig): unknown => {
  const normalized = deserializeQuizConfig(config, "quiz");
  const questions = normalized.questions.map((question) => {
    const record: Record<string, unknown> = { ...question };
    // Persist the canonical field; second-level limits use fractional minutes (e.g. 30 seconds → 0.5)
    delete record.time_limit_seconds;
    delete record.time_limit;
    return record;
  });
  const record: Record<string, unknown> = {
    ...normalized,
    questions,
  };
  delete record.time_limit_seconds;
  delete record.time_limit;
  if (record.score_summary === null) {
    delete record.score_summary;
  }
  return stripUndefinedDeep(record);
};

export interface QuizValidationIssue {
  path: string;
  message: string;
}

/**
 * Business-rule validation (publish gate):
 * - the sum of question scores must equal total_score
 * - option and correct answer counts of single/multiple choice questions
 * - fill-in blanks and reference answers
 * - Q&A/voice questions must state scoring requirements
 * - shadowing reference text is optional (only for scoring, never shown to learners; empty means the backend uses the stem)
 * - grade thresholds unique, with at least one tier at min_score=0
 * - `react_layout` must pass the AST structural validation
 *
 * `messages` formats the issue texts: hosts inject their own localization (the
 * editor UI); the default is the agent-facing English with CLI hints.
 */
export const validateQuizConfig = (
  config: QuizConfig,
  messages: QuizValidationMessages = defaultQuizValidationMessages,
): QuizValidationIssue[] => {
  const issues: QuizValidationIssue[] = [];
  const msg = messages;
  if (!config.enabled && config.questions.length > 0) {
    issues.push({
      path: "quiz.enabled",
      message: msg("notEnabled"),
    });
  }
  if (config.total_score <= 0) {
    issues.push({
      path: "quiz.total_score",
      message: msg("totalScoreInvalid"),
    });
  }
  if (config.questions.length === 0) {
    issues.push({
      path: "quiz.questions",
      message: msg("noQuestions"),
    });
  }
  let scoreSum = 0;
  for (let i = 0; i < config.questions.length; i += 1) {
    const q = config.questions[i];
    const path = `quiz.questions[${i}]`;
    const index = i + 1;
    scoreSum += q.score;
    if (q.score <= 0) {
      issues.push({
        path: `${path}.score`,
        message: msg("questionScoreInvalid", { index }),
      });
    }
    if (q.pass_score > q.score) {
      issues.push({
        path: `${path}.pass_score`,
        message: msg("passScoreExceedsScore", { index }),
      });
    }
    if (q.advance_score > q.score) {
      issues.push({
        path: `${path}.advance_score`,
        message: msg("advanceScoreExceedsScore", { index }),
      });
    }
    if (!q.title.trim()) {
      issues.push({
        path: `${path}.title`,
        message: msg("titleRequired", { index }),
      });
    }
    switch (q.type) {
      case "single_choice": {
        if (q.options.length < 2) {
          issues.push({
            path: `${path}.options`,
            message: msg("singleChoiceMinOptions", { index }),
          });
        }
        const correct = q.options.filter((opt) => opt.is_correct);
        if (correct.length !== 1) {
          issues.push({
            path: `${path}.options`,
            message: msg("singleChoiceOneCorrect", { index }),
          });
        }
        break;
      }
      case "multiple_choice": {
        if (q.options.length < 2) {
          issues.push({
            path: `${path}.options`,
            message: msg("multipleChoiceMinOptions", { index }),
          });
        }
        const correct = q.options.filter((opt) => opt.is_correct);
        if (correct.length < 2) {
          issues.push({
            path: `${path}.options`,
            message: msg("multipleChoiceMinCorrect", { index }),
          });
        }
        break;
      }
      case "fill_blank": {
        for (const message of validateFillBlankTitleModel(q, `${path}`)) {
          issues.push({ path: `${path}.title`, message });
        }
        if (q.blanks.length === 0) {
          issues.push({
            path: `${path}.blanks`,
            message: msg("fillBlankMinBlanks", { index }),
          });
        }
        for (let bi = 0; bi < q.blanks.length; bi += 1) {
          if (!q.blanks[bi].answer.trim()) {
            issues.push({
              path: `${path}.blanks[${bi}].answer`,
              message: msg("fillBlankAnswerRequired", {
                index,
                blank: bi + 1,
              }),
            });
          }
        }
        if (q.grading === "ai" && !q.grading_criteria.trim()) {
          issues.push({
            path: `${path}.grading_criteria`,
            message: msg("fillBlankAiCriteriaRequired", { index }),
          });
        }
        break;
      }
      case "shadowing":
        break;
      case "speech": {
        if (!q.grading_criteria.trim()) {
          issues.push({
            path: `${path}.grading_criteria`,
            message: msg("speechCriteriaRequired", { index }),
          });
        }
        break;
      }
      case "essay": {
        if (!q.grading_criteria.trim()) {
          issues.push({
            path: `${path}.grading_criteria`,
            message: msg("essayCriteriaRequired", { index }),
          });
        }
        break;
      }
      default:
        break;
    }

    const astIssues = validateQuizAst(q.react_layout, q);
    for (const issue of astIssues) {
      issues.push({ path: `${path}.${issue.path}`, message: issue.message });
    }
  }
  if (config.questions.length > 0 && scoreSum !== config.total_score) {
    issues.push({
      path: "quiz.questions",
      message: msg("scoreSumMismatch", {
        sum: scoreSum,
        total: config.total_score,
      }),
    });
  }
  if (config.grade_levels.length > 0) {
    const seen = new Set<number>();
    let hasZero = false;
    for (let li = 0; li < config.grade_levels.length; li += 1) {
      const lv = config.grade_levels[li];
      const index = li + 1;
      if (!lv.label.trim()) {
        issues.push({
          path: `quiz.grade_levels[${li}].label`,
          message: msg("gradeLevelLabelRequired", { index }),
        });
      }
      if (lv.min_score < 0 || lv.min_score > config.total_score) {
        issues.push({
          path: `quiz.grade_levels[${li}].min_score`,
          message: msg("gradeLevelThresholdOutOfRange", { index }),
        });
      }
      if (seen.has(lv.min_score)) {
        issues.push({
          path: `quiz.grade_levels[${li}].min_score`,
          message: msg("gradeLevelThresholdDuplicate", { index }),
        });
      }
      seen.add(lv.min_score);
      if (lv.min_score === 0) hasZero = true;
    }
    if (!hasZero) {
      issues.push({
        path: "quiz.grade_levels",
        message: msg("gradeLevelZeroRequired"),
      });
    }
  }
  if (config.score_summary) {
    issues.push(...validateQuizScoreSummaryConfig(config.score_summary));
  }
  return issues;
};

/**
 * Every `scene.quiz.questions[]` entry must have a matching
 * `element_type: "quiz"` element on some slide bound by `quiz_question_id`.
 */
export const validateQuizSlideBindings = (
  config: QuizConfig,
  slides: readonly SlideElement[],
  messages: QuizValidationMessages = defaultQuizValidationMessages,
): QuizValidationIssue[] => {
  const issues: QuizValidationIssue[] = [];
  for (let i = 0; i < config.questions.length; i += 1) {
    const q = config.questions[i];
    const path = `quiz.questions[${i}]`;
    const slideIdx = findSlideIndexForQuizQuestion(slides, q.question_id);
    if (slideIdx === null) {
      issues.push({
        path,
        message: messages("questionNotOnSlide", {
          index: i + 1,
          questionId: q.question_id,
          type: q.type,
        }),
      });
      continue;
    }
    const slide = slides[slideIdx];
    const wrapper = slide.children_elements.find(
      (el): el is QuizSlideElement =>
        el.element_type === "quiz" &&
        (el as QuizSlideElement).quiz_question_id === q.question_id,
    );
    if (!wrapper) {
      issues.push({
        path,
        message: messages("questionSlideBindingMissing", {
          index: i + 1,
          slideIndex: slideIdx,
        }),
      });
    }
  }
  return issues;
};

export const validateQuizForScene = (
  scene: {
    quiz: QuizConfig | null | undefined;
    slide_elements: readonly SlideElement[];
  },
  messages: QuizValidationMessages = defaultQuizValidationMessages,
): QuizValidationIssue[] => {
  if (!scene.quiz) {
    return [{ path: "quiz", message: "quiz is not configured" }];
  }
  return [
    ...validateQuizConfig(scene.quiz, messages),
    ...validateQuizSlideBindings(scene.quiz, scene.slide_elements, messages),
    ...collectQuizSlideMediaPlacementWarnings(scene.quiz, scene.slide_elements),
  ];
};

/** Default quiz element box on a slide: wide margins on standard 1920×1080, scales with slide size. */
export const defaultQuizElementLayoutForSlide = (slide: {
  size?: { width?: number; height?: number };
}): { position: { x: number; y: number }; size: { width: number; height: number } } => {
  const slideW = Number(slide.size?.width ?? 1920);
  const slideH = Number(slide.size?.height ?? 1080);
  const marginX = Math.max(40, Math.round((slideW * 80) / 1920));
  const marginY = Math.max(40, Math.round((slideH * 60) / 1080));
  return {
    position: { x: marginX, y: marginY },
    size: { width: slideW - marginX * 2, height: slideH - marginY * 2 },
  };
};

/** Non-blocking layout hints for agent-authored react_layout (fixed-width cards inside large quiz boxes). */
export const collectQuizLayoutSizingWarnings = (config: QuizConfig): QuizValidationIssue[] => {
  const warnings: QuizValidationIssue[] = [];
  config.questions.forEach((q, i) => {
    for (const message of auditQuizLayoutSizing(q.react_layout)) {
      warnings.push({ path: `quiz.questions[${i}].react_layout`, message });
    }
  });
  return warnings;
};

export const layoutSizingWarningsForQuestion = (question: QuizQuestion): QuizValidationIssue[] =>
  auditQuizLayoutSizing(question.react_layout).map((message) => ({
    path: "react_layout",
    message,
  }));
