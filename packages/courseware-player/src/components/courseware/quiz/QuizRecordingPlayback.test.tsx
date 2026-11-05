// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { QuizShadowingQuestion } from "@ainobi/courseware-core/quiz.ts";

import { QuizFormProvider, type QuizFormContextValue } from "./QuizFormContext.tsx";
import { QuizRecordingPlayback } from "./QuizRecordingPlayback.tsx";

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
  reference_text: "Hello",
  reference_audio_url: "",
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

describe("QuizRecordingPlayback", () => {
  it("renders nothing before a take exists", () => {
    const { container } = render(
      <QuizFormProvider value={baseCtx}>
        <QuizRecordingPlayback />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });

  it("renders audio controls after recording stops", () => {
    // Pin the UI language via storage instead of relying on jsdom's default
    // navigator.language.
    window.localStorage.setItem("ainobi-ui-language", "en");
    try {
      render(
        <QuizFormProvider
          value={{
            ...baseCtx,
            recordedBlobUrl: "blob:https://example.com/recording",
            recordedDurationSec: 4.2,
          }}
        >
          <QuizRecordingPlayback />
        </QuizFormProvider>,
      );
      expect(screen.getByText(/Recording playback · 0:04/)).toBeTruthy();
      expect(document.querySelector("audio")?.getAttribute("src")).toBe(
        "blob:https://example.com/recording",
      );
    } finally {
      window.localStorage.removeItem("ainobi-ui-language");
      window.sessionStorage.removeItem("ainobi-ui-language");
    }
  });

  it("renders the zh label when the stored UI language is zh", () => {
    window.localStorage.setItem("ainobi-ui-language", "zh");
    try {
      render(
        <QuizFormProvider
          value={{
            ...baseCtx,
            recordedBlobUrl: "blob:https://example.com/recording",
            recordedDurationSec: 4.2,
          }}
        >
          <QuizRecordingPlayback />
        </QuizFormProvider>,
      );
      expect(screen.getByText(/录音回放 · 0:04/)).toBeTruthy();
    } finally {
      window.localStorage.removeItem("ainobi-ui-language");
      window.sessionStorage.removeItem("ainobi-ui-language");
    }
  });

  it("hides while recording is in progress", () => {
    const { container } = render(
      <QuizFormProvider
        value={{
          ...baseCtx,
          recordingFieldName: "recording",
          recordedBlobUrl: "blob:https://example.com/recording",
          recordedDurationSec: 2,
        }}
      >
        <QuizRecordingPlayback />
      </QuizFormProvider>,
    );
    expect(container.querySelector("audio")).toBeNull();
  });
});
