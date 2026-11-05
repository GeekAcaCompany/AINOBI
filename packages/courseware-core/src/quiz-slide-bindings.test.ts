// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createDefaultQuizConfig, createDefaultQuestion } from "./quiz.ts";
import { validateQuizSlideBindings } from "./quiz.ts";
import type { QuizSlideElement, SlideElement } from "./elements.ts";

const newQuizCanvasElement = (
  quizQuestionId: string,
  z: number,
  timeline: { start_at: number; end_at: number },
): QuizSlideElement => ({
  element_type: "quiz",
  element_id: `el_q_${quizQuestionId}`,
  name: "Quiz",
  html: "",
  fps: 30,
  position: { x: 100, y: 100 },
  size: { width: 800, height: 600 },
  timeline,
  style: { z_index: z, opacity: 1, rotation_deg: 0 },
  enter_effect: "none",
  exit_effect: "none",
  keyframes: [],
  animations: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  metadata: {},
  quiz_question_id: quizQuestionId,
});

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

describe("validateQuizSlideBindings", () => {
  it("flags questions not inserted on any slide", () => {
    const config = createDefaultQuizConfig();
    config.questions = [createDefaultQuestion("single_choice", "zh")];
    // Hosts localize through the injected formatter; echo the key to assert which message fired.
    const issues = validateQuizSlideBindings(config, [emptySlide(0)], (key) => key);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("questionNotOnSlide");
    expect(issues[0]?.path).toBe("quiz.questions[0]");
  });

  it("passes when a QuizSlideElement exists on the slide", () => {
    const config = createDefaultQuizConfig();
    const q = createDefaultQuestion("single_choice", "zh");
    config.questions = [q];
    const slide = emptySlide(0);
    slide.children_elements = [
      newQuizCanvasElement(q.question_id, 1, { start_at: 0, end_at: 10_000 }),
    ];
    const issues = validateQuizSlideBindings(config, [slide]);
    expect(issues).toHaveLength(0);
  });
});
