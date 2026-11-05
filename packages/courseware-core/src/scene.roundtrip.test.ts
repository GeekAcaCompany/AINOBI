// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { deserializeScene, serializeScene, type Scene } from "./scene.ts";
import { Transitions } from "./enums/transitions.ts";
import {
  deserializeElement,
  resolveTextLineHeight,
  serializeElement,
  type Element,
  type QuizSlideElement,
  type SlideElement,
  type TextElement,
} from "./elements.ts";
import { buildDefaultQuizAst } from "./quiz-default-asts.ts";
import { createDefaultQuestion } from "./quiz.ts";
import type { QuizAstNode, QuizAstPropValue, QuizTag } from "./quiz-ast.ts";

const baseText = (id: string, text: string): TextElement => ({
  element_type: "text",
  element_id: id,
  name: `${id}-name`,
  html: "",
  fps: 30,
  position: { x: 80, y: 80 },
  size: { width: 640, height: 120 },
  timeline: { start_at: 0, end_at: 30000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 1 },
  enter_effect: "fade_in",
  exit_effect: "fade_out",
  animations: [],
  keyframes: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  metadata: {},
  text,
  font_family: "Inter",
  font_size: 36,
  color: "#FFFFFF",
  align: "left",
});

const buildSlide = (
  id: string,
  title: string,
  backgroundColor: string,
  nextActionId?: string,
): SlideElement => ({
  element_type: "slide",
  element_id: id,
  name: `${id}-slide`,
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  timeline: { start_at: 0, end_at: 30000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  enter_effect: "none",
  exit_effect: "none",
  animations: [],
  keyframes: [],
  event_bindings: nextActionId
    ? [
        {
          binding_id: `${id}-binding-next`,
          event: "click",
          action_id: nextActionId,
          script: 'runtime.scene.nextSlide();',
          external_function: null,
          enabled: true,
          once: false,
          capture: false,
          xpath: null,
          metadata: {},
        },
      ]
    : [],
  action_mappings: nextActionId ? { [nextActionId]: "nextSlide" } : {},
  event_scripts: {
    click: "runtime.scene.getCurrentPage();",
  },
  preset_script: "",
  metadata: {},
  background_color: backgroundColor,
  background_image_url: "",
  background_image_fit: "cover",
  background_html_src: "",
  children_elements: [baseText(`${id}-title`, title)],
});

// ── Quiz AST helpers ─────────────────────────────────────────────────────────
// Hand-written AST literals (instead of using `buildDefaultQuizAst`) so the
// fixture is fully deterministic and round-trips to byte-equal JSON.
const astText = (text: string): QuizAstNode => ({ kind: "text", text });
const astEl = (
  tag: QuizTag,
  props: Record<string, QuizAstPropValue> = {},
  children: QuizAstNode[] = [],
): QuizAstNode => ({ kind: "element", tag, props, children });

const choiceAst = (optionIds: string[]): QuizAstNode =>
  astEl("QuizContainer", {}, [
    astEl("QuizTitle", {}, [astText("题目")]),
    astEl(
      "QuizOptionGroup",
      {},
      optionIds.map((id, idx) =>
        astEl("QuizOption", { value: id }, [astText(String.fromCharCode(65 + idx))]),
      ),
    ),
    astEl("QuizSubmitButton", {}, [astText("提交")]),
  ]);

const fillBlankAst = (blankIds: string[]): QuizAstNode =>
  astEl("QuizContainer", {}, [
    astEl("QuizTitle", {}, [astText("填空")]),
    astEl(
      "ol",
      {},
      blankIds.map((id, idx) =>
        astEl("li", {}, [
          astEl("label", {}, [astText(`第 ${idx + 1} 空：`)]),
          astEl("QuizInput", { name: id }, []),
        ]),
      ),
    ),
    astEl("QuizSubmitButton", {}, [astText("提交")]),
  ]);

const shadowingAst = (audioUrl: string): QuizAstNode =>
  astEl("QuizContainer", {}, [
    astEl("QuizTitle", {}, [astText("跟读")]),
    astEl("QuizReferenceAudio", { src: audioUrl }, []),
    astEl("QuizShadowingControl", {}, []),
    astEl("QuizRecordingPlayback", {}, []),
    astEl("QuizSubmitButton", {}, [astText("提交")]),
  ]);

const examSceneJson: Scene = {
  scene_id: "sc_exam_demo_0001",
  name: "Exam Flow Demo (5 Pages)",
  controller: {
    play: false,
    next: true,
    back: true,
    seekBar: false,
    time: true,
    slideNumber: true,
    volume: false,
    fullScreen: true,
    brand: false,
    playbackRate: false,
  },
  transitions: [Transitions.FADE, Transitions.PUSH_LEFT, Transitions.WIPE_UP, Transitions.CROSS_FADE],
  preset_script: [
    "if (payload.action === 'start_exam') {",
    "  preset.firstSlide();",
    "}",
    "if (payload.action === 'submit_exam') {",
    "  preset.lastSlide();",
    "}",
  ].join("\n"),
  metadata: {
    scene_type: "exam",
    pass_score: 60,
    total_pages: 5,
  },
  vtuber_elements: [],
  audio_elements: [],
  slide_elements: [
    buildSlide("el_exam_page_1", "考试说明页", "#111827", "go_intro_next"),
    buildSlide("el_exam_page_2", "第一题（单选）", "#1F2937", "go_q1_next"),
    buildSlide("el_exam_page_3", "第二题（多选）", "#374151", "go_q2_next"),
    buildSlide("el_exam_page_4", "确认提交页", "#4B5563", "go_submit_next"),
    buildSlide("el_exam_page_5", "结果页", "#6B7280"),
  ],
};

const quizSceneJson: Scene = {
  scene_id: "sc_quiz_demo_0001",
  name: "Quiz Settings Demo",
  controller: {
    play: true,
    next: true,
    back: true,
    seekBar: true,
    time: true,
    slideNumber: true,
    volume: true,
    fullScreen: true,
    brand: true,
    playbackRate: true,
  },
  transitions: [],
  preset_script: "",
  metadata: {},
  vtuber_elements: [],
  audio_elements: [],
  slide_elements: [buildSlide("el_quiz_intro", "测验首页", "#0F172A")],
  quiz: {
    enabled: true,
    total_score: 100,
    score_allocation: "custom",
    time_limit_minutes: 30,
    questions: [
      {
        question_id: "qz_q_intro_single",
        type: "single_choice",
        title: "1 + 1 = ?",
        explanation: "基础数学",
        score: 20,
        required: true,
        pass_score: 20,
        advance_score: 0,
        allow_resubmit: false,
        show_feedback_score: true,
        time_limit_minutes: 1,
        content_narration_audio_url: "",
        content_narration_duration_ms: 0,
        content_narration_vtuber_element_id: "",
        react_layout: choiceAst(["qz_op_a", "qz_op_b", "qz_op_c"]),
        options: [
          { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
          { option_id: "qz_op_b", value: "qz_op_b", is_correct: true },
          { option_id: "qz_op_c", value: "qz_op_c", is_correct: false },
        ],
      },
      {
        question_id: "qz_q_multi",
        type: "multiple_choice",
        title: "下列哪些是水果？",
        explanation: "",
        score: 30,
        required: true,
        pass_score: 0,
        advance_score: 0,
        allow_resubmit: false,
        show_feedback_score: true,
        time_limit_minutes: null,
        content_narration_audio_url: "",
        content_narration_duration_ms: 0,
        content_narration_vtuber_element_id: "",
        react_layout: choiceAst(["qz_op_apple", "qz_op_banana", "qz_op_potato"]),
        grading: "partial_credit",
        options: [
          { option_id: "qz_op_apple", value: "qz_op_apple", is_correct: true },
          { option_id: "qz_op_banana", value: "qz_op_banana", is_correct: true },
          { option_id: "qz_op_potato", value: "qz_op_potato", is_correct: false },
        ],
      },
      {
        question_id: "qz_q_blank",
        type: "fill_blank",
        title: "Hello _____",
        explanation: "",
        score: 20,
        required: false,
        pass_score: 0,
        advance_score: 0,
        allow_resubmit: false,
        show_feedback_score: true,
        time_limit_minutes: null,
        content_narration_audio_url: "",
        content_narration_duration_ms: 0,
        content_narration_vtuber_element_id: "",
        react_layout: fillBlankAst(["qz_bl_1"]),
        case_sensitive: false,
        grading: "exact_match",
        grading_criteria: "",
        blanks: [
          {
            blank_id: "qz_bl_1",
            answer: "world",
            aliases: ["World"],
          },
        ],
      },
      {
        question_id: "qz_q_shadow",
        type: "shadowing",
        title: "请跟读以下句子",
        explanation: "",
        score: 30,
        required: true,
        pass_score: 18,
        advance_score: 0,
        allow_resubmit: false,
        show_feedback_score: true,
        time_limit_minutes: 2,
        content_narration_audio_url: "",
        content_narration_duration_ms: 0,
        content_narration_vtuber_element_id: "",
        react_layout: shadowingAst("https://example.com/ref.mp3"),
        reference_text: "How are you doing today?",
        reference_audio_url: "https://example.com/ref.mp3",
      },
    ],
    grade_levels: [
      { level_id: "qz_gl_a", label: "A", min_score: 90, description: "优秀" },
      { level_id: "qz_gl_b", label: "B", min_score: 75, description: "良好" },
      { level_id: "qz_gl_c", label: "C", min_score: 0, description: "继续努力" },
    ],
    score_summary: null,
  },
};

describe("courseware scene roundtrip", () => {
  it("keeps exam scene json stable after deserialize + serialize", () => {
    const parsed = deserializeScene(examSceneJson);
    const serialized = serializeScene(parsed);

    expect(serialized).toEqual(examSceneJson);
  });

  it("reads legacy quiz second limits and normalizes them to minutes", () => {
    const quiz = quizSceneJson.quiz!;
    const legacy = {
      ...quizSceneJson,
      quiz: {
        ...quiz,
        time_limit_minutes: undefined,
        time_limit_seconds: 180,
        questions: quiz.questions.map((question, index) =>
          index === 0
            ? { ...question, time_limit_minutes: undefined, time_limit_seconds: 120 }
            : { ...question, time_limit_minutes: undefined }
        ),
      },
    } as unknown as Scene;

    const parsed = deserializeScene(legacy);

    expect(parsed.quiz?.time_limit_minutes).toBe(3);
    expect(parsed.quiz?.questions[0]?.time_limit_minutes).toBe(2);
  });

  it("preserves fractional minute limits through deserialize/serialize", () => {
    const quiz = quizSceneJson.quiz!;
    const withFractions = {
      ...quizSceneJson,
      quiz: {
        ...quiz,
        time_limit_minutes: 1.5,
        questions: quiz.questions.map((question, index) =>
          index === 0
            ? { ...question, time_limit_minutes: 0.5 }
            : question
        ),
      },
    } as Scene;

    const parsed = deserializeScene(withFractions);
    const serialized = serializeScene(parsed) as {
      quiz: {
        time_limit_minutes: number;
        time_limit_seconds?: unknown;
        questions: Array<{ time_limit_minutes: number; time_limit_seconds?: unknown }>;
      };
    };

    expect(parsed.quiz?.time_limit_minutes).toBe(1.5);
    expect(parsed.quiz?.questions[0]?.time_limit_minutes).toBe(0.5);
    expect(serialized.quiz.time_limit_minutes).toBe(1.5);
    expect(serialized.quiz.questions[0]?.time_limit_minutes).toBe(0.5);
    expect("time_limit_seconds" in serialized.quiz).toBe(false);
    expect("time_limit_seconds" in serialized.quiz.questions[0]!).toBe(false);
  });

  it("keeps quiz config stable after deserialize + serialize", () => {
    const parsed = deserializeScene(quizSceneJson);
    expect(parsed.quiz?.questions.length).toBe(4);
    const reparsed = deserializeScene(serializeScene(parsed));
    expect(reparsed).toEqual(parsed);
  });

  it("omits quiz from serialized output when scene has no quiz", () => {
    const parsed = deserializeScene(examSceneJson);
    expect(parsed.quiz).toBeNull();
    const serialized = serializeScene(parsed) as Record<string, unknown>;
    expect("quiz" in serialized).toBe(false);
  });

  it("keeps text rich-text fields (bold/italic/text_background_color) stable", () => {
    const richText: TextElement = {
      ...baseText("el_text_rich", "加粗 / 斜体 / 高亮"),
      bold: true,
      italic: true,
      text_background_color: "#FACC15",
    };
    const scene: Scene = {
      ...examSceneJson,
      transitions: [],
      slide_elements: [
        {
          ...examSceneJson.slide_elements[0],
          children_elements: [richText],
        },
      ],
    };
    const parsed = deserializeScene(scene);
    const child = parsed.slide_elements[0].children_elements[0] as TextElement;
    expect(child.bold).toBe(true);
    expect(child.italic).toBe(true);
    expect(child.text_background_color).toBe("#FACC15");
    const reparsed = deserializeScene(serializeScene(parsed));
    expect(reparsed).toEqual(parsed);
  });

  it("keeps locked element state stable", () => {
    const lockedText: TextElement = {
      ...baseText("el_text_locked", "锁定元素"),
      locked: true,
    };
    const roundtripped = deserializeElement(serializeElement(lockedText)) as TextElement;
    expect(roundtripped.locked).toBe(true);
  });

  it("round-trips text line_height", () => {
    const text: TextElement = {
      ...baseText("el_text_lh", "多行\n文本"),
      line_height: 1.5,
    };
    const roundtripped = deserializeElement(serializeElement(text)) as TextElement;
    expect(roundtripped.line_height).toBe(1.5);
  });

  it("resolves omitted text line_height to the schema default", () => {
    const { line_height: _omit, ...withoutLh } = baseText("el_text_lh_def", "默认行高");
    const roundtripped = deserializeElement(serializeElement(withoutLh)) as TextElement;
    expect(resolveTextLineHeight(roundtripped.line_height)).toBe(1.2);
  });

  it("coerces missing or empty text font_family when serializing", () => {
    const { font_family: _omit, ...withoutFont } = baseText("el_text_ff_omit", "无字体");
    const legacyWithoutFont = withoutFont as Element;
    expect(() => serializeElement(legacyWithoutFont)).not.toThrow();
    expect(
      (deserializeElement(serializeElement(legacyWithoutFont)) as TextElement).font_family,
    ).toBe("Inter");

    const emptyFont = { ...baseText("el_text_ff_empty", "空字体"), font_family: "" };
    expect(() => serializeElement(emptyFont)).not.toThrow();
    expect((deserializeElement(serializeElement(emptyFont)) as TextElement).font_family).toBe(
      "Inter",
    );
  });

  it("clamps out-of-range keyframes when serializing", () => {
    const text: TextElement = {
      ...baseText("el_text_kf_oob", "关键帧越界"),
      timeline: { start_at: 1000, end_at: 5000 },
      keyframes: [
        {
          at: 0,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 40 },
          rotation_deg: 0,
          opacity: 1,
          easing: "linear",
        },
        {
          at: 9000,
          position: { x: 10, y: 10 },
          size: { width: 100, height: 40 },
          rotation_deg: 0,
          opacity: 1,
          easing: "linear",
        },
      ],
    };
    expect(() => serializeElement(text)).not.toThrow();
    const roundtripped = deserializeElement(serializeElement(text)) as TextElement;
    expect(roundtripped.keyframes.every(
      (kf) =>
        kf.at >= roundtripped.timeline.start_at &&
        kf.at <= roundtripped.timeline.end_at,
    )).toBe(true);
    expect(roundtripped.keyframes.map((kf) => kf.at)).toEqual([1000, 5000]);
  });

  it("keeps a quiz slide element stable through round-trip", () => {
    const quizEl: QuizSlideElement = {
      element_type: "quiz",
      element_id: "el_quiz_demo",
      name: "题目 · 单选题",
      html: "",
      fps: 30,
      position: { x: 240, y: 160 },
      size: { width: 1440, height: 760 },
      timeline: { start_at: 0, end_at: 30000 },
      style: { opacity: 1, rotation_deg: 0, z_index: 5 },
      enter_effect: "none",
      exit_effect: "none",
      animations: [],
      keyframes: [],
      highlight_segments: [],
      event_bindings: [],
      action_mappings: {},
      event_scripts: {},
      preset_script: "",
      metadata: {},
      quiz_question_id: "qz_q_intro_single",
    };
    const scene: Scene = {
      ...quizSceneJson,
      slide_elements: [
        {
          ...quizSceneJson.slide_elements[0],
          children_elements: [
            ...quizSceneJson.slide_elements[0].children_elements,
            quizEl,
          ],
        },
      ],
    };
    const parsed = deserializeScene(scene);
    const found = parsed.slide_elements[0].children_elements.find(
      (el: Element) => el.element_id === "el_quiz_demo",
    ) as QuizSlideElement;
    expect(found.element_type).toBe("quiz");
    expect(found.quiz_question_id).toBe("qz_q_intro_single");
    const reparsed = deserializeScene(serializeScene(parsed));
    expect(reparsed).toEqual(parsed);
  });

  it("default quiz AST is serializable for every type", () => {
    for (const kind of [
      "single_choice",
      "multiple_choice",
      "fill_blank",
      "essay",
      "shadowing",
      "speech",
    ] as const) {
      const q = createDefaultQuestion(kind, "zh");
      q.react_layout = buildDefaultQuizAst(q, "zh");
      const json = JSON.parse(JSON.stringify(q));
      expect(json.react_layout.kind).toBe("element");
      expect(json.react_layout.tag).toBe("QuizContainer");
    }
  });

  it("keeps element highlight segments stable", () => {
    const scene: Scene = {
      ...examSceneJson,
      transitions: [],
      slide_elements: [
        {
          ...examSceneJson.slide_elements[0],
          children_elements: [
            {
              ...examSceneJson.slide_elements[0].children_elements[0],
              highlight_segments: [
                {
                  highlight_id: "hl_intro_title",
                  start_at: 1000,
                  end_at: 2600,
                  padding_px: 32,
                  border_radius_px: 24,
                  overlay_color: "#000000",
                  overlay_opacity: 0.62,
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = deserializeScene(scene);
    const serialized = serializeScene(parsed);
    const reparsed = deserializeScene(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it("allows an empty scene name through serialize round-trip", () => {
    const scene = {
      scene_id: "sc_empty_name_test",
      name: "",
      controller: {
        play: true,
        next: true,
        back: true,
        seekBar: true,
        time: true,
        slideNumber: true,
        volume: true,
        fullScreen: true,
        brand: true,
        playbackRate: true,
      },
      transitions: [],
      preset_script: "",
      metadata: {},
      slide_elements: [],
      vtuber_elements: [],
      audio_elements: [],
    };

    const parsed = deserializeScene(scene);
    expect(parsed.name).toBe("");
    const serialized = serializeScene(parsed) as { name: string };
    expect(serialized.name).toBe("");
  });
});
