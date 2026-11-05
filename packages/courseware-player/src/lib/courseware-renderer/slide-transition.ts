// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import type { Scene, SlideElement, Transition } from "../courseware/index.ts";
import { getHyperframesSlidePlaybackDurationMs } from "./playback-timing.ts";

export const SLIDE_TRANSITION_MS = 450;

export type SlideTransitionRole = "from" | "to";

export type ResolvedHeadlessSlideTransition = {
  fromSlide: SlideElement;
  fromTime: number;
  toSlideId: string;
  transition: Transition;
  direction: 1 | -1;
  seekProgress: number;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** CSS `ease-out` approximation for transition progress. */
export const easeOutTransition = (progress: number): number => {
  const t = clamp01(progress);
  return 1 - (1 - t) * (1 - t);
};

export const transitionBetweenSlides = (
  scene: Scene,
  fromIndex: number,
  toIndex: number,
): Transition => {
  if (Math.abs(toIndex - fromIndex) !== 1) return "none";
  return scene.transitions[Math.min(fromIndex, toIndex)] ?? "none";
};

const previewTransitionDirection = (
  transition: Transition,
  direction: 1 | -1,
): "left" | "right" | "up" | "down" | null => {
  const invert = (value: "left" | "right" | "up" | "down"): "left" | "right" | "up" | "down" => {
    if (value === "left") return "right";
    if (value === "right") return "left";
    if (value === "up") return "down";
    return "up";
  };
  const base = transition.endsWith("_left")
    ? "left"
    : transition.endsWith("_right")
      ? "right"
      : transition.endsWith("_up")
        ? "up"
        : transition.endsWith("_down")
          ? "down"
          : null;
  if (!base) return null;
  return direction === 1 ? base : invert(base);
};

const oppositeTransitionDirection = (
  direction: "left" | "right" | "up" | "down",
): "left" | "right" | "up" | "down" => {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "up") return "down";
  return "up";
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const dissolveStepProgress = (progress: number): number => {
  const stepped = Math.min(11, Math.floor(clamp01(progress) * 12));
  return stepped / 11;
};

const pushTranslate = (
  direction: "left" | "right" | "up" | "down",
  percent: number,
): string => {
  if (direction === "left") return `translateX(${-percent}%)`;
  if (direction === "right") return `translateX(${percent}%)`;
  if (direction === "up") return `translateY(${-percent}%)`;
  return `translateY(${percent}%)`;
};

const wipeClipPath = (direction: "left" | "right" | "up" | "down", progress: number): string => {
  const p = clamp01(progress);
  const inset = (top: number, right: number, bottom: number, left: number): string =>
    `inset(${top}% ${right}% ${bottom}% ${left}%)`;
  if (direction === "left") return inset(0, 0, 0, lerp(100, 0, p));
  if (direction === "right") return inset(0, lerp(100, 0, p), 0, 0);
  if (direction === "up") return inset(lerp(100, 0, p), 0, 0, 0);
  return inset(0, 0, lerp(100, 0, p), 0);
};

/** Seek-driven transition styles for Hyperframes capture (no CSS animations). */
export const getHeadlessTransitionLayerStyle = (
  transition: Transition,
  role: SlideTransitionRole,
  direction: 1 | -1,
  progress: number,
): CSSProperties => {
  const t = easeOutTransition(progress);

  if (transition === "fade") {
    return role === "to" ? { opacity: t } : {};
  }
  if (transition === "cross_fade") {
    return { opacity: role === "to" ? t : 1 - t };
  }
  if (transition === "dissolve") {
    const stepped = dissolveStepProgress(progress);
    const contrast = role === "to" ? lerp(1.3, 1, stepped) : lerp(1, 1.3, stepped);
    return {
      opacity: role === "to" ? stepped : 1 - stepped,
      filter: `contrast(${contrast})`,
    };
  }
  if (transition === "zoom_in") {
    if (role === "to") {
      return {
        opacity: t,
        transform: `scale(${lerp(0.86, 1, t)})`,
      };
    }
    return {
      opacity: 1 - t,
      transform: `scale(${lerp(1, 1.08, t)})`,
    };
  }
  if (transition === "zoom_out") {
    if (role === "to") {
      return {
        opacity: t,
        transform: `scale(${lerp(1.12, 1, t)})`,
      };
    }
    return {
      opacity: 1 - t,
      transform: `scale(${lerp(1, 0.92, t)})`,
    };
  }
  if (transition.startsWith("push_")) {
    const outDirection = previewTransitionDirection(transition, direction);
    if (!outDirection) return {};
    const inDirection = oppositeTransitionDirection(outDirection);
    const activeDirection = role === "to" ? inDirection : outDirection;
    const fromPercent = role === "to" ? 100 : 0;
    const toPercent = role === "to" ? 0 : activeDirection === outDirection ? 100 : -100;
    const percent = lerp(fromPercent, toPercent, t);
    return { transform: pushTranslate(activeDirection, percent) };
  }
  if (transition.startsWith("wipe_")) {
    const wipeDirection = previewTransitionDirection(transition, direction);
    if (!wipeDirection || role === "from") return {};
    return { clipPath: wipeClipPath(wipeDirection, t) };
  }
  return {};
};

export const resolveHeadlessSlideTransition = (
  scene: Scene,
  slides: SlideElement[],
  slideIndex: number,
  localTimeMs: number,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): ResolvedHeadlessSlideTransition | null => {
  if (slideIndex <= 0) return null;
  const fromIndex = slideIndex - 1;
  const transition = transitionBetweenSlides(scene, fromIndex, slideIndex);
  if (transition === "none") return null;
  if (localTimeMs < 0 || localTimeMs >= SLIDE_TRANSITION_MS) return null;

  const fromSlide = slides[fromIndex];
  const toSlide = slides[slideIndex];
  if (!fromSlide || !toSlide) return null;

  return {
    fromSlide,
    fromTime: getHyperframesSlidePlaybackDurationMs(fromSlide, measuredNarrationDurationByUrl),
    toSlideId: toSlide.element_id,
    transition,
    direction: 1,
    seekProgress: localTimeMs / SLIDE_TRANSITION_MS,
  };
};
