// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import type { Element, GroupElement, QuizSlideElement, SlideElement } from "./elements.ts";
import type { QuizConfig } from "./quiz.ts";
import {
  buildTopLevelQuizWrapperIndex,
  canCompleteQuizHomework,
  collectRequiredQuizWrapperIds,
  collectTopLevelQuizWrappers,
  countQuizQuestionsExpectedForCompletion,
  countTopLevelBoundQuizWrappers,
  findTopLevelQuizWrapper,
  getLastQuizConfigQuestionId,
  isLastQuizConfigQuestion,
  isLastQuizConfigWrapperSubmitted,
  hasPlayableContentAfterQuizWrapper,
  isNextBoundQuizOnSameSlide,
  sumTopLevelBoundQuizMaxScore,
} from "./quiz-preview-wrappers.ts";

describe("collectTopLevelQuizWrappers", () => {
  const topLevelQuiz = (id: string, questionId: string): QuizSlideElement =>
    ({
      element_type: "quiz",
      element_id: id,
      quiz_question_id: questionId,
    }) as QuizSlideElement;

  it("ignores quizzes nested under group/html containers", () => {
    const nestedRequired = topLevelQuiz("nested_wrap", "q_nested");
    const group: GroupElement = {
      element_type: "group",
      element_id: "group1",
      children_elements: [nestedRequired],
    } as GroupElement;
    const slides = [
      {
        children_elements: [topLevelQuiz("wrap1", "q1"), group],
      },
    ] as SlideElement[];

    expect([...collectTopLevelQuizWrappers(slides).keys()]).toEqual(["wrap1"]);
  });

  it("findTopLevelQuizWrapper reuses a prebuilt index", () => {
    const slides = [
      {
        element_id: "slide1",
        children_elements: [
          { element_type: "quiz", element_id: "wrap1", quiz_question_id: "q1" },
        ],
      },
    ] as SlideElement[];
    const index = buildTopLevelQuizWrapperIndex(slides);
    expect(findTopLevelQuizWrapper(slides, "wrap1", index)?.quizEl.element_id).toBe("wrap1");
    expect(findTopLevelQuizWrapper(slides, "missing", index)).toBeNull();
  });
});

describe("collectRequiredQuizWrapperIds", () => {
  const quiz = {
    questions: [
      { question_id: "q1", required: true },
      { question_id: "q2", required: false },
      { question_id: "q_nested", required: true },
    ],
  } as QuizConfig;

  const topLevelQuiz = (id: string, questionId: string): QuizSlideElement =>
    ({
      element_type: "quiz",
      element_id: id,
      quiz_question_id: questionId,
    }) as QuizSlideElement;

  it("collects only top-level required quiz wrappers", () => {
    const nestedRequired = topLevelQuiz("nested_wrap", "q_nested");
    const group: GroupElement = {
      element_type: "group",
      element_id: "group1",
      children_elements: [nestedRequired],
    } as GroupElement;
    const slides = [
      {
        children_elements: [topLevelQuiz("wrap1", "q1"), group, topLevelQuiz("wrap2", "q2")],
      },
    ] as SlideElement[];

    expect(collectRequiredQuizWrapperIds(quiz, slides)).toEqual(["wrap1"]);
  });

  it("ignores unbound top-level quiz wrappers", () => {
    const slides = [
      {
        children_elements: [topLevelQuiz("orphan", "missing_question")],
      },
    ] as SlideElement[];

    expect(collectRequiredQuizWrapperIds(quiz, slides)).toEqual([]);
  });
});

describe("countTopLevelBoundQuizWrappers", () => {
  const quiz = {
    questions: [
      { question_id: "q1", score: 40 },
      { question_id: "q2", score: 30 },
      { question_id: "q3", score: 30 },
    ],
  } as QuizConfig;

  it("counts only bound top-level wrappers on slides", () => {
    const slides = [
      {
        children_elements: [
          { element_type: "quiz", element_id: "w1", quiz_question_id: "q1" },
          { element_type: "quiz", element_id: "w2", quiz_question_id: "q2" },
        ],
      },
    ] as SlideElement[];

    expect(countTopLevelBoundQuizWrappers(quiz, slides)).toBe(2);
  });
});

describe("sumTopLevelBoundQuizMaxScore", () => {
  const quiz = {
    questions: [
      { question_id: "q1", score: 40 },
      { question_id: "q2", score: 30 },
      { question_id: "q_hidden", score: 50 },
    ],
    total_score: 120,
  } as QuizConfig;

  it("sums only visible top-level bound question scores", () => {
    const slides = [
      {
        children_elements: [
          { element_type: "quiz", element_id: "w1", quiz_question_id: "q1" },
          { element_type: "quiz", element_id: "w2", quiz_question_id: "q2" },
        ],
      },
    ] as SlideElement[];

    expect(sumTopLevelBoundQuizMaxScore(quiz, slides)).toBe(70);
  });
});

describe("last quiz config question helpers", () => {
  const quiz = {
    enabled: true,
    questions: [
      { question_id: "q1", required: true },
      { question_id: "q2", required: true },
      { question_id: "q3", required: true },
    ],
  } as QuizConfig;

  const slides = [
    {
      children_elements: [
        { element_type: "quiz", element_id: "w1", quiz_question_id: "q1" },
        { element_type: "quiz", element_id: "w3", quiz_question_id: "q3" },
      ],
    },
  ] as SlideElement[];

  it("identifies the last configured question id", () => {
    expect(getLastQuizConfigQuestionId(quiz)).toBe("q3");
    expect(isLastQuizConfigQuestion(quiz, "q3")).toBe(true);
    expect(isLastQuizConfigQuestion(quiz, "q1")).toBe(false);
    expect(
      isLastQuizConfigWrapperSubmitted(quiz, slides, {
        w1: { submitted: true },
        w3: { submitted: false },
      }),
    ).toBe(false);
    expect(
      isLastQuizConfigWrapperSubmitted(quiz, slides, {
        w1: { submitted: true },
        w3: { submitted: true },
      }),
    ).toBe(true);
  });
});

describe("countQuizQuestionsExpectedForCompletion", () => {
  const quiz = {
    enabled: true,
    questions: [
      { question_id: "q1", required: true, score: 34 },
      { question_id: "q2", required: true, score: 34 },
      { question_id: "q3", required: true, score: 34 },
    ],
  } as QuizConfig;

  it("uses quiz config length when fewer wrappers are bound on canvas", () => {
    const slides = [
      {
        children_elements: [
          { element_type: "quiz", element_id: "w1", quiz_question_id: "q1" },
        ],
      },
    ] as SlideElement[];

    expect(countQuizQuestionsExpectedForCompletion(quiz, slides)).toBe(3);
  });
});

describe("canCompleteQuizHomework", () => {
  const quiz = {
    enabled: true,
    questions: [
      { question_id: "q1", required: true },
      { question_id: "q2", required: true },
      { question_id: "q3", required: true },
    ],
  } as QuizConfig;

  const partialSlides = [
    {
      children_elements: [
        { element_type: "quiz", element_id: "w1", quiz_question_id: "q1" },
      ],
    },
  ] as SlideElement[];

  const fullSlides = [
    {
      children_elements: [
        { element_type: "quiz", element_id: "w1", quiz_question_id: "q1" },
        { element_type: "quiz", element_id: "w2", quiz_question_id: "q2" },
        { element_type: "quiz", element_id: "w3", quiz_question_id: "q3" },
      ],
    },
  ] as SlideElement[];

  it("returns false after only the first question is submitted", () => {
    expect(
      canCompleteQuizHomework(quiz, partialSlides, {
        w1: { submitted: true },
      }),
    ).toBe(false);
  });

  it("returns true when every configured question wrapper is submitted", () => {
    expect(
      canCompleteQuizHomework(quiz, fullSlides, {
        w1: { submitted: true },
        w2: { submitted: true },
        w3: { submitted: true },
      }),
    ).toBe(true);
  });
});

describe("hasPlayableContentAfterQuizWrapper", () => {
  const quiz = {
    enabled: true,
    questions: [{ question_id: "q1" }, { question_id: "q2" }],
  } as QuizConfig;

  const slide = (children: SlideElement["children_elements"]): SlideElement =>
    ({
      element_id: "slide1",
      timeline: { start_at: 0, end_at: 10_000 },
      children_elements: children,
    }) as SlideElement;

  const quizEl = (
    id: string,
    questionId: string,
    startAt: number,
    endAt: number,
  ): QuizSlideElement =>
    ({
      element_type: "quiz",
      element_id: id,
      quiz_question_id: questionId,
      timeline: { start_at: startAt, end_at: endAt },
      style: { z_index: 1 },
    }) as QuizSlideElement;

  const textEl = (id: string, startAt: number, endAt: number): Element =>
    ({
      element_type: "text",
      element_id: id,
      timeline: { start_at: startAt, end_at: endAt },
    }) as Element;

  it("returns false when quiz ends at slide end with no other elements", () => {
    const slides = [
      slide([quizEl("wrap1", "q1", 0, 10_000)]),
    ];
    expect(hasPlayableContentAfterQuizWrapper(quiz, slides, "wrap1")).toBe(false);
  });

  it("returns true when another element plays after quiz end", () => {
    const slides = [
      slide([
        quizEl("wrap1", "q1", 0, 5_000),
        textEl("text1", 5_000, 10_000),
      ]),
    ];
    expect(hasPlayableContentAfterQuizWrapper(quiz, slides, "wrap1")).toBe(true);
  });

  it("returns false when only the next quiz on the same slide follows", () => {
    const slides = [
      slide([
        quizEl("wrap1", "q1", 0, 5_000),
        quizEl("wrap2", "q2", 5_000, 10_000),
      ]),
    ];
    expect(hasPlayableContentAfterQuizWrapper(quiz, slides, "wrap1")).toBe(false);
  });
});

describe("isNextBoundQuizOnSameSlide", () => {
  const quiz = {
    enabled: true,
    questions: [{ question_id: "q1" }, { question_id: "q2" }],
  } as QuizConfig;

  const slide = (id: string, children: SlideElement["children_elements"]): SlideElement =>
    ({
      element_id: id,
      timeline: { start_at: 0, end_at: 10_000 },
      children_elements: children,
    }) as SlideElement;

  const quizEl = (id: string, questionId: string): QuizSlideElement =>
    ({
      element_type: "quiz",
      element_id: id,
      quiz_question_id: questionId,
      timeline: { start_at: 0, end_at: 10_000 },
    }) as QuizSlideElement;

  it("returns true when the next bound quiz is on the same slide", () => {
    const slides = [
      slide("s1", [quizEl("wrap1", "q1"), quizEl("wrap2", "q2")]),
    ];
    expect(isNextBoundQuizOnSameSlide(quiz, slides, "wrap1")).toBe(true);
  });

  it("returns false when the next bound quiz is on a later slide", () => {
    const slides = [
      slide("s1", [quizEl("wrap1", "q1")]),
      slide("s2", []),
      slide("s3", [quizEl("wrap2", "q2")]),
    ];
    expect(isNextBoundQuizOnSameSlide(quiz, slides, "wrap1")).toBe(false);
  });
});
