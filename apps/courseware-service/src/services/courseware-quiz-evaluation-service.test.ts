// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClientQuestionSnapshot,
  resolveQuestionForEvaluation,
  resolveQuizConfigForEvaluation,
  shouldRefreshAttemptSnapshot,
} from "./courseware-quiz-evaluation-service.ts";
import type { QuizConfig, QuizFillBlankQuestion, QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

const fillBlankQuestion = (overrides: Partial<QuizFillBlankQuestion> = {}): QuizFillBlankQuestion =>
  ({
    question_id: "qz_q_36c6bb47c09b",
    type: "fill_blank",
    title: "请输入题干：_____",
    explanation: "",
    score: 100,
    required: true,
    pass_score: 0,
    advance_score: 0,
    allow_resubmit: false,
    show_feedback_score: true,
    time_limit_minutes: null,
    content_narration_audio_url: "",
    content_narration_duration_ms: 0,
    content_narration_vtuber_element_id: "",
    react_layout: {
      kind: "element",
      tag: "QuizContainer",
      props: {},
      children: [],
    },
    case_sensitive: false,
    grading: "exact",
    grading_criteria: "",
    blanks: [{ blank_id: "qz_bl_83b527978f", answer: "答案", aliases: [] }],
    ...overrides,
  }) as QuizFillBlankQuestion;

const sceneQuiz = (questions: QuizQuestion[]): QuizConfig => ({
  enabled: true,
  total_score: 100,
  score_allocation: "even_split",
  time_limit_minutes: null,
  questions,
  grade_levels: [],
  score_summary: null,
});

test("parseClientQuestionSnapshot accepts matching preview question", () => {
  const question = fillBlankQuestion();
  const parsed = parseClientQuestionSnapshot(question, question.question_id);
  assert.equal(parsed?.question_id, question.question_id);
  assert.equal(parsed?.type, "fill_blank");
});

test("parseClientQuestionSnapshot rejects mismatched question_id", () => {
  assert.throws(
    () => parseClientQuestionSnapshot(fillBlankQuestion(), "qz_q_other"),
    /question snapshot question_id does not match request/,
  );
});

test("resolveQuestionForEvaluation prefers client question when scene quiz is missing", () => {
  const client = fillBlankQuestion();
  const question = resolveQuestionForEvaluation(
    null,
    {
      questionId: client.question_id,
      questionWrapperId: "el_a9628c67d7",
      question: client,
    },
    undefined,
  );
  assert.equal(question?.question_id, client.question_id);
});

test("resolveQuestionForEvaluation prefers scene question over forged client snapshot", () => {
  const sceneQuestion = fillBlankQuestion({ score: 100, grading: "exact_match" });
  const forgedClient = fillBlankQuestion({
    score: 1,
    grading: "ai",
    blanks: [{ blank_id: "qz_bl_83b527978f", answer: "x", aliases: ["any"] }],
  });
  const question = resolveQuestionForEvaluation(
    sceneQuiz([sceneQuestion]),
    {
      questionId: sceneQuestion.question_id,
      questionWrapperId: "el_a9628c67d7",
      question: forgedClient,
    },
    undefined,
  );
  assert.equal(question?.score, 100);
  assert.equal((question as QuizFillBlankQuestion | null)?.grading, "exact_match");
});

test("resolveQuestionForEvaluation rejects client snapshot when disallowed", () => {
  const client = fillBlankQuestion();
  const question = resolveQuestionForEvaluation(
    null,
    {
      questionId: client.question_id,
      questionWrapperId: "el_a9628c67d7",
      question: client,
    },
    undefined,
    { allowClientSnapshot: false },
  );
  assert.equal(question, null);
});

test("resolveQuizConfigForEvaluation synthesizes config from client question", () => {
  const client = fillBlankQuestion({ score: 80 });
  const quiz = resolveQuizConfigForEvaluation({}, client);
  assert.ok(quiz);
  assert.equal(quiz.enabled, true);
  assert.equal(quiz.questions.length, 1);
  assert.equal(quiz.questions[0]?.question_id, client.question_id);
  assert.equal(quiz.total_score, 80);
});

test("resolveQuizConfigForEvaluation returns null without scene quiz or client question", () => {
  assert.equal(resolveQuizConfigForEvaluation({}, null), null);
  assert.equal(
    resolveQuizConfigForEvaluation({ quiz: { enabled: false, questions: [] } }, null),
    null,
  );
});

test("resolveQuizConfigForEvaluation does not merge client question into scene quiz", () => {
  const sceneQuestion = fillBlankQuestion({ question_id: "qz_q_scene" });
  const client = fillBlankQuestion({ question_id: "qz_q_preview" });
  const quiz = resolveQuizConfigForEvaluation({ quiz: sceneQuiz([sceneQuestion]) }, client);
  assert.ok(quiz);
  assert.equal(quiz.questions.length, 1);
  assert.equal(quiz.questions[0]?.question_id, "qz_q_scene");
});

test("resolveQuizConfigForEvaluation rejects client synthesis when disallowed", () => {
  const client = fillBlankQuestion();
  assert.equal(
    resolveQuizConfigForEvaluation({}, client, { allowClientSnapshot: false }),
    null,
  );
});

// The author previews a single choice question, then replaces it with a shadowing question on the same slide.
const sceneWith = (questionId: string, type: string) => ({
  quiz: { enabled: true, questions: [{ question_id: questionId, type }] },
  slide_elements: [{ children_elements: [{ element_type: "quiz", element_id: "el_quiz_wrap", quiz_question_id: questionId }] }],
});
const before = sceneWith("qz_q_86dc8368e729", "single_choice");
const after = sceneWith("qz_q_39afcf65553d", "shadowing");
const preview = { coursewareSnapshot: before, courseId: null, sectionId: null };
const graded = { coursewareSnapshot: before, courseId: "course-1", sectionId: "section-1" };

test("a preview attempt takes the latest courseware when the question answered is new", () => {
  // The preview always sends the question id with a server-scored answer.
  assert.equal(shouldRefreshAttemptSnapshot(preview, after, { questionId: "qz_q_39afcf65553d", questionWrapperId: "el_quiz_wrap" }), true);
});

test("an attempt keeps its snapshot while the question is still in it", () => {
  assert.equal(shouldRefreshAttemptSnapshot(preview, after, { questionId: "qz_q_86dc8368e729", questionWrapperId: "el_quiz_wrap" }), false);
  // Without a question id, the wrapper still resolves in the frozen snapshot.
  assert.equal(shouldRefreshAttemptSnapshot(preview, after, { questionWrapperId: "el_quiz_wrap" }), false);
  // Nothing better to move to: the latest courseware lacks the question too.
  assert.equal(shouldRefreshAttemptSnapshot(preview, before, { questionId: "qz_q_unknown", questionWrapperId: "el_other" }), false);
  assert.equal(shouldRefreshAttemptSnapshot(preview, {}, { questionWrapperId: "el_quiz_wrap" }), false);
});

test("an attempt a section grades keeps its snapshot, unless it had no quiz at all", () => {
  assert.equal(shouldRefreshAttemptSnapshot(graded, after, { questionId: "qz_q_39afcf65553d", questionWrapperId: "el_quiz_wrap" }), false);
  assert.equal(shouldRefreshAttemptSnapshot({ ...graded, coursewareSnapshot: {} }, after, { questionId: "qz_q_39afcf65553d", questionWrapperId: "el_quiz_wrap" }), true);
});
