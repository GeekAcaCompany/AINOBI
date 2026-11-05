// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { cloneSlideWithNewIds } from "./clone-slide.ts";
import {
  importReferenceSlidesIntoScene,
  parseReferenceSlideSelection,
} from "./reference-import.ts";

test("parseReferenceSlideSelection supports all, indices, and ranges", () => {
  assert.deepEqual(parseReferenceSlideSelection("all", 4), [0, 1, 2, 3]);
  assert.deepEqual(parseReferenceSlideSelection("0,2", 5), [0, 2]);
  assert.deepEqual(parseReferenceSlideSelection("1-3", 5), [1, 2, 3]);
  assert.deepEqual(parseReferenceSlideSelection("0,2-3,4", 5), [0, 2, 3, 4]);
  assert.deepEqual(parseReferenceSlideSelection("3-1", 5), [1, 2, 3]);
});

test("parseReferenceSlideSelection resolves element_id via callback", () => {
  const indices = parseReferenceSlideSelection("el_slide_a,1", 3, (ref) =>
    ref === "el_slide_a" ? 0 : null,
  );
  assert.deepEqual(indices, [0, 1]);
});

test("cloneSlideWithNewIds regenerates element ids and remaps vtuber refs", () => {
  const slide = {
    element_id: "el_slide_old",
    element_type: "slide",
    name: "封面",
    flow_pause_points: [{ pause_id: "pause_old", at_ms: 1000 }],
    children_elements: [
      {
        element_id: "el_text_old",
        element_type: "text",
        text: "Hello",
        vtuber_element_id: "el_vt_old",
      },
      {
        element_id: "el_vt_old",
        element_type: "vtuber",
      },
    ],
  };
  const { slide: cloned, idMap } = cloneSlideWithNewIds(slide);
  assert.notEqual(cloned.element_id, "el_slide_old");
  assert.ok(idMap.has("el_slide_old"));
  const children = cloned.children_elements as Record<string, unknown>[];
  assert.notEqual(children[0]?.element_id, "el_text_old");
  assert.equal(children[0]?.vtuber_element_id, children[1]?.element_id);
  const pauses = cloned.flow_pause_points as Array<{ pause_id: string }>;
  assert.notEqual(pauses[0]?.pause_id, "pause_old");
});

test("importReferenceSlidesIntoScene keeps total_score and rescales proportionally", () => {
  const referenceScene = {
    slide_elements: [
      {
        element_id: "el_slide_ref0",
        element_type: "slide",
        name: "测验页",
        children_elements: [
          {
            element_id: "el_vt_ref",
            element_type: "vtuber",
          },
          {
            element_id: "el_quiz_ref",
            element_type: "quiz",
            quiz_question_id: "q_ref_1",
          },
        ],
      },
      {
        element_id: "el_slide_ref1",
        element_type: "slide",
        name: "普通页",
        children_elements: [
          {
            element_id: "el_text_ref",
            element_type: "text",
            text: "Hi",
          },
        ],
      },
    ],
    quiz: {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      questions: [
        {
          question_id: "q_ref_1",
          type: "single_choice",
          title: "2+2?",
          score: 40,
          pass_score: 40,
          advance_score: 40,
          content_narration_vtuber_element_id: "el_vt_ref",
          options: [
            { option_id: "opt_a", value: "A", label: "4", is_correct: true },
            { option_id: "opt_b", value: "B", label: "5", is_correct: false },
          ],
          react_layout: {
            kind: "element",
            type: "QuizContainer",
            props: {},
            children: [],
          },
        },
      ],
      grade_levels: [],
      score_summary: null,
    },
  };

  const targetScene: Record<string, unknown> = {
    slide_elements: [
      {
        element_id: "el_slide_cur",
        element_type: "slide",
        name: "已有页",
        children_elements: [],
      },
    ],
    transitions: ["fade"],
    quiz: {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      questions: [
        {
          question_id: "q_existing",
          type: "single_choice",
          title: "existing",
          score: 100,
          pass_score: 100,
          advance_score: 100,
          options: [],
          react_layout: {
            kind: "element",
            type: "QuizContainer",
            props: {},
            children: [],
          },
        },
      ],
      grade_levels: [],
      score_summary: null,
    },
  };

  const result = importReferenceSlidesIntoScene({
    targetScene,
    referenceScene,
    sourcePath: "./reference/demo.scene.json",
    slideIndices: [0, 1],
  });

  assert.equal(result.imported_count, 2);
  assert.equal(result.quiz_questions_imported, 1);
  assert.equal(result.quiz_total_score, 100);
  assert.equal(result.inserted_at_start, 1);
  const slides = targetScene.slide_elements as Record<string, unknown>[];
  assert.equal(slides.length, 3);
  assert.equal(slides[0]?.element_id, "el_slide_cur");
  assert.notEqual(slides[1]?.element_id, "el_slide_ref0");

  const quizChild = (slides[1]!.children_elements as Record<string, unknown>[]).find(
    (el) => el.element_type === "quiz",
  )!;
  assert.notEqual(quizChild.quiz_question_id, "q_ref_1");

  const vtuberChild = (slides[1]!.children_elements as Record<string, unknown>[]).find(
    (el) => el.element_type === "vtuber",
  )!;

  const quiz = targetScene.quiz as {
    total_score: number;
    score_allocation: string;
    questions: Array<{
      question_id: string;
      title: string;
      score: number;
      pass_score: number;
      content_narration_vtuber_element_id?: string;
    }>;
  };
  assert.equal(quiz.questions.length, 2);
  assert.equal(quiz.questions[0]?.question_id, "q_existing");
  assert.equal(quiz.questions[1]?.title, "2+2?");
  assert.equal(quiz.questions[1]?.question_id, quizChild.quiz_question_id);
  assert.equal(quiz.questions[1]?.content_narration_vtuber_element_id, vtuberChild.element_id);
  // Keep target total_score=100; weights 100:40 → ~71:29
  assert.equal(quiz.total_score, 100);
  assert.deepEqual(
    quiz.questions.map((q) => q.score),
    [71, 29],
  );
  assert.equal(
    quiz.questions.reduce((sum, q) => sum + q.score, 0),
    100,
  );
  assert.deepEqual(
    result.quiz_question_scores?.map((row) => [row.score_before, row.score]),
    [
      [100, 71],
      [40, 29],
    ],
  );

  assert.deepEqual(targetScene.transitions, ["fade", "none"]);
});

test("importReferenceSlidesIntoScene equal weights become half on 100-pt quiz", () => {
  const referenceScene = {
    slide_elements: [
      {
        element_id: "el_slide_ref",
        element_type: "slide",
        name: "测验页",
        children_elements: [
          {
            element_id: "el_quiz_ref",
            element_type: "quiz",
            quiz_question_id: "q_ref",
          },
        ],
      },
    ],
    quiz: {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      questions: [
        {
          question_id: "q_ref",
          type: "single_choice",
          title: "imported",
          score: 100,
          pass_score: 100,
          advance_score: 100,
          options: [],
          react_layout: {
            kind: "element",
            type: "QuizContainer",
            props: {},
            children: [],
          },
        },
      ],
      grade_levels: [],
      score_summary: null,
    },
  };
  const targetScene: Record<string, unknown> = {
    slide_elements: [
      {
        element_id: "el_slide_cur",
        element_type: "slide",
        name: "已有测验页",
        children_elements: [
          {
            element_id: "el_quiz_cur",
            element_type: "quiz",
            quiz_question_id: "q_existing",
          },
        ],
      },
    ],
    transitions: [],
    quiz: {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      questions: [
        {
          question_id: "q_existing",
          type: "single_choice",
          title: "existing",
          score: 100,
          pass_score: 100,
          advance_score: 100,
          options: [],
          react_layout: {
            kind: "element",
            type: "QuizContainer",
            props: {},
            children: [],
          },
        },
      ],
      grade_levels: [],
      score_summary: null,
    },
  };

  const result = importReferenceSlidesIntoScene({
    targetScene,
    referenceScene,
    sourcePath: "./reference/demo.scene.json",
    slideIndices: [0],
  });

  assert.equal(result.quiz_questions_imported, 1);
  assert.equal(result.quiz_total_score, 100);
  const quiz = targetScene.quiz as {
    total_score: number;
    questions: Array<{ score: number; pass_score: number }>;
  };
  assert.equal(quiz.total_score, 100);
  assert.deepEqual(
    quiz.questions.map((q) => q.score),
    [50, 50],
  );
  assert.deepEqual(
    quiz.questions.map((q) => q.pass_score),
    [50, 50],
  );
});

test("importReferenceSlidesIntoScene preserves multi-question score ratios", () => {
  const referenceScene = {
    slide_elements: [
      {
        element_id: "el_slide_ref",
        element_type: "slide",
        name: "测验页",
        children_elements: [
          {
            element_id: "el_quiz_ref",
            element_type: "quiz",
            quiz_question_id: "q_ref",
          },
        ],
      },
    ],
    quiz: {
      enabled: true,
      total_score: 100,
      score_allocation: "custom",
      questions: [
        {
          question_id: "q_ref",
          type: "single_choice",
          title: "imported",
          score: 100,
          pass_score: 100,
          advance_score: 100,
          options: [],
          react_layout: {
            kind: "element",
            type: "QuizContainer",
            props: {},
            children: [],
          },
        },
      ],
      grade_levels: [],
      score_summary: null,
    },
  };
  const targetScene: Record<string, unknown> = {
    slide_elements: [
      {
        element_id: "el_slide_cur",
        element_type: "slide",
        name: "已有测验页",
        children_elements: [],
      },
    ],
    transitions: [],
    quiz: {
      enabled: true,
      total_score: 100,
      score_allocation: "custom",
      questions: [
        {
          question_id: "q_a",
          type: "single_choice",
          title: "A",
          score: 60,
          pass_score: 60,
          advance_score: 60,
          options: [],
          react_layout: {
            kind: "element",
            type: "QuizContainer",
            props: {},
            children: [],
          },
        },
        {
          question_id: "q_b",
          type: "single_choice",
          title: "B",
          score: 40,
          pass_score: 40,
          advance_score: 40,
          options: [],
          react_layout: {
            kind: "element",
            type: "QuizContainer",
            props: {},
            children: [],
          },
        },
      ],
      grade_levels: [],
      score_summary: null,
    },
  };

  importReferenceSlidesIntoScene({
    targetScene,
    referenceScene,
    sourcePath: "./reference/demo.scene.json",
    slideIndices: [0],
  });

  const quiz = targetScene.quiz as {
    total_score: number;
    questions: Array<{ question_id: string; score: number }>;
  };
  // weights 60:40:100 → 30:20:50 on total 100
  assert.equal(quiz.total_score, 100);
  assert.deepEqual(
    quiz.questions.map((q) => [q.question_id, q.score]),
    [
      ["q_a", 30],
      ["q_b", 20],
      [quiz.questions[2]!.question_id, 50],
    ],
  );
});

test("importReferenceSlidesIntoScene --at inserts at position", () => {
  const referenceScene = {
    slide_elements: [
      {
        element_id: "el_slide_ref",
        element_type: "slide",
        name: "导入页",
        children_elements: [],
      },
    ],
  };
  const targetScene: Record<string, unknown> = {
    slide_elements: [
      { element_id: "a", element_type: "slide", name: "A", children_elements: [] },
      { element_id: "b", element_type: "slide", name: "B", children_elements: [] },
    ],
    transitions: ["fade"],
  };
  const result = importReferenceSlidesIntoScene({
    targetScene,
    referenceScene,
    sourcePath: "./reference/demo.scene.json",
    slideIndices: [0],
    at: 1,
  });
  assert.equal(result.inserted_at_start, 1);
  const slides = targetScene.slide_elements as Array<{ name: string }>;
  assert.deepEqual(
    slides.map((s) => s.name),
    ["A", "导入页", "B"],
  );
  assert.deepEqual(targetScene.transitions, ["fade", "none"]);
});
