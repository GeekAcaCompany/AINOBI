// SPDX-License-Identifier: AGPL-3.0-only
/** Read / apply typography on inline SVG `<text>` nodes (editor toolbar). */

export interface SvgTextStyleSnapshot {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  bold: boolean;
  italic: boolean;
  color: string;
  backgroundColor: string;
  align: "left" | "center" | "right";
}

export type SvgTextStylePatch = Partial<{
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: number | null;
  fontStyle: string | null;
  color: string;
  backgroundColor: string;
  textAlign: "left" | "center" | "right";
}>;

export interface SvgTextEditorAnchor {
  x: number;
  y: number;
  align: "left" | "center" | "right";
}

const parseAttrNumber = (value: string | null, fallback = 0): number => {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parsePx = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const anchorFromAlign = (align: "left" | "center" | "right"): string => {
  if (align === "center") return "middle";
  if (align === "right") return "end";
  return "start";
};

const alignFromAnchor = (anchor: string | null): "left" | "center" | "right" => {
  if (anchor === "middle") return "center";
  if (anchor === "end") return "right";
  return "left";
};

export function readSvgTextStyleSnapshot(textEl: SVGTextElement): SvgTextStyleSnapshot {
  const fontWeight = textEl.getAttribute("font-weight") ?? "normal";
  const fontStyle = textEl.getAttribute("font-style") ?? "normal";
  const fontSize = parsePx(textEl.getAttribute("font-size"), 16);
  const lineHeight = parsePx(textEl.getAttribute("data-line-height"), 1.25);
  const bg = textEl.getAttribute("data-text-background") ?? "transparent";

  return {
    fontFamily: textEl.getAttribute("font-family") ?? "Inter, sans-serif",
    fontSize,
    lineHeight,
    bold: fontWeight === "700" || fontWeight === "bold",
    italic: fontStyle === "italic",
    color: textEl.getAttribute("fill") ?? "#0f172a",
    backgroundColor: bg,
    align: alignFromAnchor(textEl.getAttribute("text-anchor")),
  };
}

export function applySvgTextStylePatch(
  textEl: SVGTextElement,
  patch: SvgTextStylePatch,
): void {
  if (typeof patch.fontFamily === "string") {
    textEl.setAttribute("font-family", patch.fontFamily);
  }
  if (typeof patch.fontSize === "number" && patch.fontSize > 0) {
    textEl.setAttribute("font-size", String(patch.fontSize));
  }
  if (typeof patch.lineHeight === "number" && patch.lineHeight > 0) {
    textEl.setAttribute("data-line-height", String(patch.lineHeight));
  }
  if (patch.fontWeight !== undefined) {
    if (patch.fontWeight === null) textEl.removeAttribute("font-weight");
    else textEl.setAttribute("font-weight", String(patch.fontWeight));
  }
  if (patch.fontStyle !== undefined) {
    if (patch.fontStyle === null) textEl.removeAttribute("font-style");
    else textEl.setAttribute("font-style", patch.fontStyle);
  }
  if (typeof patch.color === "string") {
    textEl.setAttribute("fill", patch.color);
  }
  if (typeof patch.backgroundColor === "string") {
    if (patch.backgroundColor === "transparent") {
      textEl.removeAttribute("data-text-background");
    } else {
      textEl.setAttribute("data-text-background", patch.backgroundColor);
    }
  }
  if (patch.textAlign) {
    textEl.setAttribute("text-anchor", anchorFromAlign(patch.textAlign));
  }
}

export function readSvgTextEditorAnchor(textEl: SVGTextElement): SvgTextEditorAnchor {
  const snapshot = readSvgTextStyleSnapshot(textEl);
  return {
    x: parseAttrNumber(textEl.getAttribute("x")),
    y: parseAttrNumber(textEl.getAttribute("y")),
    align: snapshot.align,
  };
}

export function computeInlineSvgTextEditorForeignObjectX(
  anchor: SvgTextEditorAnchor,
  width: number,
): number {
  if (anchor.align === "center") return anchor.x - width / 2;
  if (anchor.align === "right") return anchor.x - width;
  return anchor.x;
}

export function syncInlineSvgTextEditorPresentation(textEl: SVGTextElement): void {
  const next = textEl.nextElementSibling;
  if (
    !next ||
    next.localName.toLowerCase() !== "foreignobject" ||
    !next.hasAttribute("data-svg-inline-text-fo")
  ) {
    return;
  }
  const div = next.querySelector("div");
  if (!div) return;
  const snapshot = readSvgTextStyleSnapshot(textEl);
  div.style.fontFamily = snapshot.fontFamily;
  div.style.fontSize = `${snapshot.fontSize}px`;
  div.style.fontWeight = snapshot.bold ? "700" : "normal";
  div.style.fontStyle = snapshot.italic ? "italic" : "normal";
  div.style.color = snapshot.color;
  div.style.textAlign = snapshot.align;
  div.style.lineHeight = String(snapshot.lineHeight);
  div.style.backgroundColor =
    snapshot.backgroundColor === "transparent" ? "transparent" : snapshot.backgroundColor;

  layoutInlineSvgTextEditorForeignObject(next as SVGForeignObjectElement, div, textEl);
}

export function isSvgTextNode(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.localName.toLowerCase();
  return tag === "text" || tag === "tspan";
}

/** Flatten `<tspan>` lines into a string for the in-place HTML editor. */
export function readSvgTextContentForEditor(textEl: SVGTextElement): string {
  const tspans = [...textEl.children].filter(
    (child) => child.localName.toLowerCase() === "tspan",
  );
  if (tspans.length > 0) {
    return tspans.map((tspan) => tspan.textContent ?? "").join("\n");
  }
  return textEl.textContent ?? "";
}

export function measureInlineSvgTextEditorBox(div: HTMLDivElement): {
  width: number;
  height: number;
} {
  const prevWidth = div.style.width;
  const prevDisplay = div.style.display;
  div.style.display = "inline-block";
  div.style.width = "max-content";
  const width = Math.max(Math.ceil(div.scrollWidth) + 4, 24);
  const height = Math.max(Math.ceil(div.scrollHeight) + 4, 16);
  div.style.width = prevWidth;
  div.style.display = prevDisplay;
  return { width, height };
}

/** Position the `foreignObject` editor to match SVG `text-anchor` / `x` / `y`. */
export function layoutInlineSvgTextEditorForeignObject(
  fo: SVGForeignObjectElement,
  div: HTMLDivElement,
  textEl: SVGTextElement,
): void {
  const anchor = readSvgTextEditorAnchor(textEl);
  const box = measureInlineSvgTextEditorBox(div);
  const foX = computeInlineSvgTextEditorForeignObjectX(anchor, box.width);

  let foY = anchor.y;
  try {
    foY = textEl.getBBox().y;
  } catch {
    // keep baseline fallback
  }

  fo.setAttribute("x", String(foX));
  fo.setAttribute("y", String(foY));
  fo.setAttribute("width", String(box.width));
  fo.setAttribute("height", String(box.height));

  div.style.display = "block";
  div.style.width = "100%";
  div.style.boxSizing = "border-box";
}
