// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  buildPptSlideHtmlUrl,
  deserializeElement,
  expandPptSlideRanges,
  formatPptSlideRanges,
  parsePptSlideRanges,
  resolvePptSlideIndexForTimeline,
  serializeElement,
  type PPTElement,
} from "./elements.ts";

describe("buildPptSlideHtmlUrl", () => {
  const base = "https://courseware.example.com/artifact/pdf/abc123";

  it("appends html slide path to artifact base url", () => {
    expect(buildPptSlideHtmlUrl(base, 1)).toBe(`${base}/html/slide_1.html`);
    expect(buildPptSlideHtmlUrl(base, 12)).toBe(`${base}/html/slide_12.html`);
  });

  it("strips trailing slashes from base before appending", () => {
    expect(buildPptSlideHtmlUrl(`${base}/`, 3)).toBe(`${base}/html/slide_3.html`);
    expect(buildPptSlideHtmlUrl(`${base}//`, 3)).toBe(`${base}/html/slide_3.html`);
  });

  it("clamps non-positive slide numbers to 1", () => {
    expect(buildPptSlideHtmlUrl(base, 0)).toBe(`${base}/html/slide_1.html`);
    expect(buildPptSlideHtmlUrl(base, -5)).toBe(`${base}/html/slide_1.html`);
  });
});

describe("expandPptSlideRanges", () => {
  it("returns 1..slideCount when ranges is empty", () => {
    expect(expandPptSlideRanges([], 4)).toEqual([1, 2, 3, 4]);
  });

  it("expands single-page entries (start === end) and ranges", () => {
    expect(
      expandPptSlideRanges(
        [
          { start: 1, end: 1 },
          { start: 3, end: 5 },
        ],
        10,
      ),
    ).toEqual([1, 3, 4, 5]);
  });

  it("dedupes overlapping ranges and preserves first-occurrence order", () => {
    expect(
      expandPptSlideRanges(
        [
          { start: 2, end: 4 },
          { start: 3, end: 6 },
        ],
        10,
      ),
    ).toEqual([2, 3, 4, 5, 6]);
  });

  it("clamps to slideCount and ignores zero/negative slide counts", () => {
    expect(expandPptSlideRanges([{ start: 1, end: 100 }], 3)).toEqual([1, 2, 3]);
    expect(expandPptSlideRanges([{ start: 1, end: 100 }], 0)).toEqual([]);
  });
});

describe("resolvePptSlideIndexForTimeline", () => {
  const minimalPpt = (partial: Partial<PPTElement>): PPTElement => ({
    element_type: "ppt",
    element_id: "el_ppt",
    name: "P",
    html: "",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    timeline: { start_at: 0, end_at: 10_000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 0 },
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: {},
    src: "https://courseware.example.com/artifact/pdf/x",
    slide_count: 4,
    slide_ranges: [],
    ...partial,
  });

  it("uses metadata baseline until a keyframe sets ppt_slide_index", () => {
    const el = minimalPpt({
      metadata: { ppt_editor_slide_index: 2 },
      keyframes: [
        {
          at: 3000,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 100 },
          rotation_deg: 0,
          opacity: 1,
          easing: "linear",
          ppt_slide_index: 1,
        },
      ],
    });
    expect(resolvePptSlideIndexForTimeline(el, 0)).toBe(2);
    expect(resolvePptSlideIndexForTimeline(el, 3000)).toBe(1);
    expect(resolvePptSlideIndexForTimeline(el, 9000)).toBe(1);
  });

  it("ignores keyframes that omit ppt_slide_index (inherit)", () => {
    const el = minimalPpt({
      keyframes: [
        {
          at: 1000,
          position: { x: 1, y: 0 },
          size: { width: 100, height: 100 },
          rotation_deg: 0,
          opacity: 1,
          easing: "linear",
          ppt_slide_index: 0,
        },
        {
          at: 2000,
          position: { x: 2, y: 0 },
          size: { width: 100, height: 100 },
          rotation_deg: 0,
          opacity: 1,
          easing: "linear",
        },
        {
          at: 4000,
          position: { x: 3, y: 0 },
          size: { width: 100, height: 100 },
          rotation_deg: 0,
          opacity: 1,
          easing: "linear",
          ppt_slide_index: 2,
        },
      ],
    });
    expect(resolvePptSlideIndexForTimeline(el, 1500)).toBe(0);
    expect(resolvePptSlideIndexForTimeline(el, 3500)).toBe(0);
    expect(resolvePptSlideIndexForTimeline(el, 5000)).toBe(2);
  });
});

describe("parsePptSlideRanges / formatPptSlideRanges", () => {
  it("parses comma-separated singles and ranges", () => {
    expect(parsePptSlideRanges("1, 3, 5-8")).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 8 },
    ]);
  });

  it("treats empty input as 'all pages' (returns empty array)", () => {
    expect(parsePptSlideRanges("")).toEqual([]);
    expect(parsePptSlideRanges("   ")).toEqual([]);
  });

  it("formats ranges back to a stable canonical string", () => {
    expect(
      formatPptSlideRanges([
        { start: 1, end: 1 },
        { start: 3, end: 3 },
        { start: 5, end: 8 },
      ]),
    ).toBe("1, 3, 5-8");
    expect(formatPptSlideRanges([])).toBe("");
  });

  it("normalizes reversed `a-b` (a > b) by sorting endpoints", () => {
    expect(parsePptSlideRanges("8-5")).toEqual([{ start: 5, end: 8 }]);
  });
});

describe("PPTElement (de)serialize round-trip", () => {
  const baseElement: PPTElement = {
    element_type: "ppt",
    element_id: "el_ppt_test",
    name: "PPT 嵌入",
    html: "",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 1280, height: 720 },
    timeline: { start_at: 0, end_at: 10000 },
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
    src: "https://courseware.example.com/artifact/pdf/abc123",
    slide_count: 8,
    slide_ranges: [
      { start: 1, end: 1 },
      { start: 3, end: 5 },
    ],
  };

  it("serialize → deserialize preserves PPT-specific fields", () => {
    const serialized = serializeElement(baseElement);
    const deserialized = deserializeElement(serialized) as PPTElement;
    expect(deserialized.element_type).toBe("ppt");
    expect(deserialized.src).toBe(baseElement.src);
    expect(deserialized.slide_count).toBe(8);
    expect(deserialized.slide_ranges).toEqual(baseElement.slide_ranges);
  });

  it("rejects non-http(s) src", () => {
    const bad = { ...baseElement, src: "ftp://example.com/foo" };
    expect(() => serializeElement(bad)).toThrow(/src/);
  });

  it("rejects ranges with end < start", () => {
    const bad = {
      ...baseElement,
      slide_ranges: [{ start: 5, end: 2 }],
    };
    expect(() => serializeElement(bad)).toThrow();
  });
});
