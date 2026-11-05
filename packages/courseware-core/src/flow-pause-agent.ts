// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, QuizSlideElement, SlideElement } from "./elements.ts";
import {
  computeElementEnterExitEffectVisual,
  getEnterEffectCompletionTime,
  getOpacityIntroRampEndAt,
  getQuizQuestionPlaybackPauseStartAt,
  interpolateElementTransform,
} from "./elements.ts";
import { FLOW_PAUSE_TIME_EPSILON_MS, clampFlowPauseAtMs, timelineMsToSlideLocal } from "./slide-flow-pause.ts";

export const FLOW_PAUSE_DISALLOWED_ELEMENT_TYPES = new Set(["quiz", "quiz_score_summary"]);

/**
 * Flow pause `--when end` (default): placed at the element's `timeline.end_at`, pausing after that content block finishes.
 * `--when start`: after the element is fully visible (counting fade-in keyframes / enter_effect); only for the few cases that must stop before viewing.
 */
export const getFlowPauseElementVisibleStartAt = (
  slide: SlideElement,
  element: Element,
): number => {
  const t0 = element.timeline.start_at;
  const tEnd = element.timeline.end_at;
  const opacityAt = (t: number): number => {
    const base = interpolateElementTransform(element, t).opacity;
    const fx = computeElementEnterExitEffectVisual(element, slide, t).opacityFactor;
    return base * fx;
  };
  const introRampEnd = getOpacityIntroRampEndAt(opacityAt, element.keyframes, t0, tEnd);
  let out = Math.min(introRampEnd, tEnd);
  out = Math.max(out, getEnterEffectCompletionTime(element, slide));
  return Math.min(out, tEnd);
};

/** Quiz elements pause automatically during playback; a flow pause must not fall inside their auto-pause interval. */
export const isFlowPauseAtQuizAutoPauseZone = (
  slide: SlideElement,
  atMs: number,
): boolean => {
  const pauseAbs = atMs + slide.timeline.start_at;
  for (const el of slide.children_elements) {
    if (el.element_type !== "quiz") continue;
    const wrap = el as QuizSlideElement;
    const pauseStart = getQuizQuestionPlaybackPauseStartAt(slide, wrap);
    const pauseEnd = wrap.timeline.end_at;
    if (pauseAbs + FLOW_PAUSE_TIME_EPSILON_MS >= pauseStart && pauseAbs <= pauseEnd + FLOW_PAUSE_TIME_EPSILON_MS) {
      return true;
    }
  }
  return false;
};

export const resolveFlowPauseAtMsForElement = (
  slide: SlideElement,
  element: Element,
  when: "start" | "end",
  slideDurationMs: number,
): number => {
  const raw =
    when === "end"
      ? element.timeline.end_at
      : getFlowPauseElementVisibleStartAt(slide, element);
  return clampFlowPauseAtMs(timelineMsToSlideLocal(raw, slide), slideDurationMs);
};
