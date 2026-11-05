// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { collectHtmlQuizSlideSpanWarnings } from "./element-slide-span-warnings.ts";
import type { Scene } from "@ainobi/courseware-core";

const baseSlide = (overrides: Record<string, unknown> = {}) => ({
  element_type: "slide" as const,
  element_id: "el_slide_1",
  name: "Slide 1",
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  timeline: { start_at: 0, end_at: 10_000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  enter_effect: "none" as const,
  exit_effect: "none" as const,
  animations: [],
  keyframes: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  metadata: {},
  background_color: "#fff",
  children_elements: [],
  ...overrides,
});

test("collectHtmlQuizSlideSpanWarnings flags partial html and quiz timelines", () => {
  const scene = {
    slide_elements: [
      baseSlide({
        children_elements: [
          {
            element_type: "html",
            element_id: "el_html_1",
            name: "",
            html: "",
            fps: 30,
            position: { x: 0, y: 0 },
            size: { width: 800, height: 600 },
            timeline: { start_at: 0, end_at: 5000 },
            style: { opacity: 1, rotation_deg: 0, z_index: 1 },
            enter_effect: "none",
            exit_effect: "none",
            animations: [],
            keyframes: [],
            event_bindings: [],
            action_mappings: {},
            event_scripts: {},
            preset_script: "",
            metadata: {},
            src: "https://example.com/page.html",
            html_event_bindings: {},
            children_elements: [],
          },
          {
            element_type: "quiz",
            element_id: "el_quiz_1",
            name: "",
            html: "",
            fps: 30,
            position: { x: 80, y: 60 },
            size: { width: 1760, height: 960 },
            timeline: { start_at: 1000, end_at: 10_000 },
            style: { opacity: 1, rotation_deg: 0, z_index: 2 },
            enter_effect: "none",
            exit_effect: "none",
            animations: [],
            keyframes: [],
            event_bindings: [],
            action_mappings: {},
            event_scripts: {},
            preset_script: "",
            metadata: {},
            quiz_question_id: "q1",
          },
        ],
      }),
    ],
  } as unknown as Scene;

  const warnings = collectHtmlQuizSlideSpanWarnings(scene);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0].message, /HTML element timeline does not span the full slide/);
  assert.match(warnings[1].message, /Quiz element timeline does not span the full slide/);
});

test("collectHtmlQuizSlideSpanWarnings is silent when html/quiz span the slide", () => {
  const scene = {
    slide_elements: [
      baseSlide({
        children_elements: [
          {
            element_type: "html",
            element_id: "el_html_1",
            name: "",
            html: "",
            fps: 30,
            position: { x: 0, y: 0 },
            size: { width: 800, height: 600 },
            timeline: { start_at: 0, end_at: 10_000 },
            style: { opacity: 1, rotation_deg: 0, z_index: 1 },
            enter_effect: "none",
            exit_effect: "none",
            animations: [],
            keyframes: [],
            event_bindings: [],
            action_mappings: {},
            event_scripts: {},
            preset_script: "",
            metadata: {},
            src: "https://example.com/page.html",
            html_event_bindings: {},
            children_elements: [],
          },
        ],
      }),
    ],
  } as unknown as Scene;

  assert.deepEqual(collectHtmlQuizSlideSpanWarnings(scene), []);
});
