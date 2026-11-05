// SPDX-License-Identifier: AGPL-3.0-only
import {
  computeElementEnterExitEffectVisual,
  getEnterEffectCompletionTime,
  interpolateElementTransformInSlide,
  isElementVisibleAtTimeInSlide,
  type Element,
  type NarrationElement,
  type NarrationSegment,
  type SlideElement,
} from "@ainobi/courseware-core/elements.ts";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

interface ResolvedNarrationStageSegment extends NarrationSegment {
  startMs: number;
  endMs: number;
}

const resolveNarrationStageSegments = (
  element: NarrationElement,
): ResolvedNarrationStageSegment[] => {
  const out: ResolvedNarrationStageSegment[] = [];
  let cursor = element.timeline.start_at;
  for (let i = 0; i < element.segments.length; i += 1) {
    const seg = element.segments[i];
    const startMs = cursor + seg.gap_ms;
    const endMs = startMs + seg.duration_ms;
    out.push({ ...seg, startMs, endMs });
    cursor = endMs;
  }
  return out;
};

/** Effective visibility after enter/exit effects (consistent with stage rendering). */
const isElementSnapshotVisibleAtTimeInSlide = (
  el: Element,
  time: number,
  slide: SlideElement,
): boolean => {
  if (!isElementVisibleAtTimeInSlide(el, time, slide)) return false;
  const transform = interpolateElementTransformInSlide(el, time, slide);
  const fx = computeElementEnterExitEffectVisual(el, slide, time);
  return transform.opacity * fx.opacityFactor > 0.01;
};

/** Advance the snapshot time past the end of the enter_effect of elements already visible at that moment. */
const offsetSnapshotTimePastVisibleEnterEffects = (
  slide: SlideElement,
  snapshotTime: number,
): number => {
  const slideStart = slide.timeline.start_at;
  const slideEnd = slide.timeline.end_at;
  const span = Math.max(0, slideEnd - slideStart);
  let offset = snapshotTime;
  for (const el of slide.children_elements) {
    if (!isElementVisibleAtTimeInSlide(el, snapshotTime, slide)) continue;
    const completion = getEnterEffectCompletionTime(el, slide);
    if (snapshotTime < completion) {
      offset = Math.max(offset, completion);
    }
  }
  return clamp(offset, 0, Math.max(0, span - 1));
};

/**
 * Pick the frame with the most visible elements among the candidate times, for the editor's slide switch preview and the standalone preview's still image.
 * On ties, frames without narration subtitles win, so thumbnails don't show extra subtitle bars.
 */
export const pickMostCompleteSnapshotTime = (slide: SlideElement): number => {
  const candidates = new Set<number>([0]);
  for (const el of slide.children_elements) {
    candidates.add(el.timeline.start_at);
    candidates.add(el.timeline.end_at);
    candidates.add(getEnterEffectCompletionTime(el, slide));
    if (el.timeline.end_at > el.timeline.start_at) {
      candidates.add((el.timeline.start_at + el.timeline.end_at) / 2);
    }
    for (const kf of el.keyframes) candidates.add(kf.at);
  }

  const sortedCandidates = [...candidates]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sortedCandidates.length === 0) return 0;

  let bestTime = sortedCandidates[0];
  let bestVisibleCount = -1;
  let bestActiveNarrationCount = Number.POSITIVE_INFINITY;
  for (const time of sortedCandidates) {
    const visibleCount = slide.children_elements.reduce((count, el) => {
      return isElementSnapshotVisibleAtTimeInSlide(el, time, slide) ? count + 1 : count;
    }, 0);

    const activeNarrationCount = slide.children_elements.reduce((count, el) => {
      if (el.element_type !== "narration") return count;
      if (!isElementSnapshotVisibleAtTimeInSlide(el, time, slide)) return count;
      const narration = el as NarrationElement;
      const activeSegment = resolveNarrationStageSegments(narration).find(
        (seg) => time >= seg.startMs && time < seg.endMs,
      );
      return activeSegment?.text?.trim() ? count + 1 : count;
    }, 0);

    if (
      visibleCount > bestVisibleCount ||
      (visibleCount === bestVisibleCount && activeNarrationCount < bestActiveNarrationCount)
    ) {
      bestVisibleCount = visibleCount;
      bestActiveNarrationCount = activeNarrationCount;
      bestTime = time;
    }
  }
  return offsetSnapshotTimePastVisibleEnterEffects(slide, bestTime);
};

/** Clamp {@link pickMostCompleteSnapshotTime} to the slide's local timeline range. */
export const clampSlideLocalSnapshotTime = (slide: SlideElement): number => {
  const span = Math.max(1, slide.timeline.end_at - slide.timeline.start_at);
  return clamp(pickMostCompleteSnapshotTime(slide), 0, span);
};
