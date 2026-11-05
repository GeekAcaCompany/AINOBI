// SPDX-License-Identifier: AGPL-3.0-only
import type {
  CoursewareQuizAnswerContent,
  CoursewareQuizAnswerRecord,
  CoursewareQuizAttemptAnswerRecord,
} from "../../api/courseware.ts";
import type { SlideElement } from "@ainobi/courseware-core/elements.ts";
import type { QuizConfig, QuizQuestion } from "@ainobi/courseware-core/quiz.ts";
import { buildTopLevelQuizWrapperIndex } from "@ainobi/courseware-core/quiz-preview-wrappers.ts";

/**
 * Only the standalone learner preview page restores historical answers; the editor iframe / `?id=` export preview are for debugging questions and don't sync.
 */
export const shouldSyncQuizAnswersOnPreviewLoad = (): boolean => {
  if (typeof window === "undefined") return false;
  if (window.parent !== window) return false;
  const search = new URLSearchParams(window.location.search);
  if (search.get("id")?.trim() || search.get("data")) return false;
  return true;
};

/** Agent `GET /courseware/quiz/answers` row used to restore preview quiz state. */
export type QuizAttemptAnswerRecord = {
  question_wrapper_id: string;
  answer: CoursewareQuizAnswerContent & Record<string, unknown>;
  score: number;
  can_advance: boolean;
  feedback: string;
  feedback_detail?: Record<string, unknown> | null;
};

export const mapAgentAttemptAnswerToSyncRecord = (
  record: CoursewareQuizAttemptAnswerRecord,
): QuizAttemptAnswerRecord => ({
  question_wrapper_id: record.question_wrapper_id,
  answer: record.answer,
  score: record.score,
  can_advance: record.can_advance,
  feedback: record.feedback,
  feedback_detail: record.feedback_detail ?? null,
});

/** Main API homework row (survives after attempt session is cleared on complete). */
export const mapPersistedQuizAnswerToSyncRecord = (
  record: CoursewareQuizAnswerRecord,
): QuizAttemptAnswerRecord => ({
  question_wrapper_id: record.question_wrapper_id,
  answer: record.answer,
  score: record.score,
  // Revisit after homework submit: playback should not block on historical attempts.
  can_advance: true,
  feedback: record.feedback ?? "",
  feedback_detail: record.feedback_detail ?? null,
});

export type FetchQuizAnswersForPreviewRestoreParams = {
  orgId: string;
  coursewareId: string;
  sectionId?: string | null;
  studentId?: string | null;
  attemptSessionId?: string | null;
  listAttemptAnswers: (params: {
    attemptSessionId?: string;
    coursewareId: string;
    sectionId?: string;
  }) => Promise<{ answers: CoursewareQuizAttemptAnswerRecord[] }>;
  listPersistedAnswers?: (params: {
    sectionId: string;
    studentId: string;
  }) => Promise<{ answers: CoursewareQuizAnswerRecord[] }>;
};

/**
 * Restore preview quiz state from agent attempt submissions, then fall back to
 * section homework records after `completeQuizSession` clears sessionStorage.
 */
export const fetchQuizAnswersForPreviewRestore = async (
  params: FetchQuizAnswersForPreviewRestoreParams,
): Promise<QuizAttemptAnswerRecord[]> => {
  const coursewareId = params.coursewareId.trim();
  const sectionId = params.sectionId?.trim() || undefined;
  const attemptSessionId = params.attemptSessionId?.trim() || undefined;

  if (attemptSessionId) {
    const attemptScoped = await params.listAttemptAnswers({
      attemptSessionId,
      coursewareId,
      sectionId,
    });
    if (attemptScoped.answers.length > 0) {
      return attemptScoped.answers.map(mapAgentAttemptAnswerToSyncRecord);
    }
  }

  const studentId = params.studentId?.trim();
  if (sectionId && studentId && params.listPersistedAnswers) {
    try {
      const persisted = await params.listPersistedAnswers({ sectionId, studentId });
      if (persisted.answers.length > 0) {
        return persisted.answers.map(mapPersistedQuizAnswerToSyncRecord);
      }
    } catch {
      // Fall through to agent courseware-wide lookup.
    }
  }

  if (sectionId) {
    const coursewareScoped = await params.listAttemptAnswers({
      coursewareId,
      sectionId,
    });
    if (coursewareScoped.answers.length > 0) {
      return coursewareScoped.answers.map(mapAgentAttemptAnswerToSyncRecord);
    }
  }

  return [];
};

export type RestorableQuizQuestionState = {
  selectedOptionIds: Set<string>;
  inputValues: Record<string, string>;
  recordingFieldName: string | null;
  recordingElapsedSec: number;
  recordedBlobUrl: string | null;
  recordedDurationSec: number;
  submitted: boolean;
  skipped?: boolean;
  isSubmitting: boolean;
  score: number | null;
  feedback: string | null;
  feedback_detail?: Record<string, unknown> | null;
  canAdvance: boolean;
};

const resolveQuestionForWrapper = (
  quiz: QuizConfig,
  quizQuestionId: string,
): QuizQuestion | null =>
  quiz.questions.find((question) => question.question_id === quizQuestionId) ?? null;

const restoreSelectedOptionIds = (
  answer: CoursewareQuizAnswerContent,
  question: QuizQuestion | null,
): Set<string> => {
  if (answer.selected_option_ids?.length) {
    return new Set(answer.selected_option_ids);
  }
  if (
    question &&
    (question.type === "single_choice" || question.type === "multiple_choice") &&
    answer.selected_option_indices?.length
  ) {
    const ids = answer.selected_option_indices
      .map((index) => question.options[index]?.option_id)
      .filter((id): id is string => Boolean(id));
    return new Set(ids);
  }
  return new Set<string>();
};

const restoreInputValues = (
  answer: CoursewareQuizAnswerContent,
  question: QuizQuestion | null,
): Record<string, string> => {
  const inputValues: Record<string, string> = { ...answer.value_by_member_id };
  if (question?.type === "fill_blank") {
    for (const [index, blank] of question.blanks.entries()) {
      const value = answer.values?.[index];
      if (value !== undefined) {
        inputValues[blank.blank_id] = value;
      }
    }
  } else if (question?.type === "essay" || question?.type === "speech") {
    const essayValue = answer.values?.[0] ?? answer.value_by_member_id?.answer;
    if (essayValue !== undefined) {
      inputValues.answer = essayValue;
    }
  }
  return inputValues;
};

export const restoreQuizQuestionStateFromAttemptAnswer = (
  record: QuizAttemptAnswerRecord,
  question: QuizQuestion | null,
): RestorableQuizQuestionState => {
  const answer = record.answer;
  if (answer.skipped === true) {
    return {
      selectedOptionIds: new Set<string>(),
      inputValues: {},
      recordingFieldName: null,
      recordingElapsedSec: 0,
      recordedBlobUrl: null,
      recordedDurationSec: 0,
      submitted: true,
      skipped: true,
      isSubmitting: false,
      score: record.score,
      feedback: record.feedback || null,
      feedback_detail: record.feedback_detail ?? null,
      canAdvance: record.can_advance,
    };
  }

  const recordingUrl = answer.recording_file_url?.trim() || null;
  return {
    selectedOptionIds: restoreSelectedOptionIds(answer, question),
    inputValues: restoreInputValues(answer, question),
    recordingFieldName: answer.recording_member_id ?? null,
    recordingElapsedSec: 0,
    recordedBlobUrl: recordingUrl,
    recordedDurationSec:
      typeof answer.recording_duration_sec === "number" && Number.isFinite(answer.recording_duration_sec)
        ? answer.recording_duration_sec
        : 0,
    submitted: true,
    skipped: false,
    isSubmitting: false,
    score: record.score,
    feedback: record.feedback || null,
    feedback_detail: record.feedback_detail ?? null,
    canAdvance: record.can_advance,
  };
};

type MergeableQuizQuestionState = RestorableQuizQuestionState & Record<string, unknown>;

/**
 * Merge authoritative attempt-session answers into local preview state.
 * Skips wrappers that are already submitting or submitted in the current tab.
 */
export const mergeQuizStateFromAttemptAnswers = <T extends MergeableQuizQuestionState>(
  current: Record<string, T>,
  answers: readonly QuizAttemptAnswerRecord[],
  quiz: QuizConfig,
  slides: readonly SlideElement[],
): Record<string, T> => {
  if (answers.length === 0) return current;

  const wrapperIndex = buildTopLevelQuizWrapperIndex(slides);
  let changed = false;
  const next: Record<string, T> = { ...current };

  for (const record of answers) {
    const wrapperId = record.question_wrapper_id?.trim();
    if (!wrapperId) continue;

    const existing = next[wrapperId];
    if (existing?.isSubmitting || existing?.submitted || existing?.skipped) {
      continue;
    }

    const located = wrapperIndex.get(wrapperId);
    if (!located) continue;
    const question = resolveQuestionForWrapper(quiz, located.quizEl.quiz_question_id);
    if (!question) continue;

    next[wrapperId] = {
      ...(existing ?? ({} as T)),
      ...restoreQuizQuestionStateFromAttemptAnswer(record, question),
    } as T;
    changed = true;
  }

  return changed ? next : current;
};
