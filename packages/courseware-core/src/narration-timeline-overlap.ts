// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, NarrationElement, SlideElement } from "./elements.ts";
import type { Scene } from "./scene.ts";

export interface NarrationTimelineRef {
  element_id: string;
  timeline: { start_at: number; end_at: number };
}

export interface NarrationTimelineOverlapIssue {
  path: string;
  aElementId: string;
  bElementId: string;
  aStartMs: number;
  aEndMs: number;
  bStartMs: number;
  bEndMs: number;
  overlapStartMs: number;
  overlapEndMs: number;
  /** Agent-facing description (the CLI prints it). */
  message: string;
  value?: unknown;
}

/** Positive-length open interval overlap: [a.start, a.end) ∩ [b.start, b.end). */
export const narrationTimelinesOverlap = (
  a: { start_at: number; end_at: number },
  b: { start_at: number; end_at: number },
  epsilonMs = 0,
): boolean => a.start_at < b.end_at - epsilonMs && b.start_at < a.end_at - epsilonMs;

/**
 * Place the next narration after existing ones on the same slide.
 * When there are no other narrations, returns `slideStartAt`.
 */
export const resolveNextNarrationStartAt = (
  slideStartAt: number,
  existing: readonly NarrationTimelineRef[],
  options: { gapMs?: number; excludeElementId?: string } = {},
): number => {
  const gapMs = Math.max(0, options.gapMs ?? 0);
  const peers = existing.filter(
    (item) => !options.excludeElementId || item.element_id !== options.excludeElementId,
  );
  if (peers.length === 0) return slideStartAt;
  let maxEnd = slideStartAt;
  for (const peer of peers) {
    if (peer.timeline.end_at > maxEnd) maxEnd = peer.timeline.end_at;
  }
  return maxEnd + gapMs;
};

const isNarrationElement = (element: Element): element is NarrationElement =>
  element.element_type === "narration";

export const listSlideNarrationTimelineRefs = (
  slide: Pick<SlideElement, "children_elements">,
): NarrationTimelineRef[] =>
  slide.children_elements.filter(isNarrationElement).map((element) => ({
    element_id: element.element_id,
    timeline: {
      start_at: element.timeline.start_at,
      end_at: element.timeline.end_at,
    },
  }));

/**
 * Non-fatal warnings when two or more narration tracks on one slide share a time window.
 * Overlapping AI-teacher audio is almost always an authoring mistake.
 */
export const collectNarrationTimelineOverlapWarnings = (
  scene: Pick<Scene, "slide_elements">,
): NarrationTimelineOverlapIssue[] => {
  const warnings: NarrationTimelineOverlapIssue[] = [];
  scene.slide_elements.forEach((slide, slideIndex) => {
    const narrations = listSlideNarrationTimelineRefs(slide);
    if (narrations.length < 2) return;
    for (let i = 0; i < narrations.length; i += 1) {
      for (let j = i + 1; j < narrations.length; j += 1) {
        const a = narrations[i]!;
        const b = narrations[j]!;
        if (!narrationTimelinesOverlap(a.timeline, b.timeline)) continue;
        const overlapStart = Math.max(a.timeline.start_at, b.timeline.start_at);
        const overlapEnd = Math.min(a.timeline.end_at, b.timeline.end_at);
        warnings.push({
          path: `slide_elements[${slideIndex}].children_elements`,
          aElementId: a.element_id,
          bElementId: b.element_id,
          aStartMs: a.timeline.start_at,
          aEndMs: a.timeline.end_at,
          bStartMs: b.timeline.start_at,
          bEndMs: b.timeline.end_at,
          overlapStartMs: overlapStart,
          overlapEndMs: overlapEnd,
          message:
            `Narration timelines overlap on this slide (${a.element_id} [${a.timeline.start_at},${a.timeline.end_at}] ` +
            `vs ${b.element_id} [${b.timeline.start_at},${b.timeline.end_at}], overlap ${overlapStart}–${overlapEnd}ms). ` +
            `Multiple AI-teacher narrations on one page must be staggered (sequential start_at/end_at) so audio does not play together. ` +
            `Prefer \`ainobi narration insert\` (auto-staggers) or move the later track after the earlier narration.end_at.`,
          value: {
            a: a.element_id,
            b: b.element_id,
            overlap_start_ms: overlapStart,
            overlap_end_ms: overlapEnd,
          },
        });
      }
    }
  });
  return warnings;
};

/**
 * Sequentially pack overlapping narrations by original start time.
 * Earlier tracks keep their start; later overlapping tracks are pushed forward.
 * Returns null when no timeline needs to change.
 */
export const resolveStaggeredNarrationTimelines = (
  narrations: readonly NarrationTimelineRef[],
  options: { gapMs?: number } = {},
): ReadonlyMap<string, { start_at: number; end_at: number }> | null => {
  if (narrations.length < 2) return null;
  const gapMs = Math.max(0, options.gapMs ?? 0);
  const ordered = narrations
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const byStart = a.item.timeline.start_at - b.item.timeline.start_at;
      return byStart !== 0 ? byStart : a.index - b.index;
    });

  let hasOverlap = false;
  for (let i = 0; i < ordered.length && !hasOverlap; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      if (
        narrationTimelinesOverlap(ordered[i]!.item.timeline, ordered[j]!.item.timeline)
      ) {
        hasOverlap = true;
        break;
      }
    }
  }
  if (!hasOverlap) return null;

  const next = new Map<string, { start_at: number; end_at: number }>();
  let cursor = ordered[0]!.item.timeline.start_at;
  let changed = false;
  for (const { item } of ordered) {
    const duration = Math.max(1, item.timeline.end_at - item.timeline.start_at);
    const startAt = Math.max(item.timeline.start_at, cursor);
    const endAt = startAt + duration;
    if (startAt !== item.timeline.start_at || endAt !== item.timeline.end_at) {
      changed = true;
    }
    next.set(item.element_id, { start_at: startAt, end_at: endAt });
    cursor = endAt + gapMs;
  }
  return changed ? next : null;
};
