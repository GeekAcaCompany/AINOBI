// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import type {
  QuizEssayQuestion,
  QuizFillBlankQuestion,
  QuizShadowingQuestion,
  QuizSingleChoiceQuestion,
} from "@ainobi/courseware-core/quiz.ts";
import type { QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";

import { QuizRenderer } from "./QuizRenderer.tsx";

const baseFields = {
  explanation: "因为基础数学。",
  score: 10,
  required: true,
  pass_score: 0,
  advance_score: 0,
  allow_resubmit: false,
  show_feedback_score: true,
  time_limit_minutes: null,
  content_narration_audio_url: "",
  content_narration_duration_ms: 0,
  content_narration_vtuber_element_id: "",
};

const astEl = (
  tag: string,
  props: Record<string, unknown> = {},
  children: QuizAstNode[] = [],
): QuizAstNode => ({ kind: "element", tag: tag as never, props: props as never, children });
const astText = (text: string): QuizAstNode => ({ kind: "text", text });
const astInterp = (key: string): QuizAstNode => ({ kind: "interp", key: key as never });

const singleChoiceLayout: QuizAstNode = astEl(
  "QuizContainer",
  { padding: 24, gap: 12, className: "quiz-root", style: { color: "#fff" } },
  [
    astEl("QuizTitle", {}, [astInterp("title")]),
    astEl("QuizOptionGroup", {}, [
      astEl("QuizOption", { value: "qz_op_a" }, [astText("A: 1")]),
      astEl("QuizOption", { value: "qz_op_b" }, [astText("B: 2")]),
      astEl("QuizOption", { value: "qz_op_c" }, [astText("C: 3")]),
    ]),
    astEl("QuizSubmitButton", {}, [astText("提交")]),
    astEl("QuizExplanation", {}, [
      astEl("p", {}, [astInterp("explanation")]),
    ]),
  ],
);

const singleChoiceQuestion: QuizSingleChoiceQuestion = {
  ...baseFields,
  question_id: "qz_q_1",
  type: "single_choice",
  title: "1 + 1 = ?",
  react_layout: singleChoiceLayout,
  options: [
    { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
    { option_id: "qz_op_b", value: "qz_op_b", is_correct: true },
    { option_id: "qz_op_c", value: "qz_op_c", is_correct: false },
  ],
};

const fillBlankLayout: QuizAstNode = astEl("QuizContainer", {}, [
  astEl("QuizTitle", {}, [
    astText("地球是第 "),
    astEl("QuizInput", { name: "qz_bl_1", inline: true }, []),
    astText(" 颗行星。"),
  ]),
  astEl("QuizSubmitButton", {}, [astText("提交")]),
]);

const fillBlankQuestion: QuizFillBlankQuestion = {
  ...baseFields,
  question_id: "qz_q_blank",
  type: "fill_blank",
  title: "地球是第 ___ 颗行星。",
  react_layout: fillBlankLayout,
  case_sensitive: false,
  grading: "exact_match",
  grading_criteria: "",
  blanks: [{ blank_id: "qz_bl_1", answer: "world", aliases: [] }],
};

describe("QuizRenderer", () => {
  it("renders the root container with merged className / padding / gap / style", () => {
    render(
      <QuizRenderer
        question={singleChoiceQuestion}
        containerClassName="extra"
        containerStyle={{ fontSize: 18 }}
      />,
    );
    const form = screen.getByRole("button", { name: "A: 1" }).closest("form")!;
    expect(form).toHaveClass("extra", "quiz-root");
    expect(form.style.padding).toBe("24px");
    expect(form.style.gap).toBe("12px");
    expect(form.style.color).toBe("rgb(255, 255, 255)");
    expect(form.style.fontSize).toBe("18px");
  });

  it("preserves newlines in {$title} inside QuizTitle", () => {
    const essayQuestion: QuizEssayQuestion = {
      ...baseFields,
      question_id: "qz_q_essay_nl",
      type: "essay",
      title: "测试\n\n题目",
      reference_answer: "",
      keywords: [],
      grading_criteria: "",
      react_layout: astEl("QuizContainer", {}, [
        astEl("QuizTitle", {}, [astInterp("title")]),
        astEl("QuizTextarea", { name: "answer", placeholder: "写下你的回答…" }, []),
        astEl("QuizSubmitButton", {}, [astText("提交")]),
      ]),
    };
    render(<QuizRenderer question={essayQuestion} />);
    const titleSlot = document.querySelector('[data-quiz-slot="title"]') as HTMLElement;
    expect(titleSlot.style.whiteSpace).toBe("pre-line");
    expect(titleSlot.textContent).toBe("测试\n\n题目");
  });

  it("does not render {$reference_text} for shadowing questions", () => {
    const shadowingQuestion: QuizShadowingQuestion = {
      ...baseFields,
      question_id: "qz_q_shadow",
      type: "shadowing",
      title: "请跟读题干",
      reference_text: "不应展示的参考文本",
      reference_audio_url: "",
      react_layout: astEl("QuizContainer", {}, [
        astEl("QuizTitle", {}, [astInterp("title")]),
        astEl("p", {}, [astInterp("reference_text")]),
        astEl("QuizSubmitButton", {}, [astText("提交")]),
      ]),
    };
    render(<QuizRenderer question={shadowingQuestion} />);
    expect(screen.getByText("请跟读题干")).toBeInTheDocument();
    expect(screen.queryByText("不应展示的参考文本")).toBeNull();
  });

  it("substitutes the {$title} interpolation node before submission", () => {
    render(<QuizRenderer question={singleChoiceQuestion} />);
    expect(screen.getByText("1 + 1 = ?")).toBeInTheDocument();
    // QuizExplanation is gated behind submission, so {$explanation} is not yet
    // visible in the document.
    expect(screen.queryByText("因为基础数学。")).toBeNull();
  });

  it("renders functional Quiz* components from the dispatch table", () => {
    render(<QuizRenderer question={singleChoiceQuestion} />);
    expect(screen.getByRole("button", { name: "A: 1" }).dataset.quizOption).toBe("qz_op_a");
    expect(screen.getByRole("button", { name: "B: 2" }).dataset.quizOption).toBe("qz_op_b");
    expect(screen.getByRole("button", { name: "提交" }).dataset.quizAction).toBe("submit");
  });

  it("reveals QuizExplanation and its <p>{$explanation}</p> child only after submit", async () => {
    render(<QuizRenderer question={singleChoiceQuestion} />);
    expect(screen.queryByText("因为基础数学。")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "B: 2" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "提交" }));
    });

    const p = screen.getByText("因为基础数学。");
    expect(p.tagName).toBe("P");
    expect(p.closest("[data-quiz-slot='explanation']")).not.toBeNull();
  });

  it("renders <QuizInput> for fill-blank questions and threads its name through", () => {
    render(<QuizRenderer question={fillBlankQuestion} />);
    const input = document.querySelector(
      'input[data-quiz-input="qz_bl_1"]',
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.name).toBe("qz_bl_1");
    fireEvent.change(input, { target: { value: "world" } });
    expect(input.value).toBe("world");
    expect(screen.getByRole("button", { name: "提交" })).not.toBeDisabled();
  });

  it("renders a role=alert fallback when react_layout is not a <QuizContainer> root", () => {
    const broken: QuizSingleChoiceQuestion = {
      ...singleChoiceQuestion,
      react_layout: astEl("div", {}, [astText("oops")]),
    };
    render(<QuizRenderer question={broken} />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-quiz-slot", "invalid-ast");
  });

  it("forwards onSubmit through QuizContainer host hooks", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      submitted: true,
      submitting: false,
      earnedScore: 10,
      feedback: null,
      canAdvance: true,
      skipped: false,
    });
    render(<QuizRenderer question={singleChoiceQuestion} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "B: 2" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "提交" }));
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        question_id: "qz_q_1",
        selected_option_ids: ["qz_op_b"],
      }),
    );
  });

  it("silently ignores unknown tags introduced by future schema drift", () => {
    const driftLayout: QuizAstNode = astEl("QuizContainer", {}, [
      astEl("QuizTitle", {}, [astText("Hi")]),
      // `marquee` is not in the whitelist and validation would have rejected
      // it at write time; renderer must still not crash on stale payloads.
      astEl("marquee", {}, [astText("ignored")]),
      astEl("QuizSubmitButton", {}, [astText("提交")]),
    ]);
    render(
      <QuizRenderer
        question={{ ...singleChoiceQuestion, react_layout: driftLayout }}
      />,
    );
    expect(screen.queryByText("ignored")).toBeNull();
    expect(screen.getByText("Hi")).toBeInTheDocument();
  });

  it("drops disallowed style values via the runtime sanitizer", () => {
    const layout: QuizAstNode = astEl(
      "QuizContainer",
      {
        style: {
          color: "#fff",
          // `position: fixed` is in STYLE_VALUE_FORBIDDEN_FRAGMENTS.
          backgroundColor: "position:fixed; color:red",
        },
      },
      [astEl("QuizTitle", {}, [astText("Hi")]), astEl("QuizSubmitButton", {}, [astText("提交")])],
    );
    render(
      <QuizRenderer question={{ ...singleChoiceQuestion, react_layout: layout }} />,
    );
    const form = screen.getByText("Hi").closest("form")!;
    expect(form.style.color).toBe("rgb(255, 255, 255)");
    expect(form.style.backgroundColor).toBe("");
  });
});
