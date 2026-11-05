// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, afterEach } from "vitest";
import type { QuizSlideElement, SlideElement } from "@ainobi/courseware-core/elements.ts";
import type { QuizConfig, QuizQuestion } from "@ainobi/courseware-core/quiz.ts";
import {
  fetchQuizAnswersForPreviewRestore,
  mapPersistedQuizAnswerToSyncRecord,
  mergeQuizStateFromAttemptAnswers,
  restoreQuizQuestionStateFromAttemptAnswer,
  shouldSyncQuizAnswersOnPreviewLoad,
  type QuizAttemptAnswerRecord,
} from "./quiz-attempt-sync.ts";

const choiceQuestion = (): QuizQuestion =>
  ({
    question_id: "q1",
    type: "single_choice",
    title: "Pick one",
    required: true,
    allow_resubmit: false,
    score: 5,
    options: [
      { option_id: "opt-a", text: "A", is_correct: true },
      { option_id: "opt-b", text: "B", is_correct: false },
    ],
    blanks: [],
    show_feedback_score: true,
  }) as unknown as QuizQuestion;

const fillBlankQuestion = (): QuizQuestion =>
  ({
    question_id: "q2",
    type: "fill_blank",
    title: "Fill",
    required: true,
    allow_resubmit: false,
    score: 5,
    options: [],
    blanks: [{ blank_id: "b1", answer: "x", aliases: [] }],
    show_feedback_score: true,
  }) as unknown as QuizQuestion;

const baseQuiz = (): QuizConfig =>
  ({
    enabled: true,
    total_score: 10,
    grade_levels: [],
    questions: [choiceQuestion(), fillBlankQuestion()],
    score_summary: null,
  }) as unknown as QuizConfig;

const topLevelQuiz = (id: string, questionId: string): QuizSlideElement =>
  ({
    element_type: "quiz",
    element_id: id,
    quiz_question_id: questionId,
  }) as QuizSlideElement;

const slides = (): SlideElement[] =>
  [
    {
      element_id: "slide-1",
      children_elements: [topLevelQuiz("wrap-1", "q1"), topLevelQuiz("wrap-2", "q2")],
    },
  ] as SlideElement[];

const record = (overrides: Partial<QuizAttemptAnswerRecord>): QuizAttemptAnswerRecord => ({
  question_wrapper_id: "wrap-1",
  answer: { selected_option_ids: ["opt-a"] },
  score: 5,
  can_advance: true,
  feedback: "Correct",
  feedback_detail: null,
  ...overrides,
});
describe("shouldSyncQuizAnswersOnPreviewLoad", () => {
  const originalParent = window.parent;
  const originalSearch = window.location.search;

  afterEach(() => {
    Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
    window.history.replaceState({}, "", `/${originalSearch ? `?${originalSearch.slice(1)}` : ""}`);
  });

  it("returns false inside an iframe (editor embedded preview)", () => {
    Object.defineProperty(window, "parent", { configurable: true, value: {} });
    window.history.replaceState({}, "", "/courseware-preview?courseware_id=cw-1");
    expect(shouldSyncQuizAnswersOnPreviewLoad()).toBe(false);
  });

  it("returns false for editor export preview bundles (`?id=`)", () => {
    window.history.replaceState({}, "", "/courseware-preview?id=preview-1&courseware_id=cw-1");
    expect(shouldSyncQuizAnswersOnPreviewLoad()).toBe(false);
  });

  it("returns true for standalone learner preview", () => {
    window.history.replaceState({}, "", "/courseware-preview?courseware_id=cw-1");
    expect(shouldSyncQuizAnswersOnPreviewLoad()).toBe(true);
  });
});

describe("fetchQuizAnswersForPreviewRestore", () => {
  it("falls back to persisted section answers when attempt session is cleared", async () => {
    const answers = await fetchQuizAnswersForPreviewRestore({
      orgId: "org-1",
      coursewareId: "cw-1",
      sectionId: "section-1",
      studentId: "student-1",
      attemptSessionId: null,
      listAttemptAnswers: async () => ({ answers: [] }),
      listPersistedAnswers: async () => ({
        answers: [
          {
            id: "row-1",
            student_id: "student-1",
            section_id: "section-1",
            question_wrapper_id: "wrap-1",
            answer: { selected_option_ids: ["opt-a"] },
            score: 5,
            max_score: 5,
            is_correct: true,
            feedback: "Correct",
            submitted_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(answers).toHaveLength(1);
    expect(answers[0]?.question_wrapper_id).toBe("wrap-1");
    expect(answers[0]?.can_advance).toBe(true);
  });

  it("prefers in-progress attempt session answers over persisted rows", async () => {
    const answers = await fetchQuizAnswersForPreviewRestore({
      orgId: "org-1",
      coursewareId: "cw-1",
      sectionId: "section-1",
      studentId: "student-1",
      attemptSessionId: "attempt-1",
      listAttemptAnswers: async ({ attemptSessionId }) => ({
        answers:
          attemptSessionId === "attempt-1"
            ? [
                {
                  submission_id: "sub-1",
                  attempt_session_id: "attempt-1",
                  question_id: "q1",
                  question_wrapper_id: "wrap-1",
                  answer: { selected_option_ids: ["opt-b"] },
                  score: 0,
                  max_score: 5,
                  passed: false,
                  can_advance: false,
                  feedback: "Wrong",
                  submitted_at: "2026-01-01T00:00:00.000Z",
                },
              ]
            : [],
      }),
      listPersistedAnswers: async () => ({
        answers: [
          {
            id: "row-1",
            student_id: "student-1",
            section_id: "section-1",
            question_wrapper_id: "wrap-1",
            answer: { selected_option_ids: ["opt-a"] },
            score: 5,
            max_score: 5,
            is_correct: true,
            feedback: "Correct",
            submitted_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(answers[0]?.feedback).toBe("Wrong");
  });
});

describe("mapPersistedQuizAnswerToSyncRecord", () => {
  it("maps homework rows into restorable attempt records", () => {
    const mapped = mapPersistedQuizAnswerToSyncRecord({
      id: "row-1",
      student_id: "student-1",
      section_id: "section-1",
      question_wrapper_id: "wrap-2",
      answer: { values: ["hello"] },
      score: 3,
      max_score: 5,
      is_correct: false,
      feedback: "Try again",
      submitted_at: "2026-01-01T00:00:00.000Z",
    });
    expect(mapped.can_advance).toBe(true);
    expect(mapped.feedback).toBe("Try again");
  });
});

describe("restoreQuizQuestionStateFromAttemptAnswer", () => {
  it("restores choice answers by option id", () => {
    const state = restoreQuizQuestionStateFromAttemptAnswer(
      record({ answer: { selected_option_ids: ["opt-a"] } }),
      choiceQuestion(),
    );
    expect(state.submitted).toBe(true);
    expect([...state.selectedOptionIds]).toEqual(["opt-a"]);
    expect(state.canAdvance).toBe(true);
  });

  it("restores choice answers by option index fallback", () => {
    const state = restoreQuizQuestionStateFromAttemptAnswer(
      record({ answer: { selected_option_indices: [1] } }),
      choiceQuestion(),
    );
    expect([...state.selectedOptionIds]).toEqual(["opt-b"]);
  });

  it("restores skipped optional answers", () => {
    const state = restoreQuizQuestionStateFromAttemptAnswer(
      record({ answer: { skipped: true }, score: 0, can_advance: true, feedback: "" }),
      choiceQuestion(),
    );
    expect(state.skipped).toBe(true);
    expect(state.submitted).toBe(true);
  });
});

describe("mergeQuizStateFromAttemptAnswers", () => {
  it("hydrates unanswered wrappers from attempt records", () => {
    const merged = mergeQuizStateFromAttemptAnswers(
      {},
      [
        record({ question_wrapper_id: "wrap-1" }),
        record({
          question_wrapper_id: "wrap-2",
          answer: { values: ["hello"] },
          score: 3,
          can_advance: false,
          feedback: "Try again",
        }),
      ],
      baseQuiz(),
      slides(),
    );
    expect(merged["wrap-1"]?.submitted).toBe(true);
    expect(merged["wrap-2"]?.submitted).toBe(true);
    expect(merged["wrap-2"]?.inputValues.b1).toBe("hello");
    expect(merged["wrap-2"]?.canAdvance).toBe(false);
  });

  it("does not overwrite local submitted state in the same tab", () => {
    const merged = mergeQuizStateFromAttemptAnswers(
      {
        "wrap-1": {
          selectedOptionIds: new Set(["opt-b"]),
          inputValues: {},
          recordingFieldName: null,
          recordingElapsedSec: 0,
          recordedBlobUrl: null,
          recordedDurationSec: 0,
          submitted: true,
          isSubmitting: false,
          score: 0,
          feedback: "local",
          feedback_detail: null,
          canAdvance: false,
        },
      },
      [record({ question_wrapper_id: "wrap-1", score: 5, feedback: "remote" })],
      baseQuiz(),
      slides(),
    );
    expect(merged["wrap-1"]?.feedback).toBe("local");
  });
});
