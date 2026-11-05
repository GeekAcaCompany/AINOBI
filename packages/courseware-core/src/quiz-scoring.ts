// SPDX-License-Identifier: AGPL-3.0-only
import type { QuizQuestion } from "./quiz.ts";

export type CoursewareQuizAnswerContent = {
  /** Optional-question skip: no scoring/recording; records a zero-score pass-through attempt. */
  skipped?: boolean;
  selected_option_ids?: string[];
  selected_option_indices?: number[];
  values?: string[];
  value_by_member_id?: Record<string, string>;
  recording_member_id?: string | null;
  recording_id?: string | null;
  recording_file_path?: string | null;
  recording_file_url?: string | null;
  recording_duration_sec?: number | null;
};

export type CoursewareQuizFeedbackDetail = Record<string, unknown> | null;

export type CoursewareQuizRawScoreResult = {
  rawScore: number;
  feedbackOverride?: string | null;
  feedbackDetail?: CoursewareQuizFeedbackDetail;
};

export type CoursewareQuizScoreResult = {
  score: number;
  maxScore: number;
  rawScore: number;
  passed: boolean;
  canAdvance: boolean;
  feedback: string;
  feedbackDetail: CoursewareQuizFeedbackDetail;
};

export type CoursewareQuizAiScoringInput = {
  question: QuizQuestion;
  answer: CoursewareQuizAnswerContent;
};

export type CoursewareQuizAiScorer = (
  input: CoursewareQuizAiScoringInput,
) => Promise<CoursewareQuizRawScoreResult>;

const normalizeText = (value: string, caseSensitive = false): string => {
  const normalized = value.trim();
  return caseSensitive ? normalized : normalized.toLowerCase();
};

const finiteNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatScore = (value: number): string => Number(value.toFixed(6)).toString();

export function coursewareQuizQuestionUsesAiScoring(question: QuizQuestion): boolean {
  return (
    (question.type === "fill_blank" && question.grading === "ai") ||
    question.type === "essay" ||
    question.type === "shadowing" ||
    question.type === "speech"
  );
}

function selectedOptionIndexes(
  question: Extract<QuizQuestion, { type: "single_choice" | "multiple_choice" }>,
  answer: CoursewareQuizAnswerContent,
): number[] {
  const byIndex = (answer.selected_option_indices ?? []).filter(
    (index) => Number.isInteger(index) && index >= 0 && index < question.options.length,
  );
  if (byIndex.length > 0) {
    return [...new Set(byIndex)];
  }

  const selectedIds = new Set((answer.selected_option_ids ?? []).filter((id) => typeof id === "string"));
  if (selectedIds.size === 0) {
    return [];
  }
  return question.options
    .map((option, index) =>
      selectedIds.has(option.option_id) || selectedIds.has(option.value) ? index : -1,
    )
    .filter((index) => index >= 0);
}

export function scoreChoiceQuestion(
  question: Extract<QuizQuestion, { type: "single_choice" | "multiple_choice" }>,
  answer: CoursewareQuizAnswerContent,
): number {
  const correct = new Set(
    question.options
      .map((option, index) => (option.is_correct ? index : -1))
      .filter((index) => index >= 0),
  );
  const selected = new Set(selectedOptionIndexes(question, answer));
  const maxScore = Math.max(0, finiteNumber(question.score));

  if (question.type === "multiple_choice") {
    if (question.grading === "all_or_nothing") {
      return selected.size === correct.size && [...selected].every((index) => correct.has(index))
        ? maxScore
        : 0;
    }
    if (correct.size === 0) {
      return 0;
    }
    const unit = maxScore / correct.size;
    const raw = ([...selected].filter((index) => correct.has(index)).length -
      [...selected].filter((index) => !correct.has(index)).length) *
      unit;
    return Math.max(0, Math.min(maxScore, raw));
  }

  return selected.size === 1 && selected.size === correct.size && [...selected].every((index) => correct.has(index))
    ? maxScore
    : 0;
}

function orderedAnswerValues(question: QuizQuestion, answer: CoursewareQuizAnswerContent): string[] {
  if (answer.values && answer.values.length > 0) {
    return answer.values;
  }
  const keyed = answer.value_by_member_id ?? {};
  if (question.type === "fill_blank") {
    return question.blanks.map((blank) => keyed[blank.blank_id] ?? "");
  }
  return Object.values(keyed);
}

export function scoreExactFillBlankQuestion(
  question: Extract<QuizQuestion, { type: "fill_blank" }>,
  answer: CoursewareQuizAnswerContent,
): number {
  if (question.blanks.length === 0) {
    return 0;
  }
  const values = orderedAnswerValues(question, answer);
  let correctCount = 0;
  for (const [index, blank] of question.blanks.entries()) {
    const expected = new Set(
      [blank.answer, ...blank.aliases]
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => normalizeText(value, question.case_sensitive)),
    );
    const actual = normalizeText(values[index] ?? "", question.case_sensitive);
    if (actual && expected.has(actual)) {
      correctCount += 1;
    }
  }
  return Math.max(0, finiteNumber(question.score)) * correctCount / question.blanks.length;
}

export function scoreCoursewareQuizDeterministic(
  question: QuizQuestion,
  answer: CoursewareQuizAnswerContent,
): CoursewareQuizRawScoreResult {
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    return { rawScore: scoreChoiceQuestion(question, answer) };
  }
  if (question.type === "fill_blank" && question.grading !== "ai") {
    return { rawScore: scoreExactFillBlankQuestion(question, answer) };
  }
  return { rawScore: 0 };
}

// Fixed feedback text is chosen by the resolved language; unknown languages fall back to English (release-wide policy).
const QUIZ_FEEDBACK_TEXTS = {
  zh: {
    scoreLabel: (score: string, max: string) => `得分 ${score}/${max}`,
    failHint: "题目分数未达标要求再次答题",
    joiner: "；",
  },
  ja: {
    scoreLabel: (score: string, max: string) => `得点 ${score}/${max}`,
    failHint: "スコアが基準に達していません。もう一度回答してください。",
    joiner: "；",
  },
  en: {
    scoreLabel: (score: string, max: string) => `Score ${score}/${max}`,
    failHint: "Score below the required threshold — please try again.",
    joiner: "; ",
  },
} as const;

function quizFeedbackTexts(language?: string | null) {
  return language === "zh" || language === "ja"
    ? QUIZ_FEEDBACK_TEXTS[language]
    : QUIZ_FEEDBACK_TEXTS.en;
}

export function finalizeCoursewareQuizScore(
  question: QuizQuestion,
  raw: CoursewareQuizRawScoreResult,
  language?: string | null,
): CoursewareQuizScoreResult {
  const maxScore = Math.max(0, finiteNumber(question.score));
  let score = Math.max(0, Math.min(maxScore, finiteNumber(raw.rawScore)));
  const passScore = Math.max(0, finiteNumber(question.pass_score));
  const advanceScore = Math.max(0, finiteNumber(question.advance_score));

  const passed = passScore > 0 ? score >= passScore : score > 0;
  let canAdvance = advanceScore > 0 ? score >= advanceScore : true;
  if (passScore > 0 && !passed) {
    score = 0;
    if (advanceScore > 0) {
      canAdvance = false;
    }
  }

  const texts = quizFeedbackTexts(language);
  let feedback: string;
  if (canAdvance) {
    feedback =
      raw.feedbackOverride?.trim() || texts.scoreLabel(formatScore(score), formatScore(maxScore));
  } else if (raw.feedbackOverride?.trim()) {
    feedback = `${raw.feedbackOverride.trim()}${texts.joiner}${texts.failHint}`;
  } else {
    feedback = texts.failHint;
  }

  return {
    score,
    maxScore,
    rawScore: finiteNumber(raw.rawScore),
    passed,
    canAdvance,
    feedback,
    feedbackDetail: raw.feedbackDetail ?? null,
  };
}

export async function evaluateCoursewareQuizAnswer(
  question: QuizQuestion,
  answer: CoursewareQuizAnswerContent,
  aiScorer?: CoursewareQuizAiScorer,
  language?: string | null,
): Promise<CoursewareQuizScoreResult> {
  if (answer.skipped === true) {
    return scoreSkippedOptionalQuestion(question);
  }
  const raw = coursewareQuizQuestionUsesAiScoring(question)
    ? await (aiScorer ?? (async () => ({ rawScore: 0 })))({ question, answer })
    : scoreCoursewareQuizDeterministic(question, answer);
  return finalizeCoursewareQuizScore(question, raw, language);
}

export function scoreSkippedOptionalQuestion(question: QuizQuestion): CoursewareQuizScoreResult {
  const maxScore = Math.max(0, finiteNumber(question.score));
  return {
    score: 0,
    maxScore,
    rawScore: 0,
    passed: false,
    canAdvance: true,
    feedback: "",
    feedbackDetail: { skipped: true },
  };
}
