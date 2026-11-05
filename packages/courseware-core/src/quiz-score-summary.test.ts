// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";


import { deserializeQuizConfig, serializeQuizConfig, type QuizConfig } from "./quiz.ts";
import { deserializeScene } from "./scene.ts";
import type { SlideElement } from "./elements.ts";
import {
  computeQuizAggregateScore,
  createDefaultQuizScoreSummaryConfig,
  ensureQuizScoreSummaryConfig,
  resolveQuizGradeLevel,
  resolveQuizScoreSummaryConfigForCanvasAdd,
} from "./quiz-score-summary.ts";
import { validateQuizScoreSummaryAst } from "./quiz-score-summary-ast.ts";
import { ensureScoreSummaryAstInterpSlots } from "./quiz-score-summary-ast-interp-fill.ts";
import { buildDefaultQuizScoreSummaryAst } from "./quiz-score-summary-default-ast.ts";
import type { QuizScoreSummaryAstNode } from "./quiz-score-summary-ast.ts";

describe("resolveQuizGradeLevel", () => {
  const levels = [
    { level_id: "a", label: "A", min_score: 90, description: "优秀" },
    { level_id: "b", label: "B", min_score: 75, description: "良好" },
    { level_id: "c", label: "C", min_score: 0, description: "继续努力" },
  ];

  it("picks the highest matching band", () => {
    expect(resolveQuizGradeLevel(92, levels)?.label).toBe("A");
    expect(resolveQuizGradeLevel(80, levels)?.label).toBe("B");
    expect(resolveQuizGradeLevel(10, levels)?.label).toBe("C");
  });
});

describe("computeQuizAggregateScore", () => {
  const quiz = {
    enabled: true,
    total_score: 100,
    score_allocation: "even_split" as const,
    time_limit_minutes: null,
    questions: [
      { question_id: "q1" },
      { question_id: "q2" },
    ],
    grade_levels: [],
    score_summary: null,
  } as unknown as QuizConfig;

  const slides = [
    {
      children_elements: [
        { element_type: "quiz", element_id: "el1", quiz_question_id: "q1" },
        { element_type: "quiz", element_id: "el2", quiz_question_id: "q2" },
      ],
    },
  ] as unknown as SlideElement[];

  it("sums submitted scores and counts answered", () => {
    const snapshot = computeQuizAggregateScore(quiz, slides, {
      el1: { submitted: true, score: 40 },
      el2: { submitted: true, score: 35 },
    });
    expect(snapshot.earnedScore).toBe(75);
    expect(snapshot.answeredCount).toBe(2);
    expect(snapshot.questionCount).toBe(2);
    expect(snapshot.totalScore).toBe(100);
  });

  it("uses visible wrapper scores instead of quiz.total_score when they differ", () => {
    const partialQuiz = {
      ...quiz,
      questions: [
        { question_id: "q1", score: 40 },
        { question_id: "q2", score: 30 },
        { question_id: "q_hidden", score: 50 },
      ],
      total_score: 120,
    } as unknown as QuizConfig;
    const snapshot = computeQuizAggregateScore(partialQuiz, slides, {});
    expect(snapshot.questionCount).toBe(2);
    expect(snapshot.totalScore).toBe(70);
  });
});

describe("deserializeQuizConfig score_summary", () => {
  it("accepts legacy quiz JSON without score_summary key", () => {
    const config = deserializeQuizConfig({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      questions: [],
      grade_levels: [],
    });
    expect(config.score_summary).toBeNull();
  });

  it("deserializes full-scene content with legacy quiz lacking score_summary", () => {
    // The original vv.json was a one-off real courseware export (never committed; the path now 404s). A minimal scene +
    // a quiz without score_summary reproduces the same regression: after deserializing the whole scene the quiz survives and
    // score_summary is null (no crash and no default filled in because of the missing key).
    const quiz = {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_seconds: 90,
      questions: [
        {
          question_id: "qz_q_1",
          type: "single_choice",
          title: "1 + 1 = ?",
          explanation: "",
          score: 100,
          required: true,
          pass_score: 100,
          advance_score: 0,
          allow_resubmit: false,
          show_feedback_score: true,
          time_limit_seconds: 30,
          content_narration_audio_url: "",
          content_narration_duration_ms: 0,
          content_narration_vtuber_element_id: "",
          react_layout: {
            kind: "element",
            tag: "QuizContainer",
            props: {},
            children: [
              {
                kind: "element",
                tag: "QuizTitle",
                props: {},
                children: [{ kind: "interp", key: "title" }],
              },
              {
                kind: "element",
                tag: "QuizOptionGroup",
                props: {},
                children: [
                  {
                    kind: "element",
                    tag: "QuizOption",
                    props: { value: "qz_op_a" },
                    children: [{ kind: "text", text: "A: 1" }],
                  },
                  {
                    kind: "element",
                    tag: "QuizOption",
                    props: { value: "qz_op_b" },
                    children: [{ kind: "text", text: "B: 2" }],
                  },
                ],
              },
              {
                kind: "element",
                tag: "QuizSubmitButton",
                props: {},
                children: [{ kind: "text", text: "提交" }],
              },
            ],
          },
          options: [
            { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
            { option_id: "qz_op_b", value: "qz_op_b", is_correct: true },
          ],
        },
      ],
      grade_levels: [],
    };
    const scene = deserializeScene({
      audio_elements: [],
      scene_id: "sc_vv",
      name: "vv",
      controller: {
        play: true, next: true, back: true, seekBar: true, time: true,
        slideNumber: true, volume: true, fullScreen: true, brand: true, playbackRate: true,
      },
      transitions: [],
      preset_script: "",
      metadata: {},
      slide_elements: [
        {
          action_mappings: {},
          event_scripts: {},
          preset_script: "",
          element_type: "slide",
          element_id: "el_slide_0",
          name: "slide",
          fps: 30,
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          timeline: { start_at: 0, end_at: 5000 },
          style: { opacity: 1, rotation_deg: 0, z_index: 0 },
          enter_effect: "none",
          exit_effect: "none",
          animations: [],
          keyframes: [],
          event_bindings: [],
          metadata: {},
          background_color: "#000",
          children_elements: [],
        },
      ],
      vtuber_elements: [],
      quiz,
    } as never);
    expect(scene.quiz).not.toBeNull();
    expect(scene.quiz?.score_summary).toBeNull();
  });
  it("accepts incoming time_limit_seconds and normalizes to minutes", () => {
    const config = deserializeQuizConfig({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_seconds: 90,
      questions: [
        {
          question_id: "qz_q_1",
          type: "single_choice",
          title: "1 + 1 = ?",
          explanation: "",
          score: 100,
          required: true,
          pass_score: 100,
          advance_score: 0,
          allow_resubmit: false,
          show_feedback_score: true,
          time_limit_seconds: 30,
          content_narration_audio_url: "",
          content_narration_duration_ms: 0,
          content_narration_vtuber_element_id: "",
          react_layout: {
            kind: "element",
            tag: "QuizContainer",
            props: {},
            children: [
              {
                kind: "element",
                tag: "QuizTitle",
                props: {},
                children: [{ kind: "interp", key: "title" }],
              },
              {
                kind: "element",
                tag: "QuizOptionGroup",
                props: {},
                children: [
                  {
                    kind: "element",
                    tag: "QuizOption",
                    props: { value: "qz_op_a" },
                    children: [{ kind: "text", text: "A: 1" }],
                  },
                  {
                    kind: "element",
                    tag: "QuizOption",
                    props: { value: "qz_op_b" },
                    children: [{ kind: "text", text: "B: 2" }],
                  },
                ],
              },
              {
                kind: "element",
                tag: "QuizSubmitButton",
                props: {},
                children: [{ kind: "text", text: "提交" }],
              },
            ],
          },
          options: [
            { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
            { option_id: "qz_op_b", value: "qz_op_b", is_correct: true },
          ],
        },
      ],
      grade_levels: [],
    });

    expect(config.time_limit_minutes).toBe(1.5);
    expect(config.questions[0]?.time_limit_minutes).toBe(0.5);
  });
  it("serializes fractional minute values as time_limit_minutes (no seconds field)", () => {
    const serialized = serializeQuizConfig({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: 1.5,
      questions: [
        {
          question_id: "qz_q_1",
          type: "single_choice",
          title: "1 + 1 = ?",
          explanation: "",
          score: 100,
          required: true,
          pass_score: 100,
          advance_score: 0,
          allow_resubmit: false,
          show_feedback_score: true,
          time_limit_minutes: 0.5,
          content_narration_audio_url: "",
          content_narration_duration_ms: 0,
          content_narration_vtuber_element_id: "",
          react_layout: {
            kind: "element",
            tag: "QuizContainer",
            props: {},
            children: [
              {
                kind: "element",
                tag: "QuizTitle",
                props: {},
                children: [{ kind: "interp", key: "title" }],
              },
              {
                kind: "element",
                tag: "QuizOptionGroup",
                props: {},
                children: [
                  {
                    kind: "element",
                    tag: "QuizOption",
                    props: { value: "qz_op_a" },
                    children: [{ kind: "text", text: "A: 1" }],
                  },
                  {
                    kind: "element",
                    tag: "QuizOption",
                    props: { value: "qz_op_b" },
                    children: [{ kind: "text", text: "B: 2" }],
                  },
                ],
              },
              {
                kind: "element",
                tag: "QuizSubmitButton",
                props: {},
                children: [{ kind: "text", text: "提交" }],
              },
            ],
          },
          options: [
            { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
            { option_id: "qz_op_b", value: "qz_op_b", is_correct: true },
          ],
        },
      ],
      grade_levels: [],
      score_summary: null,
    }) as {
      time_limit_minutes: number | null;
      time_limit_seconds?: number;
      questions: Array<{
        time_limit_minutes: number | null;
        time_limit_seconds?: number;
      }>;
    };

    expect(serialized.time_limit_minutes).toBe(1.5);
    expect(serialized.questions[0]?.time_limit_minutes).toBe(0.5);
    expect("time_limit_seconds" in serialized).toBe(false);
    expect("time_limit_seconds" in serialized.questions[0]!).toBe(false);
  });

});

describe("ensureQuizScoreSummaryConfig", () => {
  it("keeps customized layouts intact", () => {
    const custom: QuizScoreSummaryAstNode = {
      kind: "element",
      tag: "QuizScoreSummaryContainer",
      props: {},
      children: [{ kind: "text", text: "我的自定义汇总" }],
    };
    const ensured = ensureQuizScoreSummaryConfig({ react_layout: custom }, "en");
    expect(ensured.react_layout).toEqual(custom);
  });

  it("creates default when missing", () => {
    expect(ensureQuizScoreSummaryConfig(null, "en")).toEqual(createDefaultQuizScoreSummaryConfig("en"));
  });
});

describe("resolveQuizScoreSummaryConfigForCanvasAdd", () => {
  const collectText = (node: QuizScoreSummaryAstNode): string[] => {
    if (node.kind === "text") return [node.text];
    if (node.kind === "interp") return [];
    return node.children.flatMap(collectText);
  };

  const legacyConfig = {
    react_layout: {
      kind: "element" as const,
      tag: "QuizScoreSummaryContainer" as const,
      props: {},
      children: [{ kind: "text" as const, text: "测验成绩汇总" }],
    },
  };

  const customConfig = {
    react_layout: {
      kind: "element" as const,
      tag: "QuizScoreSummaryContainer" as const,
      props: {},
      children: [{ kind: "text" as const, text: "我的自定义汇总" }],
    },
  };

  const emptySlides = [{ children_elements: [] }] as unknown as SlideElement[];
  const slidesWithSummary = [
    {
      children_elements: [{ element_type: "quiz_score_summary", element_id: "sum1" }],
    },
  ] as unknown as SlideElement[];

  it("seeds latest built-in default when canvas has no score summary element", () => {
    // The resolver builds the default AST in the UI language the caller passes (production passes the current language, default en).
    const resolved = resolveQuizScoreSummaryConfigForCanvasAdd(legacyConfig, emptySlides, "zh");
    const texts = collectText(resolved.react_layout);
    expect(texts).toContain("测验成绩");
    expect(texts).not.toContain("测验成绩汇总");
  });

  it("keeps shared layout when canvas already has a score summary element", () => {
    expect(resolveQuizScoreSummaryConfigForCanvasAdd(customConfig, slidesWithSummary)).toEqual(
      customConfig,
    );
    expect(resolveQuizScoreSummaryConfigForCanvasAdd(legacyConfig, slidesWithSummary)).toEqual(
      legacyConfig,
    );
  });
});

describe("buildDefaultQuizScoreSummaryAst", () => {
  it("passes AST validation", () => {
    const ast = buildDefaultQuizScoreSummaryAst("en");
    expect(validateQuizScoreSummaryAst(ast)).toEqual([]);
  });

  it("builds localized default text", () => {
    const ast = buildDefaultQuizScoreSummaryAst("en");
    const text = JSON.stringify(ast);
    expect(text).toContain("Quiz Results");
    expect(text).toContain("Score");
    expect(text).toContain("Grade");
    expect(text).toContain(" question(s)");
  });
});

describe("ensureScoreSummaryAstInterpSlots", () => {
  it("injects grade interp into self-closing grade components", () => {
    const ast = {
      kind: "element" as const,
      tag: "QuizScoreSummaryContainer" as const,
      props: { style: { width: "100%", height: "100%" } },
      children: [
        {
          kind: "element" as const,
          tag: "QuizGradeLabel" as const,
          props: {},
          children: [],
        },
        {
          kind: "element" as const,
          tag: "QuizGradeDescription" as const,
          props: {},
          children: [],
        },
      ],
    };
    const { ast: fixed, layout_interp_fixes } = ensureScoreSummaryAstInterpSlots(ast);
    expect(layout_interp_fixes).toHaveLength(2);
    expect(fixed.kind).toBe("element");
    if (fixed.kind !== "element") return;
    expect(fixed.children[0]?.kind).toBe("element");
    const gradeLabel = fixed.children[0];
    const gradeDescription = fixed.children[1];
    if (gradeLabel?.kind === "element") {
      expect(gradeLabel.children[0]).toEqual({ kind: "interp", key: "grade_label" });
    }
    if (gradeDescription?.kind === "element") {
      expect(gradeDescription.children[0]).toEqual({ kind: "interp", key: "grade_description" });
    }
  });
});
