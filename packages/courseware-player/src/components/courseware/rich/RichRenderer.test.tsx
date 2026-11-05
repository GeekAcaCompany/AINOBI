// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { parseRichAstFromJson, type RichAstNode } from "@ainobi/courseware-core/rich-ast.ts";

import { RichRenderer } from "./RichRenderer.tsx";

const el = (
  tag: string,
  props: Record<string, unknown> = {},
  children: RichAstNode[] = [],
): RichAstNode => ({ kind: "element", tag: tag as never, props: props as never, children });
const text = (value: string): RichAstNode => ({ kind: "text", text: value });

describe("RichRenderer", () => {
  it("renders nested HTML, passes className through, and sanitizes style", () => {
    const layout = parseRichAstFromJson(
      el(
        "div",
        { className: "flex gap-4", style: { color: "rgb(10, 20, 30)" } },
        [el("h2", { className: "text-6xl" }, [text("Hello")]), text("world")],
      ),
    );
    const { container } = render(<RichRenderer reactLayout={layout} />);
    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv.tagName).toBe("DIV");
    expect(rootDiv.className).toContain("flex");
    expect(rootDiv.className).toContain("gap-4");
    expect(rootDiv.style.color).toBe("rgb(10, 20, 30)");
    const h2 = container.querySelector("h2");
    expect(h2?.className).toContain("text-6xl");
    expect(h2?.textContent).toBe("Hello");
    expect(rootDiv.textContent).toBe("Helloworld");
  });

  it("merges containerStyle and fills the box", () => {
    const layout = parseRichAstFromJson(el("div", { className: "p-4" }, [text("x")]));
    const { container } = render(
      <RichRenderer reactLayout={layout} containerStyle={{ width: 800, height: 600 }} />,
    );
    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv.style.width).toBe("800px");
    expect(rootDiv.style.height).toBe("600px");
  });

  it("renders void img without children", () => {
    const layout = parseRichAstFromJson(
      el("div", {}, [el("img", { src: "https://x/y.png", alt: "cat" })]),
    );
    const { container } = render(<RichRenderer reactLayout={layout} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://x/y.png");
    expect(img?.getAttribute("alt")).toBe("cat");
  });

  it("returns null for a non-element root", () => {
    const { container } = render(
      <RichRenderer reactLayout={{ kind: "text", text: "x" } as RichAstNode} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("emits text path and value when editable text changes", () => {
    const layout = parseRichAstFromJson(
      el("div", {}, [el("h2", {}, [text("Title")]), el("p", {}, [text("Body")])]),
    );
    const changes: Array<{ path: number[]; text: string }> = [];
    const { container } = render(
      <RichRenderer
        reactLayout={layout}
        editableText
        onTextChange={(path, nextText) => changes.push({ path, text: nextText })}
      />,
    );
    const editable = container.querySelector<HTMLElement>('[data-rich-text-path="1.0"]');
    expect(editable).not.toBeNull();
    if (!editable) return;
    editable.innerText = "Updated body";
    fireEvent.input(editable);
    expect(changes).toEqual([{ path: [1, 0], text: "Updated body" }]);
  });
});
