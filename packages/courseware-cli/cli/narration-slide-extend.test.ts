// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSerializedChildrenToMaxEnd,
  extendElementEndTimesDeep,
  extendSerializedChildrenEndByDelta,
} from "./narration-slide-extend.ts";

test("extendSerializedChildrenEndByDelta is a no-op when delta is 0", () => {
  const children = [{ timeline: { start_at: 0, end_at: 1000 } }];
  assert.deepEqual(extendSerializedChildrenEndByDelta(children, 0), children);
});

test("extendSerializedChildrenEndByDelta bumps timeline.end_at recursively", () => {
  const children = [
    { timeline: { start_at: 0, end_at: 5000 }, element_type: "text" },
    {
      element_type: "group",
      timeline: { start_at: 0, end_at: 5000 },
      children_elements: [{ timeline: { start_at: 100, end_at: 4800 } }],
    },
  ];
  const out = extendSerializedChildrenEndByDelta(children, 2000) as Array<Record<string, unknown>>;
  assert.equal((out[0]!.timeline as { end_at: number }).end_at, 7000);
  assert.equal((out[1]!.timeline as { end_at: number }).end_at, 7000);
  const nested = (out[1]!.children_elements as Array<{ timeline: { end_at: number } }>)[0];
  assert.equal(nested.timeline.end_at, 6800);
});

test("extendSerializedChildrenEndByDelta skips narration and vtuber tracks", () => {
  const children = [
    { element_type: "text", timeline: { start_at: 0, end_at: 5000 } },
    { element_type: "narration", timeline: { start_at: 0, end_at: 5000 } },
    { element_type: "vtuber", timeline: { start_at: 0, end_at: 5000 } },
  ];
  const out = extendSerializedChildrenEndByDelta(children, 2000) as Array<Record<string, unknown>>;
  assert.equal((out[0]!.timeline as { end_at: number }).end_at, 7000);
  assert.equal((out[1]!.timeline as { end_at: number }).end_at, 5000);
  assert.equal((out[2]!.timeline as { end_at: number }).end_at, 5000);
});

test("extendSerializedChildrenEndByDelta can require previous slide-end alignment", () => {
  const children = [
    { element_type: "text", timeline: { start_at: 0, end_at: 5000 } },
    { element_type: "image", timeline: { start_at: 0, end_at: 2000 } },
  ];
  const out = extendSerializedChildrenEndByDelta(children, 1000, {
    onlyIfEndAtLeastMs: 5000,
  }) as Array<Record<string, unknown>>;
  assert.equal((out[0]!.timeline as { end_at: number }).end_at, 6000);
  assert.equal((out[1]!.timeline as { end_at: number }).end_at, 2000);
});

test("extendElementEndTimesDeep leaves non-objects unchanged", () => {
  assert.equal(extendElementEndTimesDeep(null, 100), null);
  assert.deepEqual(extendElementEndTimesDeep([1, 2], 100), [1, 2]);
});

test("clampSerializedChildrenToMaxEnd tightens timeline and keyframes", () => {
  const children = [
    {
      timeline: { start_at: 0, end_at: 40_000 },
      keyframes: [{ at: 40_000, opacity: 1 }],
      animations: [],
      children_elements: [],
    },
  ];
  const out = clampSerializedChildrenToMaxEnd(children, 34_364) as Array<Record<string, unknown>>;
  assert.deepEqual(out[0]!.timeline, { start_at: 0, end_at: 34_364 });
  const kf = (out[0]!.keyframes as Array<{ at: number }>)[0];
  assert.equal(kf.at, 34_364);
});
