// SPDX-License-Identifier: AGPL-3.0-only
/** Edge snapping while dragging timeline element bars (aligning to other elements' enter/exit times) */

export type TimelineSnapSource =
  | "slide-edge"
  | "slide-center"
  | "peer"
  | "playhead"
  | "narration-segment";

/** Narration track: used to compute the absolute time of each sentence (segment) start */
export type NarrationTimelineSnapInput = {
  element_id: string;
  timeline_start_at: number;
  segments: readonly { gap_ms: number; duration_ms: number }[];
};

export type TimelineSnapTarget = {
  positionMs: number;
  source: TimelineSnapSource;
};

export type TimelineSnapGuide = {
  positionMs: number;
  source: TimelineSnapSource;
};

export type TimelineBarDragKind = "move" | "left" | "right";

/** The usual snap threshold of element bars / canvas center axes (milliseconds) */
export const EDITOR_TIMELINE_SNAP_THRESHOLD_MS = 80;
/** Snap threshold of the slide's start/end edges (milliseconds) */
export const EDITOR_TIMELINE_SNAP_SLIDE_EDGE_THRESHOLD_MS = 140;

/** Absolute times of each narration segment start (after the gap, where the audio body begins) */
export function listNarrationSentenceStartTargets(
  narrations: readonly NarrationTimelineSnapInput[],
): TimelineSnapTarget[] {
  const targets: TimelineSnapTarget[] = [];
  for (const narration of narrations) {
    let cursor = narration.timeline_start_at;
    for (const seg of narration.segments) {
      cursor += seg.gap_ms;
      targets.push({ positionMs: cursor, source: "narration-segment" });
      cursor += seg.duration_ms;
    }
  }
  return targets;
}

export function collectTimelineSnapTargets(args: {
  slideStart: number;
  slideEnd: number;
  peers: readonly { element_id: string; start_at: number; end_at: number }[];
  excludeElementId: string;
  playheadMs?: number;
  narrations?: readonly NarrationTimelineSnapInput[];
}): TimelineSnapTarget[] {
  const byPos = new Map<number, TimelineSnapTarget>();

  const upsert = (positionMs: number, source: TimelineSnapSource): void => {
    const existing = byPos.get(positionMs);
    if (!existing || sourcePriority(source) > sourcePriority(existing.source)) {
      byPos.set(positionMs, { positionMs, source });
    }
  };

  upsert(args.slideStart, "slide-edge");
  upsert(args.slideEnd, "slide-edge");
  upsert((args.slideStart + args.slideEnd) / 2, "slide-center");

  if (args.playheadMs !== undefined) {
    upsert(args.playheadMs, "playhead");
  }

  for (const peer of args.peers) {
    if (peer.element_id === args.excludeElementId) continue;
    upsert(peer.start_at, "peer");
    upsert(peer.end_at, "peer");
  }

  if (args.narrations?.length) {
    for (const segTarget of listNarrationSentenceStartTargets(args.narrations)) {
      upsert(segTarget.positionMs, segTarget.source);
    }
  }

  return [...byPos.values()].sort((a, b) => a.positionMs - b.positionMs);
}

function sourcePriority(source: TimelineSnapSource): number {
  switch (source) {
    case "slide-edge":
      return 4;
    case "playhead":
      return 3;
    case "slide-center":
      return 2;
    case "narration-segment":
      return 2;
    case "peer":
      return 1;
  }
}

function thresholdForSource(source: TimelineSnapSource, baseThresholdMs: number): number {
  if (source === "slide-edge") return EDITOR_TIMELINE_SNAP_SLIDE_EDGE_THRESHOLD_MS;
  if (source === "playhead") return Math.max(baseThresholdMs, 100);
  return baseThresholdMs;
}

/** Snap a single time anchor to the nearest target line */
export function snapTimelineAnchorMs(
  anchorMs: number,
  targets: readonly TimelineSnapTarget[],
  baseThresholdMs = EDITOR_TIMELINE_SNAP_THRESHOLD_MS,
): { snappedMs: number; guide: TimelineSnapGuide | null } {
  let bestScore = Number.POSITIVE_INFINITY;
  let bestOffset = 0;
  let bestTarget: TimelineSnapTarget | null = null;

  for (const target of targets) {
    const dist = Math.abs(anchorMs - target.positionMs);
    const threshold = thresholdForSource(target.source, baseThresholdMs);
    if (dist > threshold) continue;
    const weight =
      target.source === "slide-edge"
        ? 0.55
        : target.source === "playhead"
          ? 0.75
          : target.source === "narration-segment"
            ? 0.82
            : 1;
    const score = dist * weight;
    if (score < bestScore) {
      bestScore = score;
      bestOffset = target.positionMs - anchorMs;
      bestTarget = target;
    }
  }

  if (!bestTarget) {
    return { snappedMs: anchorMs, guide: null };
  }

  return {
    snappedMs: anchorMs + bestOffset,
    guide: { positionMs: bestTarget.positionMs, source: bestTarget.source },
  };
}

/** Snap an element bar's start/end times by the drag type */
export function snapElementTimelineDrag(
  kind: TimelineBarDragKind,
  proposedStart: number,
  proposedEnd: number,
  targets: readonly TimelineSnapTarget[],
  baseThresholdMs = EDITOR_TIMELINE_SNAP_THRESHOLD_MS,
): { start_at: number; end_at: number; guides: TimelineSnapGuide[] } {
  if (kind === "move") {
    const span = proposedEnd - proposedStart;
    const { snappedMs, guide } = snapTimelineAnchorMs(proposedStart, targets, baseThresholdMs);
    return {
      start_at: snappedMs,
      end_at: snappedMs + span,
      guides: guide ? [guide] : [],
    };
  }
  if (kind === "left") {
    const { snappedMs, guide } = snapTimelineAnchorMs(proposedStart, targets, baseThresholdMs);
    return {
      start_at: snappedMs,
      end_at: proposedEnd,
      guides: guide ? [guide] : [],
    };
  }
  const { snappedMs, guide } = snapTimelineAnchorMs(proposedEnd, targets, baseThresholdMs);
  return {
    start_at: proposedStart,
    end_at: snappedMs,
    guides: guide ? [guide] : [],
  };
}
