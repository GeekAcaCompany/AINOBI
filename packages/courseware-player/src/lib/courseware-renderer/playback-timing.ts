// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, GroupElement, HtmlElement, NarrationElement, SlideElement } from "../courseware/index.ts";
import { resolveNarrationSegmentsForHyperframes } from "../courseware/narration-segments.ts";

export const getSlidePlaybackDurationMs = (slide: SlideElement): number =>
  Math.max(1, slide.timeline.end_at - slide.timeline.start_at);

function walkSlideElements(slide: SlideElement, visit: (element: Element) => void): void {
  const walk = (nodes: Element[]): void => {
    for (const element of nodes) {
      visit(element);
      if (element.element_type === "group") {
        walk((element as GroupElement).children_elements);
      } else if (element.element_type === "html") {
        walk((element as HtmlElement).children_elements);
      }
    }
  };
  walk(slide.children_elements);
}

/** Latest narration segment end (slide-local ms) for Hyperframes scene timing. */
export const getSlideNarrationEndMs = (
  slide: SlideElement,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): number => {
  let endMs = 0;
  walkSlideElements(slide, (element) => {
    if (element.element_type !== "narration") return;
    const segments = resolveNarrationSegmentsForHyperframes(
      element as NarrationElement,
      measuredNarrationDurationByUrl,
    );
    for (const seg of segments) {
      if (seg.endMs > endMs) endMs = seg.endMs;
    }
  });
  return endMs;
};

/** Hyperframes seek/mux: slide stays active until narration finishes, not only timeline.end_at. */
export const getHyperframesSlidePlaybackDurationMs = (
  slide: SlideElement,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): number =>
  Math.max(
    1,
    getSlidePlaybackDurationMs(slide),
    getSlideNarrationEndMs(slide, measuredNarrationDurationByUrl),
  );

export const getHyperframesSlideDurationsMs = (
  slides: SlideElement[],
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): number[] =>
  slides.map((slide) => getHyperframesSlidePlaybackDurationMs(slide, measuredNarrationDurationByUrl));

export const getHyperframesSceneTotalDurationMs = (
  slides: SlideElement[],
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): number => {
  const durations = getHyperframesSlideDurationsMs(slides, measuredNarrationDurationByUrl);
  if (durations.length === 0) return 1;
  return Math.max(1, durations.reduce((acc, durationMs) => acc + durationMs, 0));
};

export const getHyperframesSceneSlideOffsetMs = (
  slides: SlideElement[],
  slideIndex: number,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): number => {
  let acc = 0;
  for (let i = 0; i < slideIndex; i += 1) {
    const slide = slides[i];
    if (!slide) continue;
    acc += getHyperframesSlidePlaybackDurationMs(slide, measuredNarrationDurationByUrl);
  }
  return acc;
};

export const getSlideDurationsMs = (slides: SlideElement[]): number[] =>
  slides.map((s) => getSlidePlaybackDurationMs(s));

export const getSceneTotalDurationMs = (slides: SlideElement[]): number => {
  const durations = getSlideDurationsMs(slides);
  if (durations.length === 0) return 1;
  return Math.max(1, durations.reduce((acc, d) => acc + d, 0));
};

export const getSceneSlideOffsetMs = (slides: SlideElement[], slideIndex: number): number => {
  let acc = 0;
  for (let i = 0; i < slideIndex; i += 1) {
    const s = slides[i];
    if (!s) continue;
    acc += getSlidePlaybackDurationMs(s);
  }
  return acc;
};

export const getScenePlayheadMs = (
  slides: SlideElement[],
  slideIndex: number,
  localTimeMs: number,
): number => getSceneSlideOffsetMs(slides, slideIndex) + localTimeMs;

export type SceneTimeLocation = { slideIndex: number; localTimeMs: number };

/** Map scene-wide time (ms) to slide index + slide-local time. */
export const resolveSceneTimeMs = (
  slides: SlideElement[],
  sceneTimeMs: number,
): SceneTimeLocation => {
  const n = slides.length;
  if (n === 0) {
    return { slideIndex: 0, localTimeMs: 0 };
  }

  let remaining = Math.max(0, sceneTimeMs);
  for (let i = 0; i < n; i += 1) {
    const slide = slides[i];
    if (!slide) {
      continue;
    }
    const dur = getSlidePlaybackDurationMs(slide);
    if (remaining < dur || i === n - 1) {
      return { slideIndex: i, localTimeMs: Math.min(Math.max(0, remaining), dur) };
    }
    remaining -= dur;
  }

  const last = n - 1;
  const lastSlide = slides[last];
  return {
    slideIndex: last,
    localTimeMs: lastSlide ? getSlidePlaybackDurationMs(lastSlide) : 0,
  };
};

/** Map scene-wide time (ms) to slide index + slide-local time using narration-extended slide durations. */
export const resolveHyperframesSceneTimeMs = (
  slides: SlideElement[],
  sceneTimeMs: number,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): SceneTimeLocation => {
  const n = slides.length;
  if (n === 0) {
    return { slideIndex: 0, localTimeMs: 0 };
  }

  let remaining = Math.max(0, sceneTimeMs);
  for (let i = 0; i < n; i += 1) {
    const slide = slides[i];
    if (!slide) {
      continue;
    }
    const dur = getHyperframesSlidePlaybackDurationMs(slide, measuredNarrationDurationByUrl);
    if (remaining < dur || i === n - 1) {
      return { slideIndex: i, localTimeMs: Math.min(Math.max(0, remaining), dur) };
    }
    remaining -= dur;
  }

  const last = n - 1;
  const lastSlide = slides[last];
  return {
    slideIndex: last,
    localTimeMs: lastSlide
      ? getHyperframesSlidePlaybackDurationMs(lastSlide, measuredNarrationDurationByUrl)
      : 0,
  };
};
