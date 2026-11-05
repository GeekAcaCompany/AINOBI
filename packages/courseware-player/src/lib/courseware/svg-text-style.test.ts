// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  applySvgTextStylePatch,
  computeInlineSvgTextEditorForeignObjectX,
  readSvgTextContentForEditor,
  readSvgTextEditorAnchor,
  readSvgTextStyleSnapshot,
} from "./svg-text-style.ts";

describe("svg-text-style", () => {
  it("reads and applies svg text typography", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="20" font-size="24" fill="#111111">Hi</text></svg>`;
    const text = host.querySelector("text") as SVGTextElement;
    expect(readSvgTextStyleSnapshot(text).fontSize).toBe(24);
    applySvgTextStylePatch(text, {
      fontSize: 36,
      color: "#ff0000",
      textAlign: "center",
      fontWeight: 700,
    });
    expect(text.getAttribute("font-size")).toBe("36");
    expect(text.getAttribute("fill")).toBe("#ff0000");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("font-weight")).toBe("700");
  });

  it("round-trips multiline tspans for the editor", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="12"><tspan>One</tspan><tspan x="0" dy="1.2em">Two</tspan></text></svg>`;
    const text = host.querySelector("text") as SVGTextElement;
    expect(readSvgTextContentForEditor(text)).toBe("One\nTwo");
  });

  it("positions the editor foreignObject from text-anchor", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="100" y="40" text-anchor="middle">Hi</text></svg>`;
    const text = host.querySelector("text") as SVGTextElement;
    const anchor = readSvgTextEditorAnchor(text);
    expect(anchor).toEqual({ x: 100, y: 40, align: "center" });
    expect(computeInlineSvgTextEditorForeignObjectX(anchor, 80)).toBe(60);
    expect(computeInlineSvgTextEditorForeignObjectX({ ...anchor, align: "right" }, 80)).toBe(20);
    expect(computeInlineSvgTextEditorForeignObjectX({ ...anchor, align: "left" }, 80)).toBe(100);
  });
});
