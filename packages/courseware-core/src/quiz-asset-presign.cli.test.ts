// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import type { QuizConfig, QuizQuestion, QuizSpeechQuestion } from "./quiz.ts";
import {
  applySignedUrlsToQuizConfig,
  collectQuizAssetUrlsForPresign,
  stripSignaturesFromQuizConfig,
} from "./quiz.ts";

const buildSpeechQuestion = (): QuizSpeechQuestion => ({
  question_id: "qz_q_speech",
  type: "speech",
  title: "スピーチ",
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
  prompt: "",
  reference_text: "テーマ",
  reference_audio_url: "https://cdn.example.com/reference.mp3?x-amz-signature=def",
  grading_criteria: "criteria",
  react_layout: {
    kind: "element",
    tag: "QuizContainer",
    props: {},
    children: [
      {
        kind: "element",
        tag: "QuizReferenceAudio",
        props: {
          src: "https://cdn.example.com/ast-reference.mp3?x-amz-signature=ast",
        },
        children: [],
      },
    ],
  },
});

const buildConfig = (question: QuizQuestion): QuizConfig => ({
  enabled: true,
  total_score: 10,
  score_allocation: "custom",
  time_limit_minutes: null,
  questions: [question],
  grade_levels: [],
});

test("collectQuizAssetUrlsForPresign includes speech reference_audio_url and AST src", () => {
  const urls = collectQuizAssetUrlsForPresign(buildConfig(buildSpeechQuestion()));
  assert.ok(
    urls.includes("https://cdn.example.com/reference.mp3?x-amz-signature=def"),
  );
  assert.ok(urls.includes("https://cdn.example.com/ast-reference.mp3?x-amz-signature=ast"));
});

test("applySignedUrlsToQuizConfig rewrites speech reference_audio_url and QuizReferenceAudio.src", () => {
  const signed = applySignedUrlsToQuizConfig(buildConfig(buildSpeechQuestion()), {
    "https://cdn.example.com/reference.mp3?x-amz-signature=def":
      "https://signed.example.com/reference.mp3?token=1",
    "https://cdn.example.com/ast-reference.mp3?x-amz-signature=ast":
      "https://signed.example.com/ast-reference.mp3?token=2",
  });
  const question = signed.questions[0] as QuizSpeechQuestion;
  assert.equal(question.reference_audio_url, "https://signed.example.com/reference.mp3?token=1");
  const root = question.react_layout;
  assert.equal(root.kind, "element");
  const ref = root.children[0];
  assert.equal(ref?.kind, "element");
  assert.equal(ref?.tag, "QuizReferenceAudio");
  assert.equal(ref?.props.src, "https://signed.example.com/ast-reference.mp3?token=2");
});

test("stripSignaturesFromQuizConfig clears speech reference audio query params", () => {
  const stripped = stripSignaturesFromQuizConfig(buildConfig(buildSpeechQuestion()));
  const question = stripped.questions[0] as QuizSpeechQuestion;
  assert.equal(question.reference_audio_url, "https://cdn.example.com/reference.mp3");
  const root = question.react_layout;
  assert.equal(root.kind, "element");
  const ref = root.children[0];
  assert.equal(ref?.kind, "element");
  assert.equal(ref?.props.src, "https://cdn.example.com/ast-reference.mp3");
});
