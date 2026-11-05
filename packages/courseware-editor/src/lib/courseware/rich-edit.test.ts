// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { parseRichAstFromJson, type RichAstNode } from "@ainobi/courseware-core/rich-ast.ts";

import {
  applyRichResizeDrag,
  buildRichMarginNudgePatch,
  childPath,
  getRichAstNodeAtPath,
  getRichHitElementAtClientPoint,
  isRichContainerNode,
  pathKey,
  pathsEqual,
  RICH_EDIT_OVERLAY_ATTR,
  removeRichNodeAtPath,
  resolveRichSelectionPathFromHit,
} from "./rich-edit.ts";

const el = (
  tag: string,
  props: Record<string, unknown> = {},
  children: RichAstNode[] = [],
): RichAstNode => ({ kind: "element", tag: tag as never, props: props as never, children });
const text = (value: string): RichAstNode => ({ kind: "text", text: value });

describe("rich-edit", () => {
  it("navigates ast paths", () => {
    const layout = parseRichAstFromJson(
      el("div", {}, [el("section", {}, [text("A")]), el("p", {}, [text("B")])]),
    );
    expect(pathKey(childPath([], 1))).toBe("1");
    expect(getRichAstNodeAtPath(layout, [1])?.kind).toBe("element");
    expect(pathsEqual([0, 1], [0, 1])).toBe(true);
  });

  it("detects container nodes", () => {
    const layout = parseRichAstFromJson(el("div", {}, [el("p", {}, [text("x")])]));
    expect(isRichContainerNode(getRichAstNodeAtPath(layout, []))).toBe(true);
    expect(isRichContainerNode(getRichAstNodeAtPath(layout, [0]))).toBe(false);
  });

  it("resolves selection paths from text hits", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div data-rich-node-path="0"><p data-rich-node-path="0.0"><span data-rich-text-path="0.0.0">Hi</span></p></div>`;
    const span = host.querySelector("span")!;
    expect(resolveRichSelectionPathFromHit(span, [])).toEqual([0, 0]);
    expect(resolveRichSelectionPathFromHit(span, [0])).toEqual([0, 0]);
  });

  it("hits rich nodes through the editor overlay", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section data-rich-node-path="0"><p data-rich-node-path="0.0">Body</p></section>`;
    const overlay = document.createElement("div");
    overlay.setAttribute(RICH_EDIT_OVERLAY_ATTR, "true");
    document.body.appendChild(root);
    document.body.appendChild(overlay);
    overlay.style.cssText = "position:fixed;left:0;top:0;width:200px;height:100px;z-index:10";
    const p = root.querySelector("p")!;
    const rect = { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 } as DOMRect;
    p.getBoundingClientRect = () => rect;
    overlay.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
    } as DOMRect);
    const original = document.elementsFromPoint;
    document.elementsFromPoint = () => [overlay, p];
    expect(getRichHitElementAtClientPoint(root, 10, 10)).toBe(p);
    document.elementsFromPoint = original;
    document.body.removeChild(root);
    document.body.removeChild(overlay);
  });

  it("applies resize drag in logical pixels", () => {
    const capture = {
      handle: "se" as const,
      startClientX: 10,
      startClientY: 10,
      startWidth: 50,
      startHeight: 40,
    };
    const next = applyRichResizeDrag(capture, 30, 26, 2);
    expect(next.width).toBe(60);
    expect(next.height).toBe(48);
  });

  it("removes rich ast nodes and nudges margins", () => {
    const layout = parseRichAstFromJson(
      el("div", {}, [
        el("section", { style: { marginTop: 4, marginLeft: 8 } }, [text("A")]),
        el("p", {}, [text("B")]),
      ]),
    );
    const next = removeRichNodeAtPath(layout, [1]);
    expect(next?.kind).toBe("element");
    if (next?.kind === "element") {
      expect(next.children).toHaveLength(1);
    }
    const patch = buildRichMarginNudgePatch(layout, [0], 2, -3);
    expect(patch).toEqual({ marginLeft: "10px", marginTop: "1px" });
  });
});
