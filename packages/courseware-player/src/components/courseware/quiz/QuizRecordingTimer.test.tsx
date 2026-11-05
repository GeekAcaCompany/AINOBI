// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

import { QuizFormProvider, type QuizFormContextValue } from "./QuizFormContext.tsx";
import { QuizRecordingTimer } from "./QuizRecordingTimer.tsx";

const baseQuestion: QuizQuestion = {
  question_id: "qz_q_1",
  type: "shadowing",
  title: "跟读",
  score: 10,
  required: true,
  pass_score: 0,
  advance_score: 0,
  explanation: "",
  reference_text: "Hello",
  reference_audio_url: "",
  content_narration_audio_url: "",
  content_narration_duration_ms: 0,
  content_narration_vtuber_element_id: "",
  time_limit_minutes: null,
  allow_resubmit: true,
  show_feedback_score: true,
  react_layout: { kind: "element", tag: "QuizContainer", props: {}, children: [] },
};

const baseCtx = (overrides: Partial<QuizFormContextValue>): QuizFormContextValue => ({
  submitted: false,
  submitting: false,
  earnedScore: null,
  feedback: null,
  canAdvance: false,
  skipped: false,
  question: baseQuestion,
  questionType: "shadowing",
  questionId: "qz_q_1",
  totalScore: 10,
  optionIds: [],
  blankIds: [],
  required: true,
  allowResubmit: true,
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
  ...overrides,
});

describe("QuizRecordingTimer", () => {
  it("hidden when idle and hideWhenIdle is true", () => {
    const { container } = render(
      <QuizFormProvider value={baseCtx({})}>
        <QuizRecordingTimer />
      </QuizFormProvider>,
    );
    expect(container.querySelector("[data-quiz-slot='recording-timer']")).toBeNull();
  });

  it("shows formatted elapsed while recording", () => {
    render(
      <QuizFormProvider
        value={baseCtx({ recordingFieldName: "recording", recordingElapsedSec: 65 })}
      >
        <QuizRecordingTimer />
      </QuizFormProvider>,
    );
    expect(screen.getByText("1:05")).toBeTruthy();
  });

  it("renders custom children", () => {
    render(
      <QuizFormProvider
        value={baseCtx({ recordingFieldName: "recording", recordingElapsedSec: 3 })}
      >
        <QuizRecordingTimer>
          <span>自定义</span>
        </QuizRecordingTimer>
      </QuizFormProvider>,
    );
    expect(screen.getByText("自定义")).toBeTruthy();
  });
});
