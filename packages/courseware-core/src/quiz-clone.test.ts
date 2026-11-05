// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createDefaultQuestionWithAst } from "./quiz-default-asts.ts";
import {
  cloneQuizQuestionWithFreshIds,
  serializeQuizConfig,
  type QuizConfig,
  type QuizMultipleChoiceQuestion,
} from "./quiz.ts";

describe("cloneQuizQuestionWithFreshIds", () => {
  it("remaps react_layout QuizOption values to match new options[].option_id", () => {
    const source = createDefaultQuestionWithAst(
      "multiple_choice",
      "en",
    ) as QuizMultipleChoiceQuestion;
    const cloned = cloneQuizQuestionWithFreshIds(source) as QuizMultipleChoiceQuestion;

    expect(cloned.question_id).not.toBe(source.question_id);
    expect(cloned.options.map((o) => o.option_id)).not.toEqual(
      source.options.map((o) => o.option_id),
    );
    for (const opt of cloned.options) {
      expect(opt.value).toBe(opt.option_id);
    }

    const config: QuizConfig = {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      questions: [source, cloned],
      grade_levels: [],
      score_summary: null,
    };
    expect(() => serializeQuizConfig(config)).not.toThrow();
  });
});
