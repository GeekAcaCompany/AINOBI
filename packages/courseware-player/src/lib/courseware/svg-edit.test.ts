// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  applySvgEditHighlights,
  applySvgResizeDrag,
  applySvgTextContent,
  applyTextElementPositionDelta,
  beginSvgResizeCapture,
  childPath,
  computeGenericResizeRatios,
  computeGenericResizeScales,
  findNodePath,
  getNodeAtPath,
  isInlineSvgSource,
  isSvgContainerElement,
  normalizeSvgSelectionPath,
  nudgeSvgNodePosition,
  parseTransformTranslate,
  pathsEqual,
  readTextElementPosition,
  removeNodesAtPaths,
  removeNodeAtPath,
  serializeInlineSvgMarkup,
  setTransformTranslate,
  stripTranslateFromTransform,
  toggleSvgPathSelection,
} from "./svg-edit.ts";

const SAMPLE = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g id="group">
    <rect x="10" y="10" width="20" height="20" fill="red" />
    <text x="40" y="40">Hello</text>
  </g>
  <circle cx="80" cy="80" r="10" fill="blue" />
</svg>`;

describe("svg-edit", () => {
  it("detects inline svg sources", () => {
    expect(isInlineSvgSource(SAMPLE)).toBe(true);
    expect(isInlineSvgSource("https://example.com/a.svg")).toBe(false);
  });

  it("navigates node paths", () => {
    const host = document.createElement("div");
    host.innerHTML = SAMPLE;
    const svg = host.querySelector("svg")!;
    expect(getNodeAtPath(svg, [0])?.id).toBe("group");
    expect(getNodeAtPath(svg, [0, 0])?.localName).toBe("rect");
    expect(childPath([0], 1)).toEqual([0, 1]);
    expect(pathsEqual([0, 1], [0, 1])).toBe(true);
    expect(pathsEqual([0], [0, 1])).toBe(false);
  });

  it("parses and writes translate transforms", () => {
    expect(parseTransformTranslate("translate(3, 4) rotate(10)")).toEqual({ x: 3, y: 4 });
    expect(stripTranslateFromTransform("translate(1,2) scale(2)")).toBe("scale(2)");
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>`;
    const rect = host.querySelector("rect")!;
    setTransformTranslate(rect, { x: 5, y: 6 });
    expect(rect.getAttribute("transform")).toBe("translate(5, 6)");
    setTransformTranslate(rect, { x: 8, y: 9 });
    expect(rect.getAttribute("transform")).toBe("translate(8, 9)");
  });

  it("detects container elements", () => {
    const host = document.createElement("div");
    host.innerHTML = SAMPLE;
    const group = host.querySelector("#group")!;
    const circle = host.querySelector("circle")!;
    expect(isSvgContainerElement(group)).toBe(true);
    expect(isSvgContainerElement(circle)).toBe(false);
  });

  it("resizes rect elements from captured attributes", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="40" height="30" /></svg>`;
    const rect = host.querySelector("rect") as SVGRectElement;
    const capture = beginSvgResizeCapture(rect, "se", 50, 40);
    applySvgResizeDrag(rect, capture, 60, 50);
    expect(rect.getAttribute("width")).toBe("50");
    expect(rect.getAttribute("height")).toBe("40");
  });

  it("resizes nested groups via matrix transform anchored in svg space", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <g id="group">
        <rect x="0" y="0" width="40" height="40" fill="red" />
        <rect x="50" y="0" width="40" height="40" fill="blue" />
      </g>
    </svg>`;
    const svg = host.querySelector("svg") as SVGSVGElement;
    const group = svg.querySelector("g") as SVGGElement;
    svg.createSVGPoint = () => {
      const point = { x: 0, y: 0 };
      return {
        get x() {
          return point.x;
        },
        set x(value: number) {
          point.x = value;
        },
        get y() {
          return point.y;
        },
        set y(value: number) {
          point.y = value;
        },
        matrixTransform(matrix: { a: number; b: number; c: number; d: number; e: number; f: number }) {
          return {
            x: point.x * matrix.a + point.y * matrix.c + matrix.e,
            y: point.x * matrix.b + point.y * matrix.d + matrix.f,
          };
        },
      } as SVGPoint;
    };
    svg.getScreenCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }) as unknown as DOMMatrix;
    svg.getCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }) as unknown as SVGMatrix;
    group.getBBox = () =>
      ({
        x: 0,
        y: 0,
        width: 90,
        height: 40,
      }) as DOMRect;
    group.getCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        multiply: () => group.getCTM!(),
      }) as unknown as SVGMatrix;
    group.getScreenCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }) as unknown as DOMMatrix;

    const capture = beginSvgResizeCapture(group, "e", 90, 20);
    expect(capture.generic).not.toBeNull();
    const atStart = computeGenericResizeScales(capture.generic!, "e", 90, 20);
    expect(atStart.scaleX).toBeCloseTo(capture.generic!.initialScaleX, 5);

    applySvgResizeDrag(group, capture, 130, 20);
    const transform = group.getAttribute("transform") ?? "";
    expect(transform).toMatch(/^matrix\(/);
    const [scaleX, , , scaleY] = transform
      .replace(/^matrix\(|\)$/g, "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    expect(scaleX).toBeGreaterThan(1.2);
    expect(scaleY).toBeCloseTo(1, 5);
    expect(capture.generic!.anchorParentX).toBe(0);

    host.remove();
  });

  it("resizes nested groups inside a translated parent without jumping", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <g transform="translate(100, 50)">
        <g id="group">
          <rect x="0" y="0" width="40" height="40" fill="red" />
          <rect x="50" y="0" width="40" height="40" fill="blue" />
        </g>
      </g>
    </svg>`;
    const svg = host.querySelector("svg") as SVGSVGElement;
    const outer = svg.querySelector("g") as SVGGElement;
    const group = outer.querySelector("g") as SVGGElement;
    svg.createSVGPoint = () => {
      const point = { x: 0, y: 0 };
      return {
        get x() {
          return point.x;
        },
        set x(value: number) {
          point.x = value;
        },
        get y() {
          return point.y;
        },
        set y(value: number) {
          point.y = value;
        },
        matrixTransform(matrix: { a: number; b: number; c: number; d: number; e: number; f: number }) {
          return {
            x: point.x * matrix.a + point.y * matrix.c + matrix.e,
            y: point.x * matrix.b + point.y * matrix.d + matrix.f,
          };
        },
      } as SVGPoint;
    };
    const identityCtm = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      inverse: () => identityCtm,
    };
    const outerCtm = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 100,
      f: 50,
      inverse: () => ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: -100,
        f: -50,
      }),
    };
    svg.getScreenCTM = () => outerCtm as unknown as DOMMatrix;
    svg.getCTM = () => outerCtm as unknown as SVGMatrix;
    outer.getCTM = () => outerCtm as unknown as SVGMatrix;
    outer.getScreenCTM = () => outerCtm as unknown as DOMMatrix;
    group.getBBox = () =>
      ({
        x: 0,
        y: 0,
        width: 90,
        height: 40,
      }) as DOMRect;
    group.getCTM = () => outerCtm as unknown as SVGMatrix;
    group.getScreenCTM = () => outerCtm as unknown as DOMMatrix;

    const capture = beginSvgResizeCapture(group, "e", 190, 70);
    expect(capture.generic).not.toBeNull();
    const atStart = computeGenericResizeScales(capture.generic!, "e", 190, 70);
    expect(atStart.scaleX).toBeCloseTo(1, 5);

    applySvgResizeDrag(group, capture, 190, 70);
    const transform = group.getAttribute("transform") ?? "";
    expect(transform).toMatch(/^matrix\(/);
    const parts = transform
      .replace(/^matrix\(|\)$/g, "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    expect(parts[0]).toBeCloseTo(1, 5);
    expect(parts[3]).toBeCloseTo(1, 5);
    expect(parts[4]).toBeCloseTo(0, 5);
    expect(parts[5]).toBeCloseTo(0, 5);

    host.remove();
  });

  it("keeps descendant text proportional when resizing a group", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <g id="group">
        <rect x="0" y="0" width="80" height="40" fill="#eee" />
        <text x="10" y="28" font-size="20">Label</text>
      </g>
    </svg>`;
    const svg = host.querySelector("svg") as SVGSVGElement;
    const group = svg.querySelector("g") as SVGGElement;
    const text = svg.querySelector("text") as SVGTextElement;
    svg.createSVGPoint = () => {
      const point = { x: 0, y: 0 };
      return {
        get x() {
          return point.x;
        },
        set x(value: number) {
          point.x = value;
        },
        get y() {
          return point.y;
        },
        set y(value: number) {
          point.y = value;
        },
        matrixTransform(matrix: { a: number; b: number; c: number; d: number; e: number; f: number }) {
          return {
            x: point.x * matrix.a + point.y * matrix.c + matrix.e,
            y: point.x * matrix.b + point.y * matrix.d + matrix.f,
          };
        },
      } as SVGPoint;
    };
    svg.getScreenCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }) as unknown as DOMMatrix;
    svg.getCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }) as unknown as SVGMatrix;
    group.getBBox = () =>
      ({
        x: 0,
        y: 0,
        width: 80,
        height: 40,
      }) as DOMRect;
    group.getCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        multiply: () => group.getCTM!(),
      }) as unknown as SVGMatrix;
    group.getScreenCTM = () =>
      ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }) as unknown as DOMMatrix;

    const capture = beginSvgResizeCapture(group, "e", 90, 20);
    expect(capture.generic?.childSnapshots).not.toBeNull();

    applySvgResizeDrag(group, capture, 130, 20);
    expect(text.getAttribute("font-size")).not.toBe("20");
    expect(Number(text.getAttribute("font-size"))).toBeGreaterThan(20);
    expect(text.getAttribute("transform") ?? "").not.toMatch(/scale\(/);
    expect(group.getAttribute("transform") ?? "").not.toMatch(/matrix\(/);

    host.remove();
  });

  it("finds node paths and removes children", () => {
    const host = document.createElement("div");
    host.innerHTML = SAMPLE;
    const svg = host.querySelector("svg")!;
    const rect = host.querySelector("rect")!;
    expect(findNodePath(svg, rect)).toEqual([0, 0]);
    expect(removeNodeAtPath(svg, [0, 0])).toBe(true);
    expect(getNodeAtPath(svg, [0, 0])?.localName).toBe("text");
    expect(removeNodeAtPath(svg, [])).toBe(false);
  });

  it("normalizes tspan selection to parent text", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="2"><tspan>Hi</tspan></text></svg>`;
    const svg = host.querySelector("svg")!;
    const tspan = host.querySelector("tspan")!;
    const tspanPath = findNodePath(svg, tspan)!;
    expect(normalizeSvgSelectionPath(svg, tspanPath)).toEqual([0]);
  });

  it("moves text via x/y attributes", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">Hi</text></svg>`;
    const text = host.querySelector("text") as SVGTextElement;
    const base = readTextElementPosition(text);
    applyTextElementPositionDelta(text, { x: 5, y: -3 }, base);
    expect(text.getAttribute("x")).toBe("15");
    expect(text.getAttribute("y")).toBe("17");
  });

  it("nudges svg nodes via translate or text x/y", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10" /><text x="4" y="8">Hi</text></svg>`;
    const rect = host.querySelector("rect")!;
    const text = host.querySelector("text") as SVGTextElement;
    nudgeSvgNodePosition(rect, 3, 2);
    expect(rect.getAttribute("transform")).toBe("translate(3, 2)");
    nudgeSvgNodePosition(text, 1, -1);
    expect(text.getAttribute("x")).toBe("5");
    expect(text.getAttribute("y")).toBe("7");
  });

  it("writes multiline editor text as stacked tspans", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="4" y="8" data-line-height="1.5">A</text></svg>`;
    const text = host.querySelector("text") as SVGTextElement;
    applySvgTextContent(text, "Line one\nLine two");
    const tspans = [...text.querySelectorAll("tspan")];
    expect(tspans).toHaveLength(2);
    expect(tspans[0]?.textContent).toBe("Line one");
    expect(tspans[1]?.textContent).toBe("Line two");
    expect(tspans[1]?.getAttribute("x")).toBe("4");
    expect(tspans[1]?.getAttribute("dy")).toBe("1.5em");
  });

  it("does not highlight root-level siblings until drilling into a container", () => {
    const host = document.createElement("div");
    host.innerHTML = SAMPLE;
    const svg = host.querySelector("svg") as SVGSVGElement;
    applySvgEditHighlights(svg, [], []);
    expect(svg.querySelector("[data-svg-edit-highlight]")).toBeNull();

    applySvgEditHighlights(svg, [0], [childPath([0], 0)]);
    expect(svg.querySelectorAll("[data-svg-edit-highlight]").length).toBe(1);
  });

  it("strips transient edit highlights from serialized svg markup", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><rect data-svg-edit-highlight="focus" style="outline:1px dashed blue" x="0" y="0" width="10" height="10" /></svg>`;
    const serialized = serializeInlineSvgMarkup(host);
    expect(serialized).not.toContain("data-svg-edit-highlight");
    expect(serialized).not.toContain("outline");
  });

  it("toggles svg path selection for multi-select", () => {
    const a = childPath([0], 0);
    const b = childPath([0], 1);
    expect(toggleSvgPathSelection([], a)).toEqual([a]);
    expect(toggleSvgPathSelection([a], b, { toggle: true })).toEqual([a, b]);
    expect(toggleSvgPathSelection([a, b], b, { toggle: true })).toEqual([a]);
    expect(toggleSvgPathSelection([a, b], b, { keepGroupOnReselect: true })).toEqual([a, b]);
  });

  it("removes multiple svg nodes in stable index order", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g><rect /><rect /><rect /></g></svg>`;
    const svg = host.querySelector("svg")!;
    const removed = removeNodesAtPaths(svg, [childPath([0], 1), childPath([0], 0)]);
    expect(removed).toBe(2);
    expect(svg.querySelectorAll("rect").length).toBe(1);
  });
});
