// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  defaultFlowPauseAtMs,
  findFlowPauseCrossing,
  getSceneFlowPauseMarkers,
  normalizeSlideFlowPausePoints,
  resolveFlowPauseResumePlayheadMs,
} from "./slide-flow-pause.ts";
import type { SlideElement } from "./elements.ts";

describe("normalizeSlideFlowPausePoints", () => {
  it("dedupes points at the same time bucket", () => {
    const normalized = normalizeSlideFlowPausePoints(
      [
        { pause_id: "a", at_ms: 1000 },
        { pause_id: "b", at_ms: 1020 },
      ],
      10_000,
    );
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.pause_id).toBe("a");
  });

  it("clamps to slide duration", () => {
    const normalized = normalizeSlideFlowPausePoints(
      [{ pause_id: "a", at_ms: 12_000 }],
      10_000,
    );
    expect(normalized[0]?.at_ms).toBe(10_000);
  });
});

describe("defaultFlowPauseAtMs", () => {
  it("returns slide tail", () => {
    expect(defaultFlowPauseAtMs(8000)).toBe(8000);
  });
});

describe("findFlowPauseCrossing", () => {
  const points = [{ pause_id: "p1", at_ms: 5000 }];

  it("detects forward crossing", () => {
    expect(findFlowPauseCrossing(points, 4800, 5100)).toEqual(points[0]);
  });

  it("ignores when already past", () => {
    expect(findFlowPauseCrossing(points, 5200, 5400)).toBeNull();
  });

  it("ignores acknowledged pause points", () => {
    expect(findFlowPauseCrossing(points, 4800, 5100, new Set([5000]))).toBeNull();
  });
});

describe("resolveFlowPauseResumePlayheadMs", () => {
  it("acknowledges and nudges playhead past the pause", () => {
    const acknowledged = new Set<number>();
    const points = [{ pause_id: "p1", at_ms: 5000 }];
    const resumeAt = resolveFlowPauseResumePlayheadMs(points, 5000, 10_000, acknowledged);
    expect(resumeAt).toBeGreaterThan(5000);
    expect(acknowledged.has(5000)).toBe(true);
  });
});

describe("getSceneFlowPauseMarkers", () => {
  const slide = (durationMs: number, pauseAt?: number): SlideElement =>
    ({
      timeline: { start_at: 0, end_at: durationMs },
      flow_pause_points: pauseAt != null ? [{ pause_id: "p", at_ms: pauseAt }] : undefined,
    }) as SlideElement;

  it("flattens pause points across slides with scene offsets", () => {
    const markers = getSceneFlowPauseMarkers([
      slide(10_000, 2000),
      slide(5000, 1000),
    ]);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ scene_time_ms: 2000, slide_index: 0, ratio: 2000 / 15_000 });
    expect(markers[1]).toMatchObject({ scene_time_ms: 11_000, slide_index: 1, ratio: 11_000 / 15_000 });
  });
});
