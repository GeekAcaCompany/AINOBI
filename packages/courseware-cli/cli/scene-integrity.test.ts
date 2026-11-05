// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import type { Scene, SlideElement, TextElement, QuizConfig } from "@ainobi/courseware-core";
import { createDefaultQuestion, createDefaultQuizConfig } from "@ainobi/courseware-core/quiz.ts";
import { buildDefaultQuizAst } from "@ainobi/courseware-core/quiz-default-asts.ts";
import {
  assertNoOrphanQuizQuestions,
  collectDuplicateElementIdIssues,
  collectOrphanQuizQuestionIssues,
} from "./scene-integrity.ts";
import { AinobiCliError } from "./errors.ts";

const textChild = (elementId: string): TextElement => ({
  element_type: "text",
  element_id: elementId,
  name: "t",
  html: "",
  text: "hi",
  position: { x: 0, y: 0 },
  size: { width: 100, height: 40 },
  timeline: { start_at: 0, end_at: 5000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  keyframes: [],
  animations: [],
  event_bindings: [],
  fps: 30,
  metadata: {},
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  font_family: "Inter",
  font_size: 16,
  color: "#000000",
  align: "left",
  bold: false,
  italic: false,
  text_background_color: "transparent",
  enter_effect: "none",
  exit_effect: "none",
});

const slide = (elementId: string, children: TextElement[] = []): SlideElement => ({
  element_type: "slide",
  element_id: elementId,
  name: elementId,
  background_color: "#FFFFFF",
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  timeline: { start_at: 0, end_at: 5000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  keyframes: [],
  animations: [],
  event_bindings: [],
  fps: 30,
  metadata: {},
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  enter_effect: "none",
  exit_effect: "none",
  children_elements: children,
});

const minimalScene = (): Scene => ({
  scene_id: "sc_test",
  name: "Test",
  slide_elements: [slide("el_slide_a", [textChild("el_text_child")]), slide("el_slide_b")],
  vtuber_elements: [],
  audio_elements: [],
  controller: {
    play: true,
    next: true,
    back: true,
    seekBar: true,
    time: true,
    slideNumber: true,
    volume: true,
    fullScreen: true,
    brand: true,
    playbackRate: true,
  },
  transitions: [],
  preset_script: "",
  metadata: {},
});

test("collectDuplicateElementIdIssues reports cross-slide slide id duplicates", () => {
  const scene = minimalScene();
  scene.slide_elements[1].element_id = "el_slide_a";
  const issues = collectDuplicateElementIdIssues(scene);
  assert.equal(issues.length, 1);
  assert.match(issues[0]?.message ?? "", /el_slide_a/);
  assert.match(issues[0]?.message ?? "", /slide_elements\[0\]/);
  assert.match(issues[0]?.message ?? "", /slide_elements\[1\]/);
});

test("collectDuplicateElementIdIssues reports within-slide child duplicates", () => {
  const scene = minimalScene();
  scene.slide_elements[0].children_elements.push(textChild("el_text_child"));
  const issues = collectDuplicateElementIdIssues(scene);
  assert.equal(issues.length, 1);
  assert.match(issues[0]?.message ?? "", /el_text_child/);
});

test("collectDuplicateElementIdIssues passes for unique ids", () => {
  const issues = collectDuplicateElementIdIssues(minimalScene());
  assert.deepEqual(issues, []);
});

test("assertNoOrphanQuizQuestions throws when a question has no slide binding", () => {
  const scene = minimalScene();
  const quiz: QuizConfig = createDefaultQuizConfig();
  const q = createDefaultQuestion("single_choice", "zh");
  q.react_layout = buildDefaultQuizAst(q, "zh");
  quiz.questions = [q];
  scene.quiz = quiz;
  const issues = collectOrphanQuizQuestionIssues(scene);
  assert.equal(issues.length, 1);
  assert.throws(() => assertNoOrphanQuizQuestions(scene), (err: unknown) => {
    assert.ok(err instanceof AinobiCliError);
    assert.equal(err.code, "VALIDATION_ERROR");
    assert.match(err.message, /orphan quiz question/);
    return true;
  });
});
