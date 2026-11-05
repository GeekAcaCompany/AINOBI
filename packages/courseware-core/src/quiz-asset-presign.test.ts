// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import type { QuizConfig, QuizQuestion, QuizShadowingQuestion } from "./quiz.ts";
import {
  applySignedUrlsToQuizConfig,
  collectQuizAssetUrlsForPresign,
  stripSignaturesFromQuizConfig,
} from "./quiz.ts";

const buildQuestion = (): QuizQuestion => ({
  question_id: "qz_q_1",
  type: "shadowing",
  title: "题目",
  explanation: "",
  score: 10,
  required: true,
  pass_score: 10,
  advance_score: 0,
  allow_resubmit: false,
  show_feedback_score: true,
  time_limit_minutes: null,
  content_narration_audio_url: "https://cdn.example.com/narration.mp3?x-amz-signature=abc",
  content_narration_duration_ms: 1200,
  content_narration_vtuber_element_id: "",
  reference_text: "跟读文本",
  reference_audio_url: "https://cdn.example.com/reference.mp3?x-amz-signature=def",
  react_layout: {
    kind: "element",
    tag: "QuizContainer",
    props: {},
    children: [
      {
        kind: "element",
        tag: "QuizMedia",
        props: {
          type: "image",
          src: "https://cdn.example.com/question-image.png?x-amz-signature=ghi",
        },
        children: [],
      },
      {
        kind: "element",
        tag: "QuizMedia",
        props: {
          type: "audio",
          src: "https://cdn.example.com/question-audio.mp3?x-amz-signature=jkl",
        },
        children: [],
      },
      {
        kind: "element",
        tag: "QuizReferenceAudio",
        props: {
          src: "https://cdn.example.com/extra-reference.mp3?x-amz-signature=mno",
        },
        children: [],
      },
      {
        kind: "element",
        tag: "img",
        props: {
          src: "https://cdn.example.com/question-inline.png?x-amz-signature=pqr",
        },
        children: [],
      },
    ],
  },
});

const buildConfig = (): QuizConfig => ({
  enabled: true,
  total_score: 10,
  score_allocation: "custom",
  time_limit_minutes: null,
  questions: [buildQuestion()],
  grade_levels: [],
  score_summary: null,
});

describe("quiz asset urls in react_layout", () => {
  it("collects media urls from both question fields and react_layout", () => {
    const urls = collectQuizAssetUrlsForPresign(buildConfig());
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://cdn.example.com/narration.mp3?x-amz-signature=abc",
        "https://cdn.example.com/reference.mp3?x-amz-signature=def",
        "https://cdn.example.com/question-image.png?x-amz-signature=ghi",
        "https://cdn.example.com/question-audio.mp3?x-amz-signature=jkl",
        "https://cdn.example.com/extra-reference.mp3?x-amz-signature=mno",
        "https://cdn.example.com/question-inline.png?x-amz-signature=pqr",
      ]),
    );
  });

  it("applies signed urls inside react_layout media src props", () => {
    const config = buildConfig();
    const signed = applySignedUrlsToQuizConfig(config, {
      "https://cdn.example.com/question-image.png?x-amz-signature=ghi":
        "https://signed.example.com/question-image.png?token=1",
      "https://cdn.example.com/reference.mp3?x-amz-signature=def":
        "https://signed.example.com/reference.mp3?token=2",
    });
    const question = signed.questions[0] as QuizShadowingQuestion;
    expect(question.reference_audio_url).toBe("https://signed.example.com/reference.mp3?token=2");
    const root = question.react_layout;
    if (root.kind !== "element") throw new Error("invalid test setup");
    const mediaNode = root.children[0];
    if (!mediaNode || mediaNode.kind !== "element") throw new Error("invalid test setup");
    expect(mediaNode.props.src).toBe("https://signed.example.com/question-image.png?token=1");
  });

  it("strips signatures from react_layout media urls", () => {
    const stripped = stripSignaturesFromQuizConfig(buildConfig());
    const question = stripped.questions[0]!;
    const root = question.react_layout;
    if (root.kind !== "element") throw new Error("invalid test setup");
    const mediaNode = root.children[0];
    if (!mediaNode || mediaNode.kind !== "element") throw new Error("invalid test setup");
    expect(typeof mediaNode.props.src).toBe("string");
    expect(mediaNode.props.src).toBe("https://cdn.example.com/question-image.png");
    expect(question.content_narration_audio_url).toBe("https://cdn.example.com/narration.mp3");
  });
});
