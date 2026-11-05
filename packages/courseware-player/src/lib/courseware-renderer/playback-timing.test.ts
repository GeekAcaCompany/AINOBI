// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { NarrationElement, SlideElement } from "../courseware/index.ts";
import {
  getHyperframesSceneSlideOffsetMs,
  getHyperframesSceneTotalDurationMs,
  getHyperframesSlidePlaybackDurationMs,
  getSlideNarrationEndMs,
  resolveHyperframesSceneTimeMs,
} from "./playback-timing.ts";

const narration = (segments: NarrationElement["segments"]): NarrationElement =>
  ({
    element_type: "narration",
    element_id: "narration_1",
    timeline: { start_at: 0, end_at: 8000 },
    segments,
  }) as NarrationElement;

const slide = (slideId: string, endAt: number, children: SlideElement["children_elements"]): SlideElement =>
  ({
    element_id: slideId,
    element_type: "slide",
    timeline: { start_at: 0, end_at: endAt },
    children_elements: children,
  }) as SlideElement;

describe("hyperframes playback timing", () => {
  it("extends slide duration when narration runs past slide.timeline", () => {
    const slides = [
      slide("s0", 5000, [
        narration([
          {
            text: "a",
            audio_url: "https://cdn.example.com/a.mp3",
            duration_ms: 2000,
            gap_ms: 100,
          },
          {
            text: "b",
            audio_url: "https://cdn.example.com/b.mp3",
            duration_ms: 1500,
            gap_ms: 0,
          },
        ]),
      ]),
    ];
    const measured = { "https://cdn.example.com/a.mp3": 6000 };
    expect(getSlideNarrationEndMs(slides[0]!, measured)).toBe(7600);
    expect(getHyperframesSlidePlaybackDurationMs(slides[0]!, measured)).toBe(7600);
    expect(getHyperframesSceneTotalDurationMs(slides, measured)).toBe(7600);
  });

  it("shifts later slide offsets when an earlier slide is narration-extended", () => {
    const slides = [
      slide("s0", 5000, [
        narration([
          {
            text: "a",
            audio_url: "https://cdn.example.com/a.mp3",
            duration_ms: 2000,
            gap_ms: 0,
          },
        ]),
      ]),
      slide("s1", 5000, []),
    ];
    const measured = { "https://cdn.example.com/a.mp3": 7000 };
    expect(getHyperframesSceneSlideOffsetMs(slides, 1, measured)).toBe(7000);
    const atScene = resolveHyperframesSceneTimeMs(slides, 7100, measured);
    expect(atScene).toEqual({ slideIndex: 1, localTimeMs: 100 });
  });
});
