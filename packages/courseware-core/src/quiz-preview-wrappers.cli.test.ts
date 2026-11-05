// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectTopLevelQuizWrappersFromSceneContent,
  requiredWrapperIds,
} from "./quiz-preview-wrappers.ts";
import type { QuizConfig } from "./quiz.ts";

test("requiredWrapperIds only counts top-level quiz wrappers", () => {
  const quiz = {
    questions: [
      { question_id: "q1", required: true },
      { question_id: "q_nested", required: true },
    ],
  } as QuizConfig;
  const content = {
    slide_elements: [
      {
        children_elements: [
          { element_type: "quiz", element_id: "wrap1", quiz_question_id: "q1" },
          {
            element_type: "group",
            element_id: "group1",
            children_elements: [
              { element_type: "quiz", element_id: "nested", quiz_question_id: "q_nested" },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(requiredWrapperIds(content, quiz), ["wrap1"]);
  assert.equal(collectTopLevelQuizWrappersFromSceneContent(content).size, 1);
});

test("requiredWrapperIds ignores unbound top-level wrappers", () => {
  const quiz = {
    questions: [{ question_id: "q1", required: true }],
  } as QuizConfig;
  const content = {
    slide_elements: [
      {
        children_elements: [
          { element_type: "quiz", element_id: "orphan", quiz_question_id: "missing" },
        ],
      },
    ],
  };

  assert.deepEqual(requiredWrapperIds(content, quiz), []);
});
