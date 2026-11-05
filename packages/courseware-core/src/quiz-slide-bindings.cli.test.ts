// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";
import { createDefaultQuizConfig, createDefaultQuestion } from "./quiz.ts";
import { validateQuizSlideBindings } from "./quiz.ts";
import { buildDefaultQuizAst } from "./quiz-default-asts.ts";
import type { QuizSlideElement, SlideElement } from "./elements.ts";

const emptySlide = (index: number): SlideElement =>
  ({
    element_type: "slide",
    element_id: `el_slide_${index}`,
    name: `Slide ${index}`,
    size: { width: 1920, height: 1080 },
    position: { x: 0, y: 0 },
    timeline: { start_at: 0, end_at: 10_000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 0 },
    children_elements: [],
    background_color: "#000",
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    fps: 30,
    metadata: {},
  }) as SlideElement;

const quizSlideElement = (
  id: string,
  quizQuestionId: string,
): QuizSlideElement => ({
  element_type: "quiz",
  element_id: id,
  name: "Quiz",
  html: "",
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 1200, height: 800 },
  timeline: { start_at: 0, end_at: 10_000 },
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
  quiz_question_id: quizQuestionId,
});

test("validateQuizSlideBindings flags questions not inserted on any slide", () => {
  const config = createDefaultQuizConfig();
  const q = createDefaultQuestion("single_choice", "zh");
  q.react_layout = buildDefaultQuizAst(q, "zh");
  config.questions = [q];
  const issues = validateQuizSlideBindings(config, [emptySlide(0)]);
  assert.equal(issues.length, 1);
  assert.match(issues[0]?.message ?? "", /is not inserted on any slide/);
  assert.match(issues[0]?.message ?? "", /quiz prune-orphans/);
  assert.equal(issues[0]?.path, "quiz.questions[0]");
});

test("validateQuizSlideBindings passes when a quiz element exists on a slide", () => {
  const config = createDefaultQuizConfig();
  const q = createDefaultQuestion("single_choice", "zh");
  q.react_layout = buildDefaultQuizAst(q, "zh");
  config.questions = [q];
  const slide = emptySlide(0);
  slide.children_elements = [quizSlideElement("el_q1", q.question_id)];
  const issues = validateQuizSlideBindings(config, [slide]);
  assert.equal(issues.length, 0);
});
