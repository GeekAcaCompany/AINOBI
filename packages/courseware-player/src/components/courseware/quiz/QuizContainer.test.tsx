// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import type {
  QuizMultipleChoiceQuestion,
  QuizSingleChoiceQuestion,
  QuizSpeechQuestion,
} from "@ainobi/courseware-core/quiz.ts";

import { QuizContainer } from "./QuizContainer.tsx";
import { QuizOption } from "./QuizOption.tsx";
import { QuizOptionGroup } from "./QuizOptionGroup.tsx";
import { QuizSubmitButton } from "./QuizSubmitButton.tsx";
import { QuizTitle } from "./QuizTitle.tsx";

const baseQuestionFields = {
  explanation: "",
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
  react_layout: { kind: "element" as const, tag: "QuizContainer" as const, props: {}, children: [] },
};

const singleChoiceQuestion: QuizSingleChoiceQuestion = {
  ...baseQuestionFields,
  question_id: "qz_q_test",
  type: "single_choice",
  title: "1 + 1 = ?",
  options: [
    { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
    { option_id: "qz_op_b", value: "qz_op_b", is_correct: true },
    { option_id: "qz_op_c", value: "qz_op_c", is_correct: false },
  ],
};

const speechQuestion: QuizSpeechQuestion = {
  ...baseQuestionFields,
  question_id: "qz_q_speech",
  type: "speech",
  title: "请用英语自我介绍",
  prompt: "请用英语自我介绍",
  reference_text: "",
  reference_audio_url: "",
  grading_criteria: "",
  react_layout: { kind: "element", tag: "QuizContainer", props: {}, children: [] },
};

const multipleChoiceQuestion: QuizMultipleChoiceQuestion = {
  ...baseQuestionFields,
  question_id: "qz_q_multi",
  type: "multiple_choice",
  title: "选出所有水果",
  grading: "partial_credit",
  options: [
    { option_id: "qz_op_apple", value: "qz_op_apple", is_correct: true },
    { option_id: "qz_op_banana", value: "qz_op_banana", is_correct: true },
    { option_id: "qz_op_potato", value: "qz_op_potato", is_correct: false },
  ],
};

const renderSingleChoiceTree = (
  overrides: Partial<React.ComponentProps<typeof QuizContainer>> = {},
) =>
  render(
    <QuizContainer question={singleChoiceQuestion} {...overrides}>
      <QuizTitle>{singleChoiceQuestion.title}</QuizTitle>
      <QuizOptionGroup>
        {singleChoiceQuestion.options.map((opt) => (
          <QuizOption key={opt.option_id} value={opt.option_id}>
            {opt.option_id}
          </QuizOption>
        ))}
      </QuizOptionGroup>
      <QuizSubmitButton>提交</QuizSubmitButton>
    </QuizContainer>,
  );

describe("QuizContainer", () => {
  it("renders a <form> with data attributes wired from the question", () => {
    renderSingleChoiceTree();
    const form = screen.getByRole("button", { name: "qz_op_a" }).closest("form");
    expect(form).not.toBeNull();
    expect(form?.dataset.quizContainer).toBe("qz_q_test");
    expect(form?.dataset.quizType).toBe("single_choice");
    expect(form?.dataset.quizSubmitted).toBe("false");
  });

  it("forwards `padding` and `gap` props to the form element style", () => {
    renderSingleChoiceTree({ padding: 24, gap: 12, className: "quiz-form" });
    const form = screen.getByRole("button", { name: "qz_op_a" }).closest("form")!;
    expect(form.style.padding).toBe("24px");
    expect(form.style.gap).toBe("12px");
    expect(form).toHaveClass("quiz-form");
  });

  it("disables submit until at least one option is selected (single_choice)", () => {
    renderSingleChoiceTree();
    const submit = screen.getByRole("button", { name: "提交" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "qz_op_b" }));
    expect(submit).not.toBeDisabled();
  });

  it("treats single_choice selection as exclusive", () => {
    renderSingleChoiceTree();
    const a = screen.getByRole("button", { name: "qz_op_a" });
    const b = screen.getByRole("button", { name: "qz_op_b" });
    fireEvent.click(a);
    expect(a.dataset.quizState).toBe("selected");
    fireEvent.click(b);
    expect(a.dataset.quizState).toBe("idle");
    expect(b.dataset.quizState).toBe("selected");
  });

  it("treats multiple_choice selection as additive", () => {
    render(
      <QuizContainer question={multipleChoiceQuestion}>
        <QuizOptionGroup>
          {multipleChoiceQuestion.options.map((opt) => (
            <QuizOption key={opt.option_id} value={opt.option_id}>
              {opt.option_id}
            </QuizOption>
          ))}
        </QuizOptionGroup>
        <QuizSubmitButton />
      </QuizContainer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "qz_op_apple" }));
    fireEvent.click(screen.getByRole("button", { name: "qz_op_banana" }));
    expect(screen.getByRole("button", { name: "qz_op_apple" }).dataset.quizState).toBe("selected");
    expect(screen.getByRole("button", { name: "qz_op_banana" }).dataset.quizState).toBe("selected");
    expect(screen.getByRole("button", { name: "qz_op_potato" }).dataset.quizState).toBe("idle");
    // Re-clicking toggles off.
    fireEvent.click(screen.getByRole("button", { name: "qz_op_apple" }));
    expect(screen.getByRole("button", { name: "qz_op_apple" }).dataset.quizState).toBe("idle");
  });

  it("calls onSubmit with the current selection and locks the form afterwards", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      submitted: true,
      submitting: false,
      earnedScore: 10,
      feedback: { correct: true, message: "对了！" },
      canAdvance: true,
      skipped: false,
    });
    renderSingleChoiceTree({ onSubmit });
    fireEvent.click(screen.getByRole("button", { name: "qz_op_b" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "提交" }));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        question_id: "qz_q_test",
        question_type: "single_choice",
        selected_option_ids: ["qz_op_b"],
        input_values: {},
      }),
    );

    const correctOption = screen.getByRole("button", { name: "qz_op_b" });
    expect(correctOption.dataset.quizState).toBe("submitted-correct");
    expect(correctOption.dataset.quizCorrect).toBe("true");
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
  });

  it("submit button exposes disabled state before an answer is chosen", () => {
    renderSingleChoiceTree();
    const submit = screen.getByRole("button", { name: "提交" });
    expect(submit).toBeDisabled();
    expect(submit.dataset.quizState).toBe("disabled");
  });

  it("after a wrong submit, highlights the correct option in green and the pick in red", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      submitted: true,
      submitting: false,
      earnedScore: 0,
      feedback: "不对",
      canAdvance: false,
      skipped: false,
    });
    renderSingleChoiceTree({ onSubmit });
    fireEvent.click(screen.getByRole("button", { name: "qz_op_a" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "提交" }));
    });
    expect(screen.getByRole("button", { name: "qz_op_a" }).dataset.quizState).toBe(
      "submitted-incorrect",
    );
    expect(screen.getByRole("button", { name: "qz_op_b" }).dataset.quizState).toBe(
      "submitted-correct",
    );
    expect(screen.getByRole("button", { name: "qz_op_c" }).dataset.quizState).toBe(
      "submitted-other",
    );
  });

  it("surfaces a thrown submission error via role=alert and unlocks resubmission", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("网络异常"));
    renderSingleChoiceTree({ onSubmit });
    fireEvent.click(screen.getByRole("button", { name: "qz_op_b" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "提交" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("网络异常");
    // The submit button is enabled again so the user can retry.
    expect(screen.getByRole("button", { name: "提交" })).not.toBeDisabled();
  });

  it("disables submit for speech until a recording exists", () => {
    render(
      <QuizContainer
        question={speechQuestion}
        recording={{ recordedBlobUrl: null, recordedDurationSec: 0 }}
      >
        <QuizSubmitButton>提交</QuizSubmitButton>
      </QuizContainer>,
    );
    const submit = screen.getByRole("button", { name: "提交" });
    expect(submit).toBeDisabled();
    expect(submit.dataset.quizState).toBe("disabled");
  });

  it("enables submit for speech after recording is available", () => {
    const { rerender } = render(
      <QuizContainer
        question={speechQuestion}
        recording={{ recordedBlobUrl: null, recordedDurationSec: 0 }}
      >
        <QuizSubmitButton>提交</QuizSubmitButton>
      </QuizContainer>,
    );
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    rerender(
      <QuizContainer
        question={speechQuestion}
        recording={{
          recordedBlobUrl: "blob:https://example.test/rec",
          recordedDurationSec: 3,
        }}
      >
        <QuizSubmitButton>提交</QuizSubmitButton>
      </QuizContainer>,
    );
    expect(screen.getByRole("button", { name: "提交" })).not.toBeDisabled();
  });

  it("keeps overflow visible when container height is bounded", () => {
    const { container } = render(
      <QuizContainer
        question={singleChoiceQuestion}
        style={{ width: 400, height: 200, boxSizing: "border-box" }}
      >
        <QuizTitle>{singleChoiceQuestion.title}</QuizTitle>
      </QuizContainer>,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.style.height).toBe("200px");
    expect(form.style.overflow).toBe("visible");
    expect(form.style.overflowY).toBe("visible");
    expect(form.style.overflowX).toBe("visible");
    expect(form.style.minHeight).toBe("0");
  });

  it("forces visible overflow even when AST sets auto scroll on a bounded box", () => {
    const { container } = render(
      <QuizContainer
        question={singleChoiceQuestion}
        style={{ width: 400, height: 200, overflow: "auto" }}
      >
        <QuizTitle>{singleChoiceQuestion.title}</QuizTitle>
      </QuizContainer>,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.style.overflow).toBe("visible");
    expect(form.style.overflowY).toBe("visible");
    expect(form.style.overflowX).toBe("visible");
  });

  it("controlled mode: defers to host-provided state and skips internal state writes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const state = {
      submitted: true,
      submitting: false,
      earnedScore: 10,
      feedback: null,
      canAdvance: true,
      skipped: false,
    };
    renderSingleChoiceTree({ state, onSubmit });
    // Submit is disabled because state.submitted=true.
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    // Options are non-interactive after submission.
    expect(screen.getByRole("button", { name: "qz_op_a" })).toBeDisabled();
  });

  it("controlled selection: renders host-provided answers after reload", () => {
    renderSingleChoiceTree({
      state: {
        submitted: true,
        submitting: false,
        earnedScore: 10,
        feedback: "对了",
        canAdvance: true,
        skipped: false,
      },
      selection: { selectedOptionIds: ["qz_op_b"], inputValues: {} },
    });
    expect(screen.getByRole("button", { name: "qz_op_b" }).dataset.quizState).toBe("submitted-correct");
  });
});
