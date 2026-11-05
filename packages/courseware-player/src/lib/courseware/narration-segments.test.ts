// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { NarrationElement } from "@ainobi/courseware-core/elements.ts";
import {
  resolveActiveNarrationSegmentIndex,
  resolveNarrationSegments,
  resolveNarrationSegmentsForHyperframes,
  lookupMeasuredNarrationDurationMs,
  syncCommittedIndexFromTime,
} from "./narration-segments.ts";

const baseNarration = (): NarrationElement => ({
  element_type: "narration",
  element_id: "n1",
  name: "Narration",
  html: "",
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 100, height: 100 },
  timeline: { start_at: 1000, end_at: 8000 },
  style: { opacity: 1, rotation_deg: 0, z_index: 1 },
  enter_effect: "none",
  exit_effect: "none",
  animations: [],
  keyframes: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  metadata: {},
  ai_teacher_id: "t1",
  ai_teacher_name: "",
  vtuber_element_id: "v1",
  script: "",
  transcript: "",
  subtitle_background_color: "#000",
  subtitle_background_opacity: 0.7,
  subtitle_background_transparent: false,
  subtitle_visible: true,
  segments: [
    {
      text: "第一句",
      audio_url: "https://cdn.example.com/a.mp3",
      duration_ms: 2000,
      gap_ms: 100,
    },
    {
      text: "第二句",
      audio_url: "https://cdn.example.com/b.mp3",
      duration_ms: 1500,
      gap_ms: 0,
    },
  ],
});

describe("resolveNarrationSegments", () => {
  it("lays out segments from timeline.start_at with gap_ms", () => {
    const resolved = resolveNarrationSegments(baseNarration());
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({ startMs: 1100, endMs: 3100, index: 0 });
    expect(resolved[1]).toMatchObject({ startMs: 3100, endMs: 4600, index: 1 });
  });

  it("extends duration when measured length exceeds stored duration_ms", () => {
    const resolved = resolveNarrationSegments(baseNarration(), {
      "https://cdn.example.com/a.mp3": 2800,
    });
    expect(resolved[0].endMs).toBe(1100 + 2800);
    expect(resolved[1].startMs).toBe(3900);
  });
});

describe("resolveNarrationSegmentsForHyperframes", () => {
  it("chains segments without inter-segment gap_ms", () => {
    const el = baseNarration();
    el.segments[1] = { ...el.segments[1], gap_ms: 500 };
    const resolved = resolveNarrationSegmentsForHyperframes(el);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({ startMs: 1100, endMs: 3100, index: 0 });
    expect(resolved[1]).toMatchObject({ startMs: 3100, endMs: 4600, index: 1 });
  });

  it("uses measured duration and back-to-back layout", () => {
    const resolved = resolveNarrationSegmentsForHyperframes(baseNarration(), {
      "https://cdn.example.com/a.mp3": 2800,
    });
    expect(resolved[0].endMs).toBe(1100 + 2800);
    expect(resolved[1].startMs).toBe(3900);
  });
});

describe("lookupMeasuredNarrationDurationMs", () => {
  it("matches presigned URLs by pathname basename", () => {
    const measured = {
      "https://oss.example.com/tts_outputs/foo.mp3?sig=abc": 2500,
    };
    expect(
      lookupMeasuredNarrationDurationMs(
        "https://oss.example.com/tts_outputs/foo.mp3?sig=xyz",
        measured,
      ),
    ).toBe(2500);
  });
});

describe("syncCommittedIndexFromTime", () => {
  it("maps in-segment time to that segment index", () => {
    const resolved = resolveNarrationSegments(baseNarration());
    expect(syncCommittedIndexFromTime(resolved, 2000)).toBe(0);
    expect(syncCommittedIndexFromTime(resolved, 3500)).toBe(1);
  });

  it("maps gap time to the upcoming segment index", () => {
    const resolved = resolveNarrationSegments(baseNarration());
    // seg0 ends 3100, seg1 starts 3100 — no gap in default fixture; insert mental gap via second seg gap_ms
    expect(syncCommittedIndexFromTime(resolved, 500)).toBe(0);
  });

  it("maps seek backward to earlier segment", () => {
    const resolved = resolveNarrationSegments(baseNarration());
    expect(syncCommittedIndexFromTime(resolved, 4000)).toBe(1);
    expect(syncCommittedIndexFromTime(resolved, 1500)).toBe(0);
  });
});

describe("resolveActiveNarrationSegmentIndex", () => {
  it("keeps committed src warm in pre-segment gap while playing", () => {
    const resolved = resolveNarrationSegments(baseNarration());
    expect(resolveActiveNarrationSegmentIndex(resolved, 1050, true, 0)).toBe(0);
    expect(resolveActiveNarrationSegmentIndex(resolved, 50, true, 0)).toBe(0);
  });

  it("keeps committed src warm in inter-segment gap while playing", () => {
    const el = baseNarration();
    el.segments[1] = { ...el.segments[1], gap_ms: 500 };
    const resolved = resolveNarrationSegments(el);
    const seg1Start = resolved[1].startMs;
    const gapMs = seg1Start - 50;
    expect(resolveActiveNarrationSegmentIndex(resolved, gapMs, true, 1)).toBe(1);
  });

  it("resolves in-segment time directly", () => {
    const resolved = resolveNarrationSegments(baseNarration());
    expect(resolveActiveNarrationSegmentIndex(resolved, 2000, true, 0)).toBe(0);
  });
});
