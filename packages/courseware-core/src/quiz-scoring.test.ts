// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  evaluateCoursewareQuizAnswer,
  scoreChoiceQuestion,
  scoreExactFillBlankQuestion,
  scoreSkippedOptionalQuestion,
} from "./quiz-scoring.ts";
import type { QuizFillBlankQuestion, QuizMultipleChoiceQuestion, QuizSingleChoiceQuestion } from "./quiz.ts";

const base = {
  title: "Question",
  explanation: "",
  required: true,
  pass_score: 0,
  advance_score: 0,
  allow_resubmit: true,
  show_feedback_score: true,
  time_limit_minutes: null,
  content_narration_audio_url: "",
  content_narration_duration_ms: 0,
  content_narration_vtuber_element_id: "",
  react_layout: { kind: "element", tag: "QuizContainer", props: {}, children: [] },
} as const;

test("single choice scores by selected option index", () => {
  const question: QuizSingleChoiceQuestion = {
    ...base,
    question_id: "q1",
    type: "single_choice",
    score: 10,
    options: [
      { option_id: "a", value: "A", is_correct: false },
      { option_id: "b", value: "B", is_correct: true },
    ],
  };
  assert.equal(scoreChoiceQuestion(question, { selected_option_indices: [1] }), 10);
  assert.equal(scoreChoiceQuestion(question, { selected_option_indices: [0] }), 0);
});

test("multiple choice partial credit subtracts wrong selections", () => {
  const question: QuizMultipleChoiceQuestion = {
    ...base,
    question_id: "q2",
    type: "multiple_choice",
    score: 10,
    grading: "partial_credit",
    options: [
      { option_id: "a", value: "A", is_correct: true },
      { option_id: "b", value: "B", is_correct: true },
      { option_id: "c", value: "C", is_correct: false },
    ],
  };
  assert.equal(scoreChoiceQuestion(question, { selected_option_indices: [0] }), 5);
  assert.equal(scoreChoiceQuestion(question, { selected_option_indices: [0, 2] }), 0);
});

test("fill blank exact scoring supports aliases and case-insensitive comparison", () => {
  const question: QuizFillBlankQuestion = {
    ...base,
    question_id: "q3",
    type: "fill_blank",
    score: 12,
    blanks: [
      { blank_id: "b1", answer: "Tokyo", aliases: ["東京"] },
      { blank_id: "b2", answer: "AI", aliases: [] },
    ],
    case_sensitive: false,
    grading: "exact_match",
    grading_criteria: "",
  };
  assert.equal(scoreExactFillBlankQuestion(question, { values: [" tokyo ", "ai"] }), 12);
  assert.equal(scoreExactFillBlankQuestion(question, { values: ["東京", "wrong"] }), 6);
});

test("final score applies pass and advance gates consistently", async () => {
  const question: QuizSingleChoiceQuestion = {
    ...base,
    question_id: "q4",
    type: "single_choice",
    score: 10,
    pass_score: 8,
    advance_score: 8,
    options: [
      { option_id: "a", value: "A", is_correct: true },
      { option_id: "b", value: "B", is_correct: false },
    ],
  };
  const result = await evaluateCoursewareQuizAnswer(question, {
    selected_option_indices: [1],
  });
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.canAdvance, false);
});

test("deterministic feedback text follows the resolved language, default English", async () => {
  const question: QuizSingleChoiceQuestion = {
    ...base,
    question_id: "q6",
    type: "single_choice",
    score: 10,
    pass_score: 8,
    advance_score: 8,
    options: [
      { option_id: "a", value: "A", is_correct: true },
      { option_id: "b", value: "B", is_correct: false },
    ],
  };

  const zhFail = await evaluateCoursewareQuizAnswer(
    question,
    { selected_option_indices: [1] },
    undefined,
    "zh",
  );
  assert.equal(zhFail.feedback, "题目分数未达标要求再次答题");

  const jaPass = await evaluateCoursewareQuizAnswer(
    question,
    { selected_option_indices: [0] },
    undefined,
    "ja",
  );
  assert.equal(jaPass.feedback, "得点 10/10");

  const defaultFail = await evaluateCoursewareQuizAnswer(question, {
    selected_option_indices: [1],
  });
  assert.equal(defaultFail.feedback, "Score below the required threshold — please try again.");
});

test("skipped optional answers bypass scoring and allow advance", async () => {
  const question: QuizSingleChoiceQuestion = {
    ...base,
    question_id: "q5",
    required: false,
    type: "single_choice",
    score: 10,
    options: [
      { option_id: "a", value: "A", is_correct: true },
      { option_id: "b", value: "B", is_correct: false },
    ],
  };
  const skipped = scoreSkippedOptionalQuestion(question);
  assert.equal(skipped.score, 0);
  assert.equal(skipped.canAdvance, true);
  const evaluated = await evaluateCoursewareQuizAnswer(question, { skipped: true });
  assert.equal(evaluated.canAdvance, true);
  assert.deepEqual(evaluated.feedbackDetail, { skipped: true });
});
