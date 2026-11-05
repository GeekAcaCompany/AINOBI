// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import type { QuizShadowingQuestion, QuizSpeechQuestion } from "@ainobi/courseware-core/quiz.ts";

import { QuizFormProvider, type QuizFormContextValue } from "./QuizFormContext.tsx";
import { QuizReferenceAudio } from "./QuizReferenceAudio.tsx";

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

const baseCtx = {
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
} satisfies QuizFormContextValue;

describe("QuizReferenceAudio", () => {
  it("renders nothing when src is empty and question has no reference audio", () => {
    const q = { ...shadowingQuestion, reference_audio_url: "" };
    const { container } = render(
      <QuizFormProvider value={{ ...baseCtx, question: q }}>
        <QuizReferenceAudio src="" />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });

  it("does not render for shadowing even when reference_audio_url is set", () => {
    const { container } = render(
      <QuizFormProvider value={baseCtx}>
        <QuizReferenceAudio src="" />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });

  it("does not render for shadowing when AST src is set directly", () => {
    const { container } = render(
      <QuizFormProvider value={baseCtx}>
        <QuizReferenceAudio src="https://example.com/direct.mp3" />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });

  it("renders controls when src is set on the node without question context", () => {
    const { container } = render(<QuizReferenceAudio src="https://example.com/direct.mp3" />);
    expect(container.querySelector("audio")).not.toBeNull();
  });

  it("does not render for speech even when reference_audio_url is set", () => {
    const speechQuestion: QuizSpeechQuestion = {
      ...shadowingQuestion,
      type: "speech",
      prompt: "",
      grading_criteria: "criteria",
      reference_audio_url: "https://example.com/speech-ref.mp3",
    };
    const { container } = render(
      <QuizFormProvider value={{ ...baseCtx, question: speechQuestion, questionType: "speech" }}>
        <QuizReferenceAudio src="" />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });

  it("does not render for speech when AST src is set directly", () => {
    const speechQuestion: QuizSpeechQuestion = {
      ...shadowingQuestion,
      type: "speech",
      prompt: "",
      grading_criteria: "criteria",
      reference_audio_url: "",
    };
    const { container } = render(
      <QuizFormProvider value={{ ...baseCtx, question: speechQuestion, questionType: "speech" }}>
        <QuizReferenceAudio src="https://example.com/direct.mp3" />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });
});
