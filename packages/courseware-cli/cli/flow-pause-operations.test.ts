// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { applyOperation } from "./operations.ts";

const baseSceneWithRich = (): Record<string, unknown> => ({
  metadata: { language: "zh" },
  slide_elements: [
    {
      element_type: "slide",
      element_id: "el_slide_0",
      name: "S",
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      timeline: { start_at: 0, end_at: 10_000 },
      style: { opacity: 1, rotation_deg: 0, z_index: 0 },
      enter_effect: "none",
      exit_effect: "none",
      animations: [],
      keyframes: [],
      event_bindings: [],
      action_mappings: {},
      event_scripts: {},
      preset_script: "",
      metadata: {},
      background_color: "#000",
      fps: 30,
      children_elements: [
        {
          element_type: "rich",
          element_id: "el_rich_1",
          name: "Article",
          position: { x: 100, y: 100 },
          size: { width: 800, height: 600 },
          timeline: { start_at: 2000, end_at: 8000 },
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
          react_layout: { type: "div", props: {}, children: [] },
        },
      ],
    },
  ],
});

test("flow_pause.add attaches pause at element timeline end by default", () => {
  const scene = baseSceneWithRich();
  const result = applyOperation(scene, {
    op: "flow_pause.add",
    slide: 0,
    element: "el_rich_1",
  });
  const slide = (scene.slide_elements as Record<string, unknown>[])[0]!;
  const points = slide.flow_pause_points as { pause_id: string; at_ms: number }[];
  assert.equal(points.length, 1);
  assert.equal(points[0]?.at_ms, 8000);
  assert.equal((result.data as { at_ms: number }).at_ms, 8000);
});

test("flow_pause.add --when start waits for opacity fade-in keyframes", () => {
  const scene = baseSceneWithRich();
  const slide = (scene.slide_elements as Record<string, unknown>[])[0]!;
  slide.children_elements = [
    {
      element_type: "html",
      element_id: "el_html_game",
      name: "Game",
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      timeline: { start_at: 0, end_at: 30_100 },
      style: { opacity: 1, rotation_deg: 0, z_index: 1 },
      enter_effect: "none",
      exit_effect: "none",
      animations: [],
      keyframes: [
        {
          at: 0,
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          rotation_deg: 0,
          opacity: 0,
          easing: "ease-out",
        },
        {
          at: 600,
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          rotation_deg: 0,
          opacity: 1,
          easing: "ease-out",
        },
      ],
      event_bindings: [],
      action_mappings: {},
      event_scripts: {},
      preset_script: "",
      metadata: {},
      fps: 30,
      src: "data:text/html,<html></html>",
      html_event_bindings: {},
      children_elements: [],
    },
  ];
  const result = applyOperation(scene, {
    op: "flow_pause.add",
    slide: 0,
    element: "el_html_game",
    when: "start",
  });
  const points = slide.flow_pause_points as { pause_id: string; at_ms: number }[];
  assert.equal(points[0]?.at_ms, 600);
  assert.equal((result.data as { at_ms: number }).at_ms, 600);
});

test("flow_pause.add rejects quiz element target", () => {
  const scene = baseSceneWithRich();
  const slide = (scene.slide_elements as Record<string, unknown>[])[0]!;
  slide.children_elements = [
    ...(slide.children_elements as unknown[]),
    {
      element_type: "quiz",
      element_id: "el_quiz_1",
      quiz_question_id: "q1",
      timeline: { start_at: 0, end_at: 10_000 },
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
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
      name: "Q",
      fps: 30,
    },
  ];
  assert.throws(
    () =>
      applyOperation(scene, {
        op: "flow_pause.add",
        slide: 0,
        element: "el_quiz_1",
      }),
    /quiz/i,
  );
});

test("flow_pause.remove deletes pause by id", () => {
  const scene = baseSceneWithRich();
  const added = applyOperation(scene, { op: "flow_pause.add", slide: 0, at: 5000 });
  const pauseId = (added.data as { pause_id: string }).pause_id;
  applyOperation(scene, { op: "flow_pause.remove", slide: 0, pause_id: pauseId });
  const slide = (scene.slide_elements as Record<string, unknown>[])[0]!;
  assert.equal(slide.flow_pause_points, undefined);
});

test("flow_pause.add converts element timeline to slide-local when slide start_at is nonzero", () => {
  const scene = baseSceneWithRich();
  const slide = (scene.slide_elements as Record<string, unknown>[])[0]!;
  slide.timeline = { start_at: 10_000, end_at: 20_000 };
  const rich = (slide.children_elements as Record<string, unknown>[])[0]!;
  rich.timeline = { start_at: 12_000, end_at: 15_000 };
  const result = applyOperation(scene, {
    op: "flow_pause.add",
    slide: 0,
    element: "el_rich_1",
  });
  assert.equal((result.data as { at_ms: number }).at_ms, 5000);
  const points = slide.flow_pause_points as { at_ms: number }[];
  assert.equal(points[0]?.at_ms, 5000);
});

test("slide.update shortens duration and clamps flow_pause_points", () => {
  const scene = baseSceneWithRich();
  applyOperation(scene, { op: "flow_pause.add", slide: 0, at: 9000 });
  applyOperation(scene, {
    op: "slide.update",
    slide: 0,
    patch: { timeline: { start_at: 0, end_at: 5000 } },
  });
  const slide = (scene.slide_elements as Record<string, unknown>[])[0]!;
  const points = slide.flow_pause_points as { at_ms: number }[];
  assert.equal(points[0]?.at_ms, 5000);
});

test("quiz.insert fills slide end_at when only start_at is explicit", () => {
  const scene = baseSceneWithRich();
  applyOperation(scene, {
    op: "quiz.init",
    total_score: 100,
  });
  applyOperation(scene, {
    op: "quiz.insert",
    slide: 0,
    type: "single_choice",
    element: {
      timeline: { start_at: 2000 },
    },
    question: {
      type: "single_choice",
      title: "Q?",
      options: [{ value: "A" }, { value: "B" }],
      correct_answer: "A",
    },
  });
  const slide = (scene.slide_elements as Record<string, unknown>[])[0]!;
  const quiz = (slide.children_elements as Record<string, unknown>[]).find(
    (el) => el.element_type === "quiz",
  )!;
  const timeline = quiz.timeline as { start_at: number; end_at: number };
  assert.equal(timeline.start_at, 2000);
  assert.equal(timeline.end_at, 10_000);
});
