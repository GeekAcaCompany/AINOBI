// SPDX-License-Identifier: AGPL-3.0-only
import type { SubmitCoursewareQuizAnswerResponse } from "../../api/courseware.ts";

export const QUIZ_SUBMIT_ERROR_CODES = [
  "quiz_scoring_retry",
] as const;

export type QuizSubmitErrorCode = (typeof QUIZ_SUBMIT_ERROR_CODES)[number];

const INSUFFICIENT_CREDITS_MARKERS = [
  "insufficient credits",
  "insufficient balance",
  "asset_insufficient_balance",
  "payment required",
  "余额不足",
  "额度不足",
] as const;

type QuizSubmitFeedbackMessages = {
  insufficientCreditsMessage: string;
  missingRecordingMessage: string;
  unsupportedQuestionTypeMessage: string;
};

type QuizSubmitErrorWithCode = Error & {
  code?: string;
};

const collectQuizSubmitFeedbackText = (result: SubmitCoursewareQuizAnswerResponse): string[] => {
  const texts: string[] = [];
  if (result.feedback) texts.push(result.feedback);

  const detail = result.feedback_detail;
  if (!detail || typeof detail !== "object") return texts;

  const record = detail as Record<string, unknown>;
  if (typeof record.error === "string") texts.push(record.error);

  const nested = record.feedback;
  if (nested && typeof nested === "object") {
    const feedback = nested as Record<string, unknown>;
    if (typeof feedback.error === "string") texts.push(feedback.error);
    if (typeof feedback.explanation === "string") texts.push(feedback.explanation);
  }

  return texts;
};

/** Detect org/personal credit exhaustion from a successful quiz grade response. */
export const isQuizSubmitInsufficientCredits = (
  result: SubmitCoursewareQuizAnswerResponse,
): boolean => {
  const haystack = collectQuizSubmitFeedbackText(result).join("\n").toLowerCase();
  return INSUFFICIENT_CREDITS_MARKERS.some((marker) => haystack.includes(marker));
};

/** Replace generic AI scoring fallback copy when credits are exhausted. */
export const resolveQuizSubmitDisplayFeedback = (
  result: SubmitCoursewareQuizAnswerResponse,
  messages: QuizSubmitFeedbackMessages,
): string => {
  if (isQuizSubmitInsufficientCredits(result)) return messages.insufficientCreditsMessage;

  const detail = result.feedback_detail;
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (record.error === "missing_recording") return messages.missingRecordingMessage;
    if (record.error === "unsupported_ai_question_type") {
      return messages.unsupportedQuestionTypeMessage;
    }
  }

  return result.feedback;
};

export const resolveQuizSubmitErrorMessage = (
  error: unknown,
  message: string,
  scoringRetryMessage: string,
): string => {
  if (
    error instanceof Error &&
    (error as QuizSubmitErrorWithCode).code === "quiz_scoring_retry"
  ) {
    return scoringRetryMessage;
  }
  return message;
};
