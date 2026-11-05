// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  getOpacityIntroRampEndAt,
  getQuizQuestionPlaybackPauseStartAt,
  interpolateElementTransform,
  QUIZ_PREVIEW_ELEMENT_OPACITY_TRANSITION_MS,
  type QuizSlideElement,
  type SlideElement,
  type TextElement,
} from "./elements.ts";

describe("getOpacityIntroRampEndAt", () => {
  it("returns rangeStart when no intro ramp (flat then exit fade)", () => {
    const opacityAt = (t: number): number => {
      if (t < 9000) return 1;
      return 1 - (t - 9000) / 1000;
    };
    const keyframes = [
      { at: 5000, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, rotation_deg: 0, opacity: 1, easing: "linear" },
      { at: 9000, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, rotation_deg: 0, opacity: 1, easing: "linear" },
      { at: 10000, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, rotation_deg: 0, opacity: 0, easing: "linear" },
    ];
    expect(getOpacityIntroRampEndAt(opacityAt, keyframes, 5000, 10000)).toBe(5000);
  });

  it("returns end of first opacity-increase segment", () => {
    const keyframes = [
      { at: 5000, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, rotation_deg: 0, opacity: 0, easing: "linear" },
      { at: 6500, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, rotation_deg: 0, opacity: 1, easing: "linear" },
    ];
    const opacityAt = (t: number): number => interpolateElementTransform(minimalElement(keyframes), t).opacity;
    expect(getOpacityIntroRampEndAt(opacityAt, keyframes, 5000, 20000)).toBe(6500);
  });
});

describe("getQuizQuestionPlaybackPauseStartAt", () => {
  it("delays pause after start_at when there are no opacity keyframes (preview CSS fade)", () => {
    const member: TextElement = {
      element_type: "text",
      element_id: "m1",
      name: "card",
      html: "",
      fps: 30,
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      timeline: { start_at: 0, end_at: 30_000 },
      style: { opacity: 1, rotation_deg: 0, z_index: 1 },
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
      text: "Q",
      font_family: "sans-serif",
      font_size: 24,
      color: "#fff",
      align: "left",
      bold: false,
      italic: undefined,
      text_background_color: undefined,
    };

    const wrapper: QuizSlideElement = {
      element_type: "quiz",
      element_id: "q1",
      name: "Q",
      html: "",
      fps: 30,
      position: { x: 0, y: 0 },
      size: { width: 1200, height: 800 },
      timeline: { start_at: 0, end_at: 25_000 },
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
      quiz_question_id: "qq1",
    };

    const slide: SlideElement = {
      element_type: "slide",
      element_id: "slide1",
      name: "S",
      fps: 30,
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      timeline: { start_at: 0, end_at: 30_000 },
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
      children_elements: [wrapper, member],
    };

    expect(getQuizQuestionPlaybackPauseStartAt(slide, wrapper)).toBe(QUIZ_PREVIEW_ELEMENT_OPACITY_TRANSITION_MS);
  });

  it("uses the quiz element's own intro opacity ramp when present", () => {
    const wrapper: QuizSlideElement = {
      element_type: "quiz",
      element_id: "q1",
      name: "Q",
      html: "",
      fps: 30,
      position: { x: 0, y: 0 },
      size: { width: 1200, height: 800 },
      timeline: { start_at: 2000, end_at: 25_000 },
      style: { opacity: 1, rotation_deg: 0, z_index: 0 },
      enter_effect: "none",
      exit_effect: "none",
      animations: [],
      keyframes: [
        { at: 2000, position: { x: 0, y: 0 }, size: { width: 1200, height: 800 }, rotation_deg: 0, opacity: 0, easing: "linear" },
        { at: 3500, position: { x: 0, y: 0 }, size: { width: 1200, height: 800 }, rotation_deg: 0, opacity: 1, easing: "linear" },
      ],
      highlight_segments: [],
      event_bindings: [],
      action_mappings: {},
      event_scripts: {},
      preset_script: "",
      metadata: {},
      quiz_question_id: "qq1",
    };

    const slide: SlideElement = {
      element_type: "slide",
      element_id: "slide1",
      name: "S",
      fps: 30,
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      timeline: { start_at: 0, end_at: 30_000 },
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
      children_elements: [wrapper],
    };

    expect(getQuizQuestionPlaybackPauseStartAt(slide, wrapper)).toBe(3500);
  });
});

function minimalElement(
  keyframes: {
    at: number;
    position: { x: number; y: number };
    size: { width: number; height: number };
    rotation_deg: number;
    opacity: number;
    easing: string;
  }[],
): TextElement {
  return {
    element_type: "text",
    element_id: "t",
    name: "t",
    html: "",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    timeline: { start_at: 0, end_at: 30_000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 0 },
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes,
    highlight_segments: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: {},
    text: "",
    font_family: "sans-serif",
    font_size: 24,
    color: "#fff",
    align: "left",
    bold: false,
    italic: undefined,
    text_background_color: undefined,
  };
}
