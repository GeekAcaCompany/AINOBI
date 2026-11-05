// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  collectNarrationTimelineOverlapWarnings,
  narrationTimelinesOverlap,
  resolveNextNarrationStartAt,
} from "./narration-timeline-overlap.ts";
import type { Scene } from "./elements.ts";

test("narrationTimelinesOverlap detects positive overlap only", () => {
  assert.equal(
    narrationTimelinesOverlap({ start_at: 0, end_at: 1000 }, { start_at: 999, end_at: 2000 }),
    true,
  );
  assert.equal(
    narrationTimelinesOverlap({ start_at: 0, end_at: 1000 }, { start_at: 1000, end_at: 2000 }),
    false,
  );
});

test("resolveNextNarrationStartAt returns slide start when empty", () => {
  assert.equal(resolveNextNarrationStartAt(0, []), 0);
  assert.equal(resolveNextNarrationStartAt(100, []), 100);
});

test("resolveNextNarrationStartAt staggers after max end", () => {
  assert.equal(
    resolveNextNarrationStartAt(0, [
      { element_id: "n1", timeline: { start_at: 0, end_at: 4000 } },
      { element_id: "n2", timeline: { start_at: 1000, end_at: 5500 } },
    ]),
    5500,
  );
  assert.equal(
    resolveNextNarrationStartAt(
      0,
      [
        { element_id: "n1", timeline: { start_at: 0, end_at: 4000 } },
        { element_id: "editing", timeline: { start_at: 0, end_at: 2000 } },
      ],
      { excludeElementId: "editing", gapMs: 200 },
    ),
    4200,
  );
});

test("collectNarrationTimelineOverlapWarnings reports overlapping pair", () => {
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
            timeline: { start_at: 3000, end_at: 8000 },
          },
          {
            element_type: "text",
            element_id: "t1",
            timeline: { start_at: 0, end_at: 8000 },
          },
        ],
      },
    ],
  } as unknown as Scene;
  const warnings = collectNarrationTimelineOverlapWarnings(scene);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /overlap/i);
  assert.equal((warnings[0]!.value as { a: string }).a, "n_a");
});

test("collectNarrationTimelineOverlapWarnings ignores sequential narrations", () => {
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
            timeline: { start_at: 5000, end_at: 9000 },
          },
        ],
      },
    ],
  } as unknown as Scene;
  assert.equal(collectNarrationTimelineOverlapWarnings(scene).length, 0);
});
