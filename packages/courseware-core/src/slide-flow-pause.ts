// SPDX-License-Identifier: AGPL-3.0-only
import type { SlideElement } from "./elements.ts";

/** Flow pause point: a stop on the slide's local timeline (ms, 0 = slide start). */
export interface SlideFlowPausePoint {
  pause_id: string;
  at_ms: number;
}

/** Only one pause point is allowed at a time (dedupe/snap tolerance). */
export const FLOW_PAUSE_TIME_EPSILON_MS = 50;

/** After the user continues, the playhead must pass the pause point by this many ms, so it doesn't stop again on the same frame. */
export const FLOW_PAUSE_RESUME_GRACE_MS = 32;

export const FLOW_PAUSE_DRAG_STEP_MS = 10;

export const getSlideLocalDurationMs = (
  slide: Pick<SlideElement, "timeline">,
): number => Math.max(1, slide.timeline.end_at - slide.timeline.start_at);

export const clampFlowPauseAtMs = (atMs: number, slideDurationMs: number): number =>
  Math.min(Math.max(0, Math.round(atMs)), Math.max(0, slideDurationMs));

/**
 * Normalize pause points: clamp them to the slide duration and dedupe by {@link FLOW_PAUSE_TIME_EPSILON_MS}.
 */
export const normalizeSlideFlowPausePoints = (
  points: SlideFlowPausePoint[] | undefined,
  slideDurationMs: number,
): SlideFlowPausePoint[] => {
  if (!points?.length) return [];
  const byBucket = new Map<number, SlideFlowPausePoint>();
  for (const point of points) {
    const atMs = clampFlowPauseAtMs(point.at_ms, slideDurationMs);
    const bucket =
      Math.round(atMs / FLOW_PAUSE_TIME_EPSILON_MS) * FLOW_PAUSE_TIME_EPSILON_MS;
    if (!byBucket.has(bucket)) {
      byBucket.set(bucket, { ...point, at_ms: atMs });
    }
  }
  return [...byBucket.values()].sort((a, b) => a.at_ms - b.at_ms);
};

/** A new pause point defaults to the end of the slide (slide-local time). */
export const defaultFlowPauseAtMs = (slideDurationMs: number): number =>
  Math.max(0, slideDurationMs);

export const getSlideFlowPausePoints = (
  slide: Pick<SlideElement, "flow_pause_points" | "timeline">,
): SlideFlowPausePoint[] =>
  normalizeSlideFlowPausePoints(
    slide.flow_pause_points,
    getSlideLocalDurationMs(slide),
  );

/**
 * Return the pause point crossed during forward playback (used to stop there).
 * Points in `acknowledgedAtMs` count as already continued by the user and do not stop again.
 */
export const findFlowPauseCrossing = (
  points: readonly SlideFlowPausePoint[],
  prevMs: number,
  nextMs: number,
  acknowledgedAtMs: ReadonlySet<number> = new Set(),
): SlideFlowPausePoint | null => {
  for (const point of points) {
    if (acknowledgedAtMs.has(point.at_ms)) continue;
    if (prevMs < point.at_ms - 0.5 && nextMs >= point.at_ms - 0.5) {
      return point;
    }
  }
  return null;
};

/** On continue: if the playhead is near a pause point, mark it acknowledged and return the suggested resume position (just past the point). */
export const resolveFlowPauseResumePlayheadMs = (
  points: readonly SlideFlowPausePoint[],
  playheadMs: number,
  slideDurationMs: number,
  acknowledgedAtMs: Set<number>,
): number => {
  let resumeAt = playheadMs;
  for (const point of points) {
    if (Math.abs(playheadMs - point.at_ms) > FLOW_PAUSE_TIME_EPSILON_MS) continue;
    acknowledgedAtMs.add(point.at_ms);
    resumeAt = Math.min(
      slideDurationMs,
      point.at_ms + FLOW_PAUSE_RESUME_GRACE_MS,
    );
  }
  return resumeAt;
};

/** When dragging/jumping to before a pause point, clear that point's acknowledged mark (it stops again). */
export const syncFlowPauseAcknowledgementsOnSeek = (
  points: readonly SlideFlowPausePoint[],
  playheadMs: number,
  acknowledgedAtMs: Set<number>,
): void => {
  for (const point of points) {
    if (playheadMs < point.at_ms - FLOW_PAUSE_TIME_EPSILON_MS) {
      acknowledgedAtMs.delete(point.at_ms);
    }
  }
};

/** Flow pause points on the whole-scene progress bar (each slide's flow_pause_points flattened). */
export type SceneFlowPauseMarker = {
  pause_id: string;
  slide_index: number;
  /** Slide-local time (ms) */
  at_ms: number;
  /** Position on the whole-scene timeline (ms) */
  scene_time_ms: number;
  /** Fraction of the whole scene's total duration (0–1) */
  ratio: number;
};

export const getSceneFlowPauseMarkers = (
  slides: readonly SlideElement[],
): SceneFlowPauseMarker[] => {
  const durations = slides.map((slide) => getSlideLocalDurationMs(slide));
  const total = Math.max(1, durations.reduce((acc, duration) => acc + duration, 0));
  let offset = 0;
  const markers: SceneFlowPauseMarker[] = [];
  for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
    const slide = slides[slideIndex]!;
    for (const point of getSlideFlowPausePoints(slide)) {
      const sceneTimeMs = offset + point.at_ms;
      markers.push({
        pause_id: point.pause_id,
        slide_index: slideIndex,
        at_ms: point.at_ms,
        scene_time_ms: sceneTimeMs,
        ratio: Math.min(1, Math.max(0, sceneTimeMs / total)),
      });
    }
    offset += durations[slideIndex]!;
  }
  return markers;
};

export const remapSlideFlowPausePoints = (
  points: SlideFlowPausePoint[] | undefined,
  slideDurationMs: number,
): SlideFlowPausePoint[] | undefined => {
  const next = normalizeSlideFlowPausePoints(points, slideDurationMs);
  return next.length > 0 ? next : undefined;
};

/** Element / slide timelines share absolute scene time; flow_pause_points are slide-local. */
export const timelineMsToSlideLocal = (
  atMs: number,
  slide: Pick<SlideElement, "timeline">,
): number => atMs - slide.timeline.start_at;

export const remapSlideFlowPausePointsOnDurationChange = (
  slide: {
    timeline?: { start_at?: number; end_at?: number };
    flow_pause_points?: SlideFlowPausePoint[];
  },
  previousTimeline: { start_at?: number; end_at?: number },
): void => {
  const prevDur = Math.max(1, Number(previousTimeline.end_at ?? 0) - Number(previousTimeline.start_at ?? 0));
  const nextTimeline = slide.timeline ?? {};
  const nextDur = Math.max(1, Number(nextTimeline.end_at ?? 0) - Number(nextTimeline.start_at ?? 0));
  if (nextDur === prevDur) return;
  slide.flow_pause_points = remapSlideFlowPausePoints(slide.flow_pause_points, nextDur);
};
