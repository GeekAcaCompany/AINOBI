// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  buildCoursewareEditorClipboardPayload,
  collectQuizQuestionIdsFromElements,
  collectQuizQuestionsForElements,
  COURSEWARE_EDITOR_CLIPBOARD_MARKER,
  parseCoursewareEditorClipboard,
  serializeCoursewareEditorClipboard,
} from "./editor-clipboard.ts";
import { cloneSlideChildrenWithFreshIds } from "./editor-paste.ts";
import type { QuizSlideElement } from "@ainobi/courseware-core/elements.ts";
import { createDefaultQuestion, type QuizConfig } from "@ainobi/courseware-core/quiz.ts";

const makeQuizSlideElement = (questionId: string): QuizSlideElement =>
  ({
    element_id: "el_quiz",
    element_type: "quiz",
    quiz_question_id: questionId,
    name: "Quiz",
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    timeline: { start_at: 0, end_at: 5000 },
    enter_effect: "none",
    exit_effect: "none",
    event_bindings: [],
    metadata: {},
  }) as unknown as QuizSlideElement;

describe("editor-clipboard", () => {
  it("round-trips clipboard payload JSON", () => {
    const sourceQuestion = createDefaultQuestion("single_choice", "en");
    sourceQuestion.title = "Pick one";
    const quiz: QuizConfig = {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      grade_levels: [],
      score_summary: null,
      questions: [sourceQuestion],
    };
    const elements = [makeQuizSlideElement(sourceQuestion.question_id)];

    const payload = buildCoursewareEditorClipboardPayload("cw_a", elements, quiz);
    expect(payload[COURSEWARE_EDITOR_CLIPBOARD_MARKER]).toBe(true);
    expect(payload.quizQuestions).toHaveLength(1);
    expect(payload.quizQuestions[0]?.question_id).toBe(sourceQuestion.question_id);

    const parsed = parseCoursewareEditorClipboard(serializeCoursewareEditorClipboard(payload));
    expect(parsed?.sourceCoursewareId).toBe("cw_a");
    expect(parsed?.elements).toHaveLength(1);
    expect(parsed?.quizQuestions).toHaveLength(1);
  });

  it("rejects non-courseware clipboard text", () => {
    expect(parseCoursewareEditorClipboard('{"foo":1}')).toBeNull();
    expect(parseCoursewareEditorClipboard("hello")).toBeNull();
  });

  it("collects nested quiz question ids", () => {
    const ids = collectQuizQuestionIdsFromElements([
      {
        element_id: "grp",
        element_type: "group",
        name: "Group",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        timeline: { start_at: 0, end_at: 1000 },
        enter_effect: "none",
        exit_effect: "none",
        event_bindings: [],
        metadata: {},
        children_elements: [makeQuizSlideElement("q_nested")],
      } as unknown as import("@ainobi/courseware-core/elements.ts").GroupElement,
    ]);
    expect(ids).toEqual(new Set(["q_nested"]));
    expect(
      collectQuizQuestionsForElements([makeQuizSlideElement("q_nested")], {
        enabled: true,
        total_score: 100,
        score_allocation: "even_split",
        time_limit_minutes: null,
        grade_levels: [],
      score_summary: null,
        questions: [{ ...createDefaultQuestion("single_choice", "en"), question_id: "q_nested", title: "Nested" }],
      }),
    ).toHaveLength(1);
  });
});

describe("editor-paste cross-courseware quiz lookup", () => {
  it("clones quiz questions bundled in clipboard payload", () => {
    const bundled = [{ ...createDefaultQuestion("single_choice", "en"), title: "Remote" }];
    const { children, newQuestions } = cloneSlideChildrenWithFreshIds(
      [makeQuizSlideElement(bundled[0]!.question_id)],
      null,
      bundled,
    );
    expect(newQuestions).toHaveLength(1);
    expect(newQuestions[0]?.question_id).not.toBe(bundled[0]!.question_id);
    expect((children[0] as QuizSlideElement).quiz_question_id).toBe(newQuestions[0]?.question_id);
  });
});
