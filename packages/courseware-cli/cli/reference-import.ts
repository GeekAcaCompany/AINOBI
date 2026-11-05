// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import {
  cloneSlideWithNewIds,
  remapQuizQuestionElementRefs,
  syncSceneTransitionsLength,
} from "./clone-slide.ts";
import {
  applyProportionalScoresToQuizConfig,
  cloneQuizQuestionWithFreshIds,
  createDefaultQuizConfig,
  type QuizConfig,
  type QuizQuestion,
} from "@ainobi/courseware-core";

export type ReferenceImportSlideResult = {
  source_index: number;
  source_element_id: string;
  source_name: string;
  inserted_at: number;
  element_id: string;
  imported_quiz_questions: number;
};

export type ReferenceImportResult = {
  source_path: string;
  imported_count: number;
  quiz_questions_imported: number;
  /** Target scene.quiz.total_score (unchanged); present when questions were imported. */
  quiz_total_score?: number;
  /** Per-question scores after proportional reallocation to `quiz_total_score`. */
  quiz_question_scores?: Array<{ question_id: string; score: number; score_before: number }>;
  inserted_at_start: number;
  slides: ReferenceImportSlideResult[];
};

const walkElements = (
  elements: Record<string, unknown>[],
  visit: (el: Record<string, unknown>) => void,
): void => {
  for (const element of elements) {
    visit(element);
    const children = element.children_elements;
    if (Array.isArray(children)) {
      walkElements(children as Record<string, unknown>[], visit);
    }
  }
};

const slidesOf = (scene: Record<string, unknown>): Record<string, unknown>[] =>
  (scene.slide_elements as Record<string, unknown>[] | undefined) ?? [];

const childrenOf = (slide: Record<string, unknown>): Record<string, unknown>[] =>
  (slide.children_elements as Record<string, unknown>[] | undefined) ?? [];

const collectQuizQuestionIdsFromSlide = (slide: Record<string, unknown>): string[] => {
  const ids: string[] = [];
  walkElements(childrenOf(slide), (el) => {
    if (el.element_type !== "quiz") return;
    const qid = String(el.quiz_question_id ?? "").trim();
    if (qid) ids.push(qid);
  });
  return ids;
};

/**
 * Parse `--slides` / positional selection.
 * Supports: `all` | `*` | `0` | `0,2,5` | `0-3` | `0,2-4,7` | slide element_id tokens (resolved later).
 */
export function parseReferenceSlideSelection(
  raw: string | undefined,
  slideCount: number,
  resolveElementId?: (ref: string) => number | null,
): number[] {
  const text = (raw ?? "all").trim();
  if (!text || text === "all" || text === "*") {
    if (slideCount <= 0) return [];
    return Array.from({ length: slideCount }, (_, i) => i);
  }

  const out: number[] = [];
  const seen = new Set<number>();
  const push = (idx: number): void => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= slideCount) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `Slide index ${idx} is out of range (0..${slideCount - 1}).`,
      );
    }
    if (seen.has(idx)) return;
    seen.add(idx);
    out.push(idx);
  };

  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(token);
    if (range) {
      let start = Number(range[1]);
      let end = Number(range[2]);
      if (start > end) [start, end] = [end, start];
      for (let i = start; i <= end; i += 1) push(i);
      continue;
    }
    if (/^-?\d+$/.test(token)) {
      push(Number(token));
      continue;
    }
    const resolved = resolveElementId?.(token) ?? null;
    if (resolved == null) {
      throw new AinobiCliError(
        "USAGE",
        `Invalid slide selection token "${token}".`,
        {
          hint: "Use `all`, indices (`0,2`), ranges (`0-3`), or slide element_id values.",
        },
      );
    }
    push(resolved);
  }

  out.sort((a, b) => a - b);
  return out;
}

function questionById(
  refScene: Record<string, unknown>,
  questionId: string,
): QuizQuestion | null {
  const quiz = refScene.quiz as { questions?: QuizQuestion[] } | null | undefined;
  const questions = quiz?.questions ?? [];
  return questions.find((q) => q.question_id === questionId) ?? null;
}

function ensureTargetQuiz(scene: Record<string, unknown>): Record<string, unknown> {
  if (!scene.quiz || typeof scene.quiz !== "object") {
    scene.quiz = createDefaultQuizConfig() as unknown as Record<string, unknown>;
  }
  const quiz = scene.quiz as Record<string, unknown>;
  if (!Array.isArray(quiz.questions)) quiz.questions = [];
  return quiz;
}

/**
 * Keep scene.quiz.total_score as authored on the target courseware. After merging
 * imported questions, reallocate every question.score by its prior score weight so
 * Σ scores == total_score (e.g. existing 100 + imported 100 → 50 + 50 on a 100-pt quiz).
 */
function reallocateQuizScoresAfterImport(scene: Record<string, unknown>): {
  total_score: number;
  question_scores: Array<{ question_id: string; score: number; score_before: number }>;
} | null {
  const quiz = scene.quiz as QuizConfig | null | undefined;
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) return null;

  const before = quiz.questions.map((q) => ({
    question_id: q.question_id,
    score_before: q.score,
  }));
  const next = applyProportionalScoresToQuizConfig(quiz);
  scene.quiz = next as unknown as Record<string, unknown>;

  return {
    total_score: next.total_score,
    question_scores: next.questions.map((q, i) => ({
      question_id: q.question_id,
      score: q.score,
      score_before: before[i]?.score_before ?? q.score,
    })),
  };
}

/**
 * Import selected slides from a reference scene JSON into the editing scene.
 * Regenerates element ids; clones bound quiz questions with fresh question_ids.
 * When quiz questions are imported, keeps the target `quiz.total_score` and
 * reallocates all question scores by their prior score weights (no wipe of transitions).
 */
export function importReferenceSlidesIntoScene(params: {
  targetScene: Record<string, unknown>;
  referenceScene: Record<string, unknown>;
  sourcePath: string;
  slideIndices: number[];
  /** Insert position in target `slide_elements` (default: append). */
  at?: number;
}): ReferenceImportResult {
  const refSlides = slidesOf(params.referenceScene);
  const targetSlides = slidesOf(params.targetScene);
  if (params.slideIndices.length === 0) {
    throw new AinobiCliError("USAGE", "No slides selected to import.");
  }

  let insertAt =
    params.at === undefined
      ? targetSlides.length
      : Math.max(0, Math.min(Math.floor(params.at), targetSlides.length));

  const insertedAtStart = insertAt;
  const results: ReferenceImportSlideResult[] = [];
  let quizImported = 0;
  /** source question_id → fresh question_id (shared across imported slides) */
  const questionIdMap = new Map<string, string>();

  for (const sourceIndex of params.slideIndices) {
    const source = refSlides[sourceIndex];
    if (!source) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `Reference slide index ${sourceIndex} is out of range (0..${refSlides.length - 1}).`,
      );
    }
    const { slide: clone, idMap } = cloneSlideWithNewIds(source);
    const sourceQids = collectQuizQuestionIdsFromSlide(source);
    for (const oldQid of sourceQids) {
      if (questionIdMap.has(oldQid)) continue;
      const sourceQuestion = questionById(params.referenceScene, oldQid);
      if (!sourceQuestion) {
        throw new AinobiCliError(
          "NOT_FOUND",
          `Reference quiz question "${oldQid}" (slide ${sourceIndex}) was not found in the reference scene quiz config.`,
        );
      }
      const fresh = cloneQuizQuestionWithFreshIds(sourceQuestion);
      remapQuizQuestionElementRefs(fresh as unknown as Record<string, unknown>, idMap);
      const quiz = ensureTargetQuiz(params.targetScene);
      (quiz.questions as QuizQuestion[]).push(fresh);
      questionIdMap.set(oldQid, fresh.question_id);
      quizImported += 1;
    }

    walkElements([clone], (element) => {
      if (element.element_type !== "quiz") return;
      const oldQid = String(element.quiz_question_id ?? "").trim();
      if (!oldQid) return;
      const next = questionIdMap.get(oldQid);
      if (next) element.quiz_question_id = next;
    });

    targetSlides.splice(insertAt, 0, clone);
    results.push({
      source_index: sourceIndex,
      source_element_id: String(source.element_id ?? ""),
      source_name: String(source.name ?? `slide ${sourceIndex}`),
      inserted_at: insertAt,
      element_id: String(clone.element_id ?? ""),
      imported_quiz_questions: sourceQids.length,
    });
    insertAt += 1;
  }

  params.targetScene.slide_elements = targetSlides;
  const quizScoreSync =
    quizImported > 0 ? reallocateQuizScoresAfterImport(params.targetScene) : null;
  syncSceneTransitionsLength(params.targetScene);

  return {
    source_path: params.sourcePath,
    imported_count: results.length,
    quiz_questions_imported: quizImported,
    ...(quizScoreSync
      ? {
          quiz_total_score: quizScoreSync.total_score,
          quiz_question_scores: quizScoreSync.question_scores,
        }
      : {}),
    inserted_at_start: insertedAtStart,
    slides: results,
  };
}

// Re-export for tests that previously imported clone from this module.
export { cloneSlideWithNewIds } from "./clone-slide.ts";
