// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { serializeScene } from "@ainobi/courseware-core/scene.ts";
import {
  collectCoursewareLoadIssues,
  isInvalidSceneFallback,
  loadSceneTolerantly,
  repairQuizJsonNode,
  repairSceneJsonInput,
} from "./scene-load-repair.ts";

const minimalScene = (quiz: unknown) => ({
  scene_id: "sc_test_repair",
  name: "repair-test",
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
  slide_elements: [],
  vtuber_elements: [],
  audio_elements: [],
  quiz,
});

describe("repairQuizJsonNode", () => {
  it("converts time_limit_seconds to time_limit_minutes", () => {
    const { value, issues } = repairQuizJsonNode({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_seconds: 300,
      questions: [],
      grade_levels: [],
    });
    expect(value).toMatchObject({ time_limit_minutes: 5 });
    expect((value as { time_limit_seconds?: unknown }).time_limit_seconds).toBeUndefined();
    expect(issues.some((i) => i.action === "converted")).toBe(true);
  });

  it("preserves exact time limits that are not multiples of six seconds", () => {
    const { value } = repairQuizJsonNode({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_seconds: 45,
      questions: [],
      grade_levels: [],
    });
    expect(value).toMatchObject({ time_limit_minutes: 0.75 });
  });

  it("strips time_limit_seconds when minutes already present", () => {
    const { value, issues } = repairQuizJsonNode({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: 10,
      time_limit_seconds: 999,
      questions: [],
      grade_levels: [],
    });
    expect(value).toMatchObject({ time_limit_minutes: 10 });
    expect(issues.some((i) => i.path.includes("time_limit_seconds"))).toBe(true);
  });

  it("keeps explicit null minutes and strips legacy seconds", () => {
    const { value, issues } = repairQuizJsonNode({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      time_limit_seconds: 90,
      questions: [],
      grade_levels: [],
    });
    expect(value).toMatchObject({ time_limit_minutes: null });
    expect((value as { time_limit_seconds?: unknown }).time_limit_seconds).toBeUndefined();
    expect(issues.some((i) => i.action === "stripped")).toBe(true);
  });

  it("strips other unknown quiz keys", () => {
    const { value, issues } = repairQuizJsonNode({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      questions: [],
      grade_levels: [],
      bogus_field: true,
    });
    expect((value as { bogus_field?: unknown }).bogus_field).toBeUndefined();
    expect(issues.some((i) => i.path.endsWith(".bogus_field"))).toBe(true);
  });
});

describe("loadSceneTolerantly", () => {
  it("loads a scene that previously failed on time_limit_seconds", () => {
    const input = minimalScene({
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_seconds: 120,
      questions: [],
      grade_levels: [],
    });
    const result = loadSceneTolerantly(input);
    expect(result.scene.quiz?.time_limit_minutes).toBe(2);
    expect(result.didRepair).toBe(true);
    expect(result.usedLenientParse).toBe(false);
    expect(collectCoursewareLoadIssues(result).length).toBeGreaterThan(0);
    // Round-trip should succeed after repair
    expect(() => serializeScene(result.scene)).not.toThrow();
  });

  it("repairs nested question time_limit_seconds", () => {
    const repaired = repairSceneJsonInput(
      minimalScene({
        enabled: true,
        total_score: 100,
        score_allocation: "even_split",
        time_limit_minutes: null,
        questions: [
          {
            question_id: "q1",
            type: "essay",
            title: "t",
            explanation: "",
            score: 10,
            required: true,
            pass_score: 0,
            advance_score: 0,
            allow_resubmit: false,
            show_feedback_score: true,
            time_limit_seconds: 90,
            content_narration_audio_url: "",
            content_narration_duration_ms: 0,
            content_narration_vtuber_element_id: "",
            react_layout: {
              kind: "element",
              tag: "QuizContainer",
              props: {},
              children: [],
            },
            reference_answer: "",
            keywords: [],
            grading_criteria: "",
          },
        ],
        grade_levels: [],
      }),
    );
    const question = (repaired.value as { quiz: { questions: Array<Record<string, unknown>> } })
      .quiz.questions[0];
    expect(question.time_limit_minutes).toBe(1.5);
    expect(question.time_limit_seconds).toBeUndefined();
  });
});

describe("isInvalidSceneFallback", () => {
  it("flags the empty fallback sentinel produced by lenient parse", () => {
    const result = loadSceneTolerantly("not-a-scene-object");
    expect(result.usedLenientParse).toBe(true);
    expect(isInvalidSceneFallback(result)).toBe(true);
  });

  it("does not flag a normally repaired scene", () => {
    const result = loadSceneTolerantly(
      minimalScene({
        enabled: true,
        total_score: 100,
        score_allocation: "even_split",
        time_limit_seconds: 120,
        questions: [],
        grade_levels: [],
      }),
    );
    expect(isInvalidSceneFallback(result)).toBe(false);
  });
});
