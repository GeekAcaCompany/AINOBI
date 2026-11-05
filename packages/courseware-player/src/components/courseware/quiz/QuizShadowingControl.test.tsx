// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { QuizShadowingQuestion } from "@ainobi/courseware-core/quiz.ts";

import { QuizFormProvider, type QuizFormContextValue } from "./QuizFormContext.tsx";
import { QuizReferenceAudio } from "./QuizReferenceAudio.tsx";
import { QuizShadowingControl } from "./QuizShadowingControl.tsx";

const shadowingQuestion: QuizShadowingQuestion = {
  question_id: "qz_q_1",
  type: "shadowing",
  title: "跟读",
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
  reference_text: "Hello world",
  reference_audio_url: "https://example.com/ref.mp3",
  react_layout: { kind: "element", tag: "QuizContainer", props: {}, children: [] },
};

const wrap = (ui: ReactNode, extra: Partial<QuizFormContextValue> = {}) => {
  const value = {
    submitted: false,
    submitting: false,
    earnedScore: null,
    feedback: null,
    canAdvance: false,
    skipped: false,
    question: shadowingQuestion,
    questionType: "shadowing" as const,
    questionId: "qz_q_1",
    totalScore: 10,
    optionIds: [],
    blankIds: [],
    required: true,
    allowResubmit: false,
    showFeedbackScore: true,
    selectedOptionIds: [],
    isOptionSelected: () => false,
    toggleOption: () => {},
    inputValues: {},
    setInputValue: () => {},
    getInputValue: () => "",
    submit: () => {},
    reset: () => {},
    skip: () => {},
    advance: () => {},
    inlineError: null,
    recordingFieldName: null,
    recordingElapsedSec: 0,
    recordedBlobUrl: null,
    recordedDurationSec: 0,
    ...extra,
  } satisfies QuizFormContextValue;
  return render(<QuizFormProvider value={value}>{ui}</QuizFormProvider>);
};

describe("QuizReferenceAudio", () => {
  it("renders nothing when src is empty and question has no reference audio", () => {
    const q = { ...shadowingQuestion, reference_audio_url: "" };
    const { container } = render(
      <QuizFormProvider
        value={
          {
            question: q,
            questionType: "shadowing",
          } as QuizFormContextValue
        }
      >
        <QuizReferenceAudio src="" />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });

  it("does not render reference audio for shadowing questions", () => {
    const { container } = wrap(<QuizReferenceAudio src="" />);
    expect(container.querySelector("audio")).toBeNull();
  });
});

describe("QuizShadowingControl", () => {
  it("calls host onToggleRecord when clicked", async () => {
    const onToggleRecord = vi.fn();
    wrap(<QuizShadowingControl>开始录音</QuizShadowingControl>, { onToggleRecord });
    await screen.getByRole("button", { name: "开始录音" }).click();
    expect(onToggleRecord).toHaveBeenCalledWith("recording");
  });

  it("renders only AST children (empty when scene has no children)", () => {
    const { container } = wrap(<QuizShadowingControl />, { onToggleRecord: () => {} });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("");
  });

  it("preserves author border width when border shorthand is used", () => {
    wrap(
      <QuizShadowingControl
        style={{
          width: 100,
          height: 100,
          border: "2px solid #ccc5b8",
          background: "#ffffff",
          borderRadius: 50,
        }}
      >
        录
      </QuizShadowingControl>,
      { onToggleRecord: () => {} },
    );
    const button = screen.getByRole("button", { name: "录" });
    expect(button.style.border).toBe("2px solid rgb(204, 197, 184)");
  });

  it("applies recordingStyle while recording", () => {
    wrap(
      <QuizShadowingControl
        style={{ background: "#ffffff", border: "2px solid #ccc5b8" }}
        recordingStyle={{ background: "#e53e3e", border: "2px solid #c53030" }}
      >
        录
      </QuizShadowingControl>,
      {
        onToggleRecord: () => {},
        recordingFieldName: "recording",
      },
    );
    const button = screen.getByRole("button", { name: "录" });
    expect(button.style.background).toBe("rgb(229, 62, 62)");
    expect(button.getAttribute("data-quiz-state")).toBe("recording");
  });
});
