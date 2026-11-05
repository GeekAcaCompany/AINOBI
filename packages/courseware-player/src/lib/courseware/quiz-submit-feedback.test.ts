// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import type { SubmitCoursewareQuizAnswerResponse } from "../../api/courseware.ts";

import {
  isQuizSubmitInsufficientCredits,
  resolveQuizSubmitErrorMessage,
  resolveQuizSubmitDisplayFeedback,
} from "./quiz-submit-feedback.ts";

const messages = {
  insufficientCreditsMessage: "Please contact your administrator.",
  missingRecordingMessage: "No valid recording was received, so this answer could not be graded.",
  unsupportedQuestionTypeMessage: "This question type is not currently supported for grading.",
};

const baseResult = (): SubmitCoursewareQuizAnswerResponse => ({
  score: 0,
  max_score: 8,
  passed: false,
  can_advance: true,
  feedback: "AI 语音评分系统遇到问题，请稍后再试。",
});

describe("quiz submit feedback", () => {
  it("detects insufficient credits from nested feedback_detail.error", () => {
    const result: SubmitCoursewareQuizAnswerResponse = {
      ...baseResult(),
      feedback_detail: {
        feedback: {
          error: "Audio scoring failed: Insufficient credits balance",
          explanation: "AI 语音评分系统遇到问题，请稍后再试。",
        },
      },
    };
    expect(isQuizSubmitInsufficientCredits(result)).toBe(true);
  });

  it("leaves normal scoring feedback unchanged", () => {
    const result: SubmitCoursewareQuizAnswerResponse = {
      score: 6,
      max_score: 8,
      passed: true,
      can_advance: true,
      feedback: "发音不错，继续加油。",
    };
    expect(isQuizSubmitInsufficientCredits(result)).toBe(false);
    expect(resolveQuizSubmitDisplayFeedback(result, messages)).toBe("发音不错，继续加油。");
  });

  it("replaces generic AI error copy when credits are exhausted", () => {
    const result: SubmitCoursewareQuizAnswerResponse = {
      ...baseResult(),
      feedback_detail: {
        feedback: {
          error: "Audio scoring failed: Insufficient credits balance",
        },
      },
    };
    expect(resolveQuizSubmitDisplayFeedback(result, messages)).toBe(
      "Please contact your administrator.",
    );
  });

  it("maps known backend missing recording fallback copy", () => {
    const result: SubmitCoursewareQuizAnswerResponse = {
      ...baseResult(),
      feedback: "未收到有效录音文件，无法评分",
      feedback_detail: {
        error: "missing_recording",
      },
    };
    expect(resolveQuizSubmitDisplayFeedback(result, messages)).toBe(
      "No valid recording was received, so this answer could not be graded.",
    );
  });

  it("maps known backend unsupported type fallback copy", () => {
    const result: SubmitCoursewareQuizAnswerResponse = {
      ...baseResult(),
      feedback: "该题型暂不支持当前评分方式",
      feedback_detail: {
        error: "unsupported_ai_question_type",
      },
    };
    expect(resolveQuizSubmitDisplayFeedback(result, messages)).toBe(
      "This question type is not currently supported for grading.",
    );
  });

  it("maps known backend retry error copy on the thrown-error path", () => {
    const error = Object.assign(
      new Error("AI scoring temporarily failed. Please submit your answer again."),
      { code: "quiz_scoring_retry" },
    );
    expect(
      resolveQuizSubmitErrorMessage(
        error,
        error.message,
        "AI scoring temporarily failed. Please submit your answer again.",
      ),
    ).toBe("AI scoring temporarily failed. Please submit your answer again.");
  });
});
