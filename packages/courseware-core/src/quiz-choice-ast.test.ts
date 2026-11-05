// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  appendQuizOptionToChoiceAst,
  extractQuizOptionLabelFromAst,
  removeQuizOptionFromChoiceAst,
  setQuizOptionTextInChoiceAst,
} from "./quiz-ast.ts";
import { createDefaultQuestionWithAst } from "./quiz-default-asts.ts";
import { newQuizChoiceOption, type QuizMultipleChoiceQuestion } from "./quiz.ts";

describe("choice option AST editor helpers", () => {
  const baseQuestion = createDefaultQuestionWithAst(
    "multiple_choice",
    "en",
  ) as QuizMultipleChoiceQuestion;

  it("appends a QuizOption node when the editor adds a new options[] entry", () => {
    const added = newQuizChoiceOption();
    const layout = appendQuizOptionToChoiceAst(baseQuestion.react_layout, added.option_id, "")!;
    expect(extractQuizOptionLabelFromAst(layout, added.option_id)).toBe("");

    const withText = setQuizOptionTextInChoiceAst(layout, added.option_id, "New choice")!;
    expect(extractQuizOptionLabelFromAst(withText, added.option_id)).toBe("New choice");
  });

  it("removes the matching QuizOption node", () => {
    const targetId = baseQuestion.options[0]!.option_id;
    const layout = removeQuizOptionFromChoiceAst(baseQuestion.react_layout, targetId)!;
    expect(extractQuizOptionLabelFromAst(layout, targetId)).toBe("");
    expect(extractQuizOptionLabelFromAst(layout, baseQuestion.options[1]!.option_id)).not.toBe("");
  });

  it("uses localized starter labels when requested", () => {
    const question = createDefaultQuestionWithAst("essay", "en");
    expect(question.title).toBe("Enter the question here");
    expect(JSON.stringify(question.react_layout)).toContain("Please enter your answer...");
  });
});
