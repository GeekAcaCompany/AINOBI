// SPDX-License-Identifier: AGPL-3.0-only
import { translate, type SupportedLanguage } from "../i18n/index.ts";
import {
  deserializeScene,
  type Scene,
} from "@ainobi/courseware-core/scene.ts";
import type { ParseIssue } from "@ainobi/courseware-core/elements.ts";

/** An issue entry collected while loading/repairing courseware JSON. */
export type CoursewareLoadIssue = {
  path: string;
  message: string;
  /** renamed / converted / stripped / dropped / skipped */
  action?: string;
};

const QUIZ_CONFIG_KNOWN_KEYS = new Set([
  "enabled",
  "total_score",
  "score_allocation",
  "time_limit_minutes",
  "questions",
  "grade_levels",
  "score_summary",
]);

const cloneJson = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The historical field `time_limit_seconds` → the canonical field `time_limit_minutes` (seconds stored as 0.x minutes).
 * When minutes already exist (including an explicit null) seconds are dropped; otherwise converted as seconds/60.
 */
const repairTimeLimitSecondsField = (
  node: Record<string, unknown>,
  path: string,
  issues: CoursewareLoadIssue[],
  language: SupportedLanguage,
): void => {
  if (!("time_limit_seconds" in node)) return;
  const rawSeconds = node.time_limit_seconds;
  delete node.time_limit_seconds;

  const hasMinutesKey =
    "time_limit_minutes" in node && node.time_limit_minutes !== undefined;

  if (hasMinutesKey) {
    issues.push({
      path: `${path}.time_limit_seconds`,
      message: translate(language, "coursewareEditor.loadIssues.msg.strippedKeptMinutes"),
      action: "stripped",
    });
    return;
  }

  if (typeof rawSeconds === "number" && Number.isFinite(rawSeconds) && rawSeconds >= 0) {
    const minutes = rawSeconds / 60;
    node.time_limit_minutes = minutes;
    issues.push({
      path: `${path}.time_limit_seconds`,
      message: translate(language, "coursewareEditor.loadIssues.msg.convertedSeconds", {
        seconds: rawSeconds,
        minutes,
      }),
      action: "converted",
    });
    return;
  }

  if (rawSeconds === null) {
    node.time_limit_minutes = null;
    issues.push({
      path: `${path}.time_limit_seconds`,
      message: translate(language, "coursewareEditor.loadIssues.msg.mappedNullSeconds"),
      action: "renamed",
    });
    return;
  }

  issues.push({
    path: `${path}.time_limit_seconds`,
    message: translate(language, "coursewareEditor.loadIssues.msg.strippedUnconvertibleSeconds", {
      value: String(rawSeconds),
    }),
    action: "stripped",
  });
};

const stripUnknownKeys = (
  node: Record<string, unknown>,
  knownKeys: Set<string>,
  path: string,
  issues: CoursewareLoadIssue[],
  language: SupportedLanguage,
): void => {
  for (const key of Object.keys(node)) {
    if (knownKeys.has(key)) continue;
    delete node[key];
    issues.push({
      path: `${path}.${key}`,
      message: translate(language, "coursewareEditor.loadIssues.msg.strippedUnknownKey", { key }),
      action: "stripped",
    });
  }
};

/** Repair historical wrong fields in quiz nodes and strip unknown keys from the quiz config. */
export const repairQuizJsonNode = (
  quiz: unknown,
  path = "root.quiz",
  language: SupportedLanguage = "zh",
): { value: unknown; issues: CoursewareLoadIssue[] } => {
  const issues: CoursewareLoadIssue[] = [];
  if (quiz === null || quiz === undefined) {
    return { value: quiz, issues };
  }
  if (!isPlainObject(quiz)) {
    issues.push({
      path,
      message: translate(language, "coursewareEditor.loadIssues.msg.quizNotObject"),
      action: "skipped",
    });
    return { value: quiz, issues };
  }

  const next = cloneJson(quiz);
  repairTimeLimitSecondsField(next, path, issues, language);

  if (Array.isArray(next.questions)) {
    next.questions = next.questions.map((question, index) => {
      if (!isPlainObject(question)) return question;
      const q = cloneJson(question);
      repairTimeLimitSecondsField(q, `${path}.questions[${index}]`, issues, language);
      return q;
    });
  }

  stripUnknownKeys(next, QUIZ_CONFIG_KNOWN_KEYS, path, issues, language);
  return { value: next, issues };
};

/**
 * Repair known historical dirty data (such as time_limit_seconds) before strict deserialization.
 * It doesn't guarantee the schema passes afterwards; callers should still go through tolerant deserialize.
 */
export const repairSceneJsonInput = (
  input: unknown,
  language: SupportedLanguage = "zh",
): { value: unknown; issues: CoursewareLoadIssue[] } => {
  const issues: CoursewareLoadIssue[] = [];
  if (!isPlainObject(input)) {
    return { value: input, issues };
  }
  const next = cloneJson(input);
  if ("quiz" in next && next.quiz !== undefined) {
    const repairedQuiz = repairQuizJsonNode(next.quiz, "root.quiz", language);
    next.quiz = repairedQuiz.value;
    issues.push(...repairedQuiz.issues);
  }
  return { value: next, issues };
};

const toLoadIssue = (issue: ParseIssue): CoursewareLoadIssue => ({
  path: issue.path,
  message: issue.message,
  action: "skipped",
});

export type TolerantSceneLoadResult = {
  scene: Scene;
  /** Issues produced by the repair steps */
  repairIssues: CoursewareLoadIssue[];
  /** Issues produced by parse stages such as skipInvalidNodes */
  parseIssues: CoursewareLoadIssue[];
  /** Whether the input had fields repaired */
  didRepair: boolean;
  /** Whether lenient parsing with invalid node skipping was used */
  usedLenientParse: boolean;
};

/**
 * For courseware editor loading: repair known dirty fields first, then deserialize strictly;
 * if it still fails, skipInvalidNodes, trying not to block opening the editor.
 */
export const loadSceneTolerantly = (
  input: unknown,
  language: SupportedLanguage = "zh",
): TolerantSceneLoadResult => {
  const repaired = repairSceneJsonInput(input, language);
  const didRepair = repaired.issues.length > 0;

  try {
    const scene = deserializeScene(repaired.value, { skipInvalidNodes: false });
    return {
      scene,
      repairIssues: repaired.issues,
      parseIssues: [],
      didRepair,
      usedLenientParse: false,
    };
  } catch (strictError) {
    const parseIssues: CoursewareLoadIssue[] = [
      {
        path: "root",
        message: translate(language, "coursewareEditor.loadIssues.msg.strictParseFailed", {
          error: strictError instanceof Error ? strictError.message : String(strictError),
        }),
        action: "skipped",
      },
    ];
    const lenientIssues: ParseIssue[] = [];
    const scene = deserializeScene(repaired.value, {
      skipInvalidNodes: true,
      onIssue: (issue) => {
        lenientIssues.push(issue);
      },
    });
    parseIssues.push(...lenientIssues.map(toLoadIssue));
    return {
      scene,
      repairIssues: repaired.issues,
      parseIssues,
      didRepair,
      usedLenientParse: true,
    };
  }
};

export const collectCoursewareLoadIssues = (
  result: TolerantSceneLoadResult,
): CoursewareLoadIssue[] => [...result.repairIssues, ...result.parseIssues];

/**
 * Lenient parsing returns an empty scene sentinel (invalid-scene-fallback) when scene-level fields are invalid.
 * That output must not be treated as valid courseware content (it could clear the local draft and overwrite the server through autosave).
 */
export const isInvalidSceneFallback = (result: TolerantSceneLoadResult): boolean =>
  result.usedLenientParse &&
  result.scene.name === "invalid-scene-fallback" &&
  result.scene.slide_elements.length === 0;
