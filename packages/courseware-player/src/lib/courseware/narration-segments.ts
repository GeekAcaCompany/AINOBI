// SPDX-License-Identifier: AGPL-3.0-only
import type { NarrationElement, NarrationSegment } from "@ainobi/courseware-core/elements.ts";

export interface ResolvedNarrationSegment extends NarrationSegment {
  startMs: number;
  endMs: number;
  index: number;
  /** duration_ms from the JSON (without playback-time correction). */
  storedDurationMs: number;
}

const normalizeMeasuredDurationMs = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
};

/** Look up the narration audio duration in the measured table (URLs before/after presign / blob match as equivalent). */
export function lookupMeasuredNarrationDurationMs(
  url: string,
  measuredDurationByUrl: Readonly<Record<string, number>> = {},
): number {
  const key = url.trim();
  if (!key) return 0;
  const direct = normalizeMeasuredDurationMs(measuredDurationByUrl[key]);
  if (direct > 0) return direct;
  for (const [storedKey, value] of Object.entries(measuredDurationByUrl)) {
    if (!narrationAudioUrlsEquivalent(key, storedKey)) continue;
    const ms = normalizeMeasuredDurationMs(value);
    if (ms > 0) return ms;
  }
  return 0;
}

/**
 * Expand a slide's narration segments onto the absolute timeline.
 * With `measuredDurationByUrl`, take max(stored, measured), fixing truncation caused by short metadata.
 */
export function resolveNarrationSegments(
  element: NarrationElement,
  measuredDurationByUrl: Readonly<Record<string, number>> = {},
): ResolvedNarrationSegment[] {
  const out: ResolvedNarrationSegment[] = [];
  let cursor = element.timeline.start_at;
  for (let i = 0; i < element.segments.length; i += 1) {
    const seg = element.segments[i];
    const measured = lookupMeasuredNarrationDurationMs(seg.audio_url, measuredDurationByUrl);
    const effectiveDurationMs = Math.max(seg.duration_ms, measured);
    const startMs = cursor + seg.gap_ms;
    const endMs = startMs + effectiveDurationMs;
    out.push({
      ...seg,
      startMs,
      endMs,
      index: i,
      storedDurationMs: seg.duration_ms,
    });
    cursor = endMs;
  }
  return out;
}

/**
 * The Hyperframes export timeline: uses measured durations and inserts no gap_ms between segments.
 * During playback the next segment is queued as soon as the previous ends; if the export kept the gaps, the output would alternate silence between sentences.
 */
export function resolveNarrationSegmentsForHyperframes(
  element: NarrationElement,
  measuredDurationByUrl: Readonly<Record<string, number>> = {},
): ResolvedNarrationSegment[] {
  const out: ResolvedNarrationSegment[] = [];
  let cursor = element.timeline.start_at;
  for (let i = 0; i < element.segments.length; i += 1) {
    const seg = element.segments[i];
    if (!seg.audio_url?.trim()) continue;
    const measured = lookupMeasuredNarrationDurationMs(seg.audio_url, measuredDurationByUrl);
    const effectiveDurationMs = Math.max(seg.duration_ms, measured);
    if (effectiveDurationMs <= 0) continue;
    const startMs = i === 0 ? cursor + seg.gap_ms : cursor;
    const endMs = startMs + effectiveDurationMs;
    out.push({
      ...seg,
      startMs,
      endMs,
      index: i,
      storedDurationMs: seg.duration_ms,
    });
    cursor = endMs;
  }
  return out;
}

const findSegmentAtTime = (
  resolved: readonly ResolvedNarrationSegment[],
  timeMs: number,
): number => {
  for (const seg of resolved) {
    if (timeMs >= seg.startMs && timeMs < seg.endMs) return seg.index;
  }
  return -1;
};

const findNextSegmentAfterTime = (
  resolved: readonly ResolvedNarrationSegment[],
  timeMs: number,
): number => {
  for (const seg of resolved) {
    if (timeMs < seg.startMs) return seg.index;
  }
  return -1;
};

/** Timeline position → the segment index to load/commit (inside a gap, the next segment about to play). */
export function syncCommittedIndexFromTime(
  resolved: readonly ResolvedNarrationSegment[],
  timeMs: number,
): number {
  const at = findSegmentAtTime(resolved, timeMs);
  if (at >= 0) return at;
  const next = findNextSegmentAfterTime(resolved, timeMs);
  if (next >= 0) return next;
  return resolved.length > 0 ? resolved.length - 1 : -1;
}

/** The narration segment at a timeline position; -1 means a gap or outside the segments. */
export function findNarrationSegmentIndexAtTime(
  resolved: readonly ResolvedNarrationSegment[],
  timeMs: number,
): number {
  return findSegmentAtTime(resolved, timeMs);
}

/**
 * The narration segment index that should be mounted while playing.
 * - inside a segment: findAtTime
 * - paused / gap (before or between segments): keep the committed segment's src warm, avoiding an empty-src reload
 */
export function resolveActiveNarrationSegmentIndex(
  resolved: readonly ResolvedNarrationSegment[],
  timeMs: number,
  _isPlaying: boolean,
  committedIndex: number,
): number {
  const at = findSegmentAtTime(resolved, timeMs);
  if (at >= 0) return at;
  if (committedIndex >= 0 && committedIndex < resolved.length) {
    return committedIndex;
  }
  return -1;
}

/** Whether URLs before/after presign point at the same narration segment audio. */
export function narrationAudioUrlsEquivalent(storedUrl: string, playbackUrl: string): boolean {
  const a = storedUrl.trim();
  const b = playbackUrl.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const aPath = new URL(a, window.location.origin).pathname;
    const bPath = new URL(b, window.location.origin).pathname;
    if (aPath === bPath) return true;
    const aBase = aPath.split("/").pop() ?? "";
    const bBase = bPath.split("/").pop() ?? "";
    return aBase.length > 0 && aBase === bBase;
  } catch {
    return a.endsWith(b) || b.endsWith(a);
  }
}
