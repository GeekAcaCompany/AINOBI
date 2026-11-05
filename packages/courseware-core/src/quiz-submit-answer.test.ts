// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { coursewareQuizUsesAiScoring, type QuizFillBlankQuestion } from "./quiz.ts";

/** Mirrors courseware-preview `buildQuizAnswerContent` fill_blank branch. */
const packFillBlankValues = (
  question: QuizFillBlankQuestion,
  inputValues: Record<string, string>,
): string[] => question.blanks.map((b) => inputValues[b.blank_id] ?? "");

describe("coursewareQuizUsesAiScoring", () => {
  it("matches backend uses_ai rules", () => {
    expect(coursewareQuizUsesAiScoring({ type: "essay" })).toBe(true);
    expect(coursewareQuizUsesAiScoring({ type: "shadowing" })).toBe(true);
    expect(coursewareQuizUsesAiScoring({ type: "speech" })).toBe(true);
    expect(coursewareQuizUsesAiScoring({ type: "fill_blank", grading: "ai" })).toBe(true);
    expect(coursewareQuizUsesAiScoring({ type: "fill_blank", grading: "exact_match" })).toBe(false);
    expect(coursewareQuizUsesAiScoring({ type: "single_choice" })).toBe(false);
  });
});

describe("quiz submit answer packing", () => {
  it("reads fill_blank answers by blank_id from input_values", () => {
    const question: QuizFillBlankQuestion = {
      question_id: "qz_q_1",
      type: "fill_blank",
      title: "请输入题干：_____",
      explanation: "",
      score: 10,
      required: true,
      pass_score: 0,
      advance_score: 0,
      allow_resubmit: false,
      show_feedback_score: true,
      time_limit_minutes: null,
      content_narration_audio_url: "",
      content_narration_duration_ms: 0,
      content_narration_vtuber_element_id: "",
      react_layout: { kind: "element", tag: "QuizContainer", props: {}, children: [] },
      case_sensitive: false,
      grading: "exact_match",
      grading_criteria: "",
      blanks: [{ blank_id: "qz_bl_abc", answer: "答案", aliases: [] }],
    };
    const fromContainer = { qz_bl_abc: "学习者填写" };
    expect(packFillBlankValues(question, fromContainer)).toEqual(["学习者填写"]);
    expect(packFillBlankValues(question, {})).toEqual([""]);
  });
});
