// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { describeSvgNodeForOverlapPicker } from "@ainobi/courseware-player/lib/courseware/svg-edit";
import { describeRichNodeForOverlapPicker } from "./rich-edit.ts";

// FT8: overlap-picker node labels localize by the language param (default zh).

const svgNode = (tag: string, text?: string): Element => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

describe("describeSvgNodeForOverlapPicker i18n", () => {
  it("keeps Chinese labels by default", () => {
    expect(describeSvgNodeForOverlapPicker(svgNode("text", "hello"))).toBe("文本：hello");
    expect(describeSvgNodeForOverlapPicker(svgNode("text", "  "))).toBe("文本");
    expect(describeSvgNodeForOverlapPicker(svgNode("tspan"))).toBe("文本行");
  });

  it("localizes text labels for en/ja", () => {
    expect(describeSvgNodeForOverlapPicker(svgNode("text", "hello"), "en")).toBe("Text: hello");
    expect(describeSvgNodeForOverlapPicker(svgNode("tspan"), "en")).toBe("Text line");
    expect(describeSvgNodeForOverlapPicker(svgNode("text", "hello"), "ja")).toBe(
      "テキスト：hello",
    );
  });

  it("keeps tag-derived labels locale-independent", () => {
    expect(describeSvgNodeForOverlapPicker(svgNode("rect"), "en")).toBe("rect");
  });
});

describe("describeRichNodeForOverlapPicker i18n", () => {
  it("localizes the generic node fallback", () => {
    expect(describeRichNodeForOverlapPicker(null)).toBe("节点");
    expect(describeRichNodeForOverlapPicker(null, "en")).toBe("Node");
    expect(describeRichNodeForOverlapPicker(null, "ja")).toBe("ノード");
  });
});
