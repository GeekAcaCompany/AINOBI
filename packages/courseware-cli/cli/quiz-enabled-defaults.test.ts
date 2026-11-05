// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { applyOperation } from "./operations.ts";
import {
  createDefaultQuestion,
  createDefaultQuizConfig,
  validateQuizConfig,
} from "@ainobi/courseware-core/quiz.ts";
import { buildDefaultQuizAst } from "@ainobi/courseware-core/quiz-default-asts.ts";

const baseSceneWithOneSlide = (): Record<string, unknown> => ({
  metadata: { language: "zh" },
  slide_elements: [
    {
      element_type: "slide",
      element_id: "el_slide_0",
      name: "S",
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      timeline: { start_at: 0, end_at: 10000 },
      style: { opacity: 1, rotation_deg: 0, z_index: 0 },
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
      background_color: "#000",
      fps: 30,
      children_elements: [],
    },
  ],
});

test("createDefaultQuizConfig enables quiz by default", () => {
  assert.equal(createDefaultQuizConfig().enabled, true);
});

test("quiz.init defaults enabled to true when omitted", () => {
  const scene: Record<string, unknown> = {};
  const result = applyOperation(scene, { op: "quiz.init", total_score: 100 });
  assert.equal((scene.quiz as { enabled: boolean }).enabled, true);
  assert.deepEqual(result.data, { enabled: true, total_score: 100 });
});

test("quiz.init stores time limits in minutes", () => {
  const scene: Record<string, unknown> = {};
  applyOperation(scene, { op: "quiz.init", total_score: 100, time_limit_minutes: 1.5 });
  const quiz = scene.quiz as { time_limit_minutes: number; time_limit_seconds?: number };
  assert.equal(quiz.time_limit_minutes, 1.5);
  assert.equal("time_limit_seconds" in quiz, false);
});

test("quiz.init converts legacy time_limit_seconds to minutes", () => {
  const scene: Record<string, unknown> = {};
  applyOperation(scene, { op: "quiz.init", total_score: 100, time_limit_seconds: 90 });
  const quiz = scene.quiz as { time_limit_minutes: number; time_limit_seconds?: number };
  assert.equal(quiz.time_limit_minutes, 1.5);
  assert.equal("time_limit_seconds" in quiz, false);
});

test("quiz.insert auto-creates scene.quiz with enabled true and registers the question", () => {
  const scene = baseSceneWithOneSlide();
  applyOperation(scene, {
    op: "quiz.insert",
    slide: 0,
    type: "single_choice",
    question: { title: "2+2?" },
  });
  const quiz = scene.quiz as { enabled: boolean; questions: Array<{ title: string }> };
  assert.equal(quiz.enabled, true);
  assert.equal(quiz.questions.length, 1);
  assert.equal(quiz.questions[0]?.title, "2+2?");
});

test("quiz.init on existing quiz preserves questions and enables by default", () => {
  const scene = baseSceneWithOneSlide();
  applyOperation(scene, {
    op: "quiz.insert",
    slide: 0,
    type: "single_choice",
    question: { title: "2+2?" },
  });
  (scene.quiz as { enabled: boolean }).enabled = false;
  applyOperation(scene, { op: "quiz.init", total_score: 100 });
  const quiz = scene.quiz as { enabled: boolean; questions: unknown[] };
  assert.equal(quiz.enabled, true);
  assert.equal(quiz.questions.length, 1);
});

test("validateQuizConfig warns when questions exist but quiz is disabled", () => {
  const question = createDefaultQuestion("single_choice", "zh");
  question.react_layout = buildDefaultQuizAst(question, "zh");
  const issues = validateQuizConfig({
    ...createDefaultQuizConfig(),
    enabled: false,
    questions: [question],
  });
  assert.ok(issues.some((issue) => issue.path === "quiz.enabled"));
});
