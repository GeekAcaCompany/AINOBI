// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Scene } from "./scene.ts";
import {
  collectNarrationTimelineOverlapWarnings,
  resolveNextNarrationStartAt,
  resolveStaggeredNarrationTimelines,
} from "./narration-timeline-overlap.ts";

describe("narration-timeline-overlap", () => {
  it("staggers after the latest narration end", () => {
    expect(
      resolveNextNarrationStartAt(0, [
        { element_id: "n1", timeline: { start_at: 0, end_at: 4200 } },
      ]),
    ).toBe(4200);
  });

  it("warns when narrations overlap on a slide", () => {
    const scene = {
      slide_elements: [
        {
          children_elements: [
            {
              element_type: "narration",
              element_id: "n_a",
              timeline: { start_at: 0, end_at: 5000 },
            },
            {
              element_type: "narration",
              element_id: "n_b",
              timeline: { start_at: 2500, end_at: 7000 },
            },
          ],
        },
      ],
    } as unknown as Scene;
    const warnings = collectNarrationTimelineOverlapWarnings(scene);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      aElementId: "n_a",
      bElementId: "n_b",
      overlapStartMs: 2500,
      overlapEndMs: 5000,
    });
  });

  it("does not warn for sequential narrations", () => {
    const scene = {
      slide_elements: [
        {
          children_elements: [
            {
              element_type: "narration",
              element_id: "n_a",
              timeline: { start_at: 0, end_at: 5000 },
            },
            {
              element_type: "narration",
              element_id: "n_b",
              timeline: { start_at: 5000, end_at: 8000 },
            },
          ],
        },
      ],
    } as unknown as Scene;
    expect(collectNarrationTimelineOverlapWarnings(scene)).toHaveLength(0);
  });

  it("pushes later overlapping narrations forward while preserving duration", () => {
    const staggered = resolveStaggeredNarrationTimelines([
      { element_id: "el_a", timeline: { start_at: 28888, end_at: 31235 } },
      { element_id: "el_b", timeline: { start_at: 31135, end_at: 35702 } },
    ]);
    expect(staggered).not.toBeNull();
    expect(staggered?.get("el_a")).toEqual({ start_at: 28888, end_at: 31235 });
    expect(staggered?.get("el_b")).toEqual({
      start_at: 31235,
      end_at: 31235 + (35702 - 31135),
    });
  });

  it("returns null when narrations are already sequential", () => {
    expect(
      resolveStaggeredNarrationTimelines([
        { element_id: "el_a", timeline: { start_at: 0, end_at: 4000 } },
        { element_id: "el_b", timeline: { start_at: 4000, end_at: 7000 } },
      ]),
    ).toBeNull();
  });
});
