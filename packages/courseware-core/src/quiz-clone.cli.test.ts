// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import { createDefaultQuestionWithAst } from "./quiz-default-asts.ts";
import {
  cloneQuizQuestionWithFreshIds,
  serializeQuizConfig,
  type QuizConfig,
  type QuizMultipleChoiceQuestion,
} from "./quiz.ts";

test("cloneQuizQuestionWithFreshIds remaps react_layout QuizOption values to match new options[].option_id", () => {
  const source = createDefaultQuestionWithAst(
    "multiple_choice",
    "zh",
  ) as QuizMultipleChoiceQuestion;
  const cloned = cloneQuizQuestionWithFreshIds(source) as QuizMultipleChoiceQuestion;

  assert.notEqual(cloned.question_id, source.question_id);
  assert.notDeepEqual(
    cloned.options.map((o) => o.option_id),
    source.options.map((o) => o.option_id),
  );
  for (const opt of cloned.options) {
    assert.equal(opt.value, opt.option_id);
  }

  const config: QuizConfig = {
    enabled: true,
    total_score: 100,
    score_allocation: "even_split",
    time_limit_minutes: null,
    questions: [source, cloned],
    grade_levels: [],
  };
  assert.doesNotThrow(() => serializeQuizConfig(config));
});
