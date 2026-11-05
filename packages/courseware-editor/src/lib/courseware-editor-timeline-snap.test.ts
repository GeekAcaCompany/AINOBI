// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  collectTimelineSnapTargets,
  listNarrationSentenceStartTargets,
  snapElementTimelineDrag,
  snapTimelineAnchorMs,
} from "./courseware-editor-timeline-snap.ts";

describe("snapTimelineAnchorMs", () => {
  it("snaps start to slide left edge", () => {
    const targets = collectTimelineSnapTargets({
      slideStart: 0,
      slideEnd: 10_000,
      peers: [],
      excludeElementId: "a",
    });
    const { snappedMs, guide } = snapTimelineAnchorMs(55, targets, 80);
    expect(snappedMs).toBe(0);
    expect(guide).toEqual({ positionMs: 0, source: "slide-edge" });
  });

  it("snaps to peer element start", () => {
    const targets = collectTimelineSnapTargets({
      slideStart: 0,
      slideEnd: 10_000,
      peers: [{ element_id: "b", start_at: 2000, end_at: 4000 }],
      excludeElementId: "a",
    });
    const { snappedMs, guide } = snapTimelineAnchorMs(2050, targets, 80);
    expect(snappedMs).toBe(2000);
    expect(guide).toEqual({ positionMs: 2000, source: "peer" });
  });
});

describe("listNarrationSentenceStartTargets", () => {
  it("lists each segment sentence start after gap", () => {
    const targets = listNarrationSentenceStartTargets([
      {
        element_id: "n1",
        timeline_start_at: 1000,
        segments: [
          { gap_ms: 200, duration_ms: 3000 },
          { gap_ms: 500, duration_ms: 2500 },
        ],
      },
    ]);
    expect(targets.map((t) => t.positionMs)).toEqual([1200, 4700]);
    expect(targets.every((t) => t.source === "narration-segment")).toBe(true);
  });
});

describe("snapElementTimelineDrag", () => {
  it("preserves span on move snap", () => {
    const targets = collectTimelineSnapTargets({
      slideStart: 0,
      slideEnd: 10_000,
      peers: [{ element_id: "b", start_at: 3000, end_at: 5000 }],
      excludeElementId: "a",
    });
    const result = snapElementTimelineDrag("move", 3070, 5070, targets, 80);
    expect(result.start_at).toBe(3000);
    expect(result.end_at).toBe(5000);
    expect(result.guides).toHaveLength(1);
  });

  it("snaps move start to narration segment sentence start", () => {
    const targets = collectTimelineSnapTargets({
      slideStart: 0,
      slideEnd: 20_000,
      peers: [],
      excludeElementId: "txt",
      narrations: [
        {
          element_id: "n1",
          timeline_start_at: 1000,
          segments: [
            { gap_ms: 0, duration_ms: 3000 },
            { gap_ms: 0, duration_ms: 2000 },
          ],
        },
      ],
    });
    const result = snapElementTimelineDrag("move", 4050, 5050, targets, 80);
    expect(result.start_at).toBe(4000);
    expect(result.guides.some((g) => g.source === "narration-segment" && g.positionMs === 4000)).toBe(
      true,
    );
  });

  it("snaps end on right resize", () => {
    const targets = collectTimelineSnapTargets({
      slideStart: 0,
      slideEnd: 10_000,
      peers: [{ element_id: "b", start_at: 1000, end_at: 6000 }],
      excludeElementId: "a",
    });
    const result = snapElementTimelineDrag("right", 1000, 6040, targets, 80);
    expect(result.end_at).toBe(6000);
    expect(result.start_at).toBe(1000);
  });
});
