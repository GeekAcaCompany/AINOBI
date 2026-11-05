// SPDX-License-Identifier: AGPL-3.0-only
import { translate, type SupportedLanguage } from "../i18n/index.ts";
import {
  layoutInlineSvgTextEditorForeignObject,
  readSvgTextContentForEditor,
  readSvgTextStyleSnapshot,
} from "./svg-text-style.ts";

export type SvgNodePath = number[];

const INLINE_SVG_PREFIX = /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i;

const SVG_CONTAINER_TAGS = new Set(["g", "svg", "a", "switch"]);

const SVG_NON_INTERACTIVE_TAGS = new Set([
  "defs",
  "metadata",
  "title",
  "desc",
  "style",
  "clipPath",
  "mask",
  "pattern",
  "linearGradient",
  "radialGradient",
  "filter",
]);

export function isInlineSvgSource(source: string): boolean {
  return INLINE_SVG_PREFIX.test(source.trim());
}

export function pathKey(path: SvgNodePath): string {
  return path.join(".");
}

export function pathsEqual(
  a: SvgNodePath | null | undefined,
  b: SvgNodePath | null | undefined,
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function isSvgPathSelected(paths: SvgNodePath[], path: SvgNodePath): boolean {
  return paths.some((candidate) => pathsEqual(candidate, path));
}

export function toggleSvgPathSelection(
  paths: SvgNodePath[],
  path: SvgNodePath,
  options?: { toggle?: boolean; keepGroupOnReselect?: boolean },
): SvgNodePath[] {
  const isSelected = isSvgPathSelected(paths, path);
  if (options?.toggle) {
    return isSelected ? paths.filter((candidate) => !pathsEqual(candidate, path)) : [...paths, path];
  }
  if (isSelected && options?.keepGroupOnReselect && paths.length > 1) return paths;
  return [path];
}

/** Remove multiple nodes without invalidating sibling index paths. */
export function sortSvgPathsForDeletion(paths: SvgNodePath[]): SvgNodePath[] {
  return [...paths].sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    for (let index = a.length - 1; index >= 0; index -= 1) {
      const av = a[index] ?? 0;
      const bv = b[index] ?? 0;
      if (av !== bv) return bv - av;
    }
    return 0;
  });
}

export function removeNodesAtPaths(root: Element, paths: SvgNodePath[]): number {
  let removed = 0;
  for (const path of sortSvgPathsForDeletion(paths)) {
    if (removeNodeAtPath(root, path)) removed += 1;
  }
  return removed;
}

export function childPath(parentPath: SvgNodePath, childIndex: number): SvgNodePath {
  return [...parentPath, childIndex];
}

export function getNodeAtPath(root: Element, path: SvgNodePath): Element | null {
  let current: Element = root;
  for (const index of path) {
    const child = current.children[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

/** Walk the SVG tree and return the index path to `target`, or null if not found. */
export function findNodePath(root: Element, target: Element): SvgNodePath | null {
  const walk = (node: Element, acc: SvgNodePath): SvgNodePath | null => {
    if (node === target) return acc;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      if (!child) continue;
      const found = walk(child, [...acc, index]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []);
}

/** Map tspan selections to their parent `<text>` for chrome, drag, and delete. */
export function normalizeSvgSelectionPath(
  svg: SVGSVGElement,
  path: SvgNodePath,
): SvgNodePath {
  const node = getNodeAtPath(svg, path);
  if (!node) return path;
  const textEl = resolveTextElement(node);
  if (!textEl || textEl === node) return path;
  return findNodePath(svg, textEl) ?? path;
}

/** Remove a child node at `path` (path must not be empty). */
export function removeNodeAtPath(root: Element, path: SvgNodePath): boolean {
  if (path.length === 0) return false;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  if (index === undefined) return false;
  const parent = parentPath.length === 0 ? root : getNodeAtPath(root, parentPath);
  if (!parent) return false;
  const child = parent.children[index];
  if (!child) return false;
  parent.removeChild(child);
  return true;
}

export function getFocusContainer(svg: SVGSVGElement, focusPath: SvgNodePath): Element {
  if (focusPath.length === 0) return svg;
  return getNodeAtPath(svg, focusPath) ?? svg;
}

export function isSvgInteractiveChild(el: Element): boolean {
  return !SVG_NON_INTERACTIVE_TAGS.has(el.localName.toLowerCase());
}

export function isSvgContainerElement(el: Element): boolean {
  const tag = el.localName.toLowerCase();
  if (!SVG_CONTAINER_TAGS.has(tag)) return false;
  return [...el.children].some(isSvgInteractiveChild);
}

export function isSvgTextElement(el: Element): boolean {
  return el.localName.toLowerCase() === "text";
}

export function resolveTextElement(el: Element): SVGTextElement | null {
  if (isSvgTextElement(el)) return el as SVGTextElement;
  const text = el.closest("text");
  return text ? (text as SVGTextElement) : null;
}

export function pathToTextElement(
  svg: SVGSVGElement,
  path: SvgNodePath,
): SVGTextElement | null {
  const node = getNodeAtPath(svg, path);
  if (!node) return null;
  return resolveTextElement(node);
}

const TRANSLATE_RE =
  /translate\s*\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?\s*\)/gi;

export function parseTransformTranslate(transform: string | null): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(TRANSLATE_RE.source, TRANSLATE_RE.flags);
  while ((match = re.exec(transform)) !== null) {
    x += Number(match[1]) || 0;
    y += Number(match[2] ?? 0) || 0;
  }
  return { x, y };
}

export function stripTranslateFromTransform(transform: string): string {
  return transform
    .replace(
      /translate\s*\(\s*[-\d.eE+]+\s*(?:[\s,]+\s*[-\d.eE+]+)?\s*\)/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function setTransformTranslate(
  el: Element,
  translate: { x: number; y: number },
): void {
  const existing = el.getAttribute("transform") ?? "";
  const stripped = stripTranslateFromTransform(existing);
  const next = `translate(${translate.x}, ${translate.y})`;
  el.setAttribute("transform", stripped ? `${next} ${stripped}` : next);
}

export function clientPointToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): DOMPoint {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (ctm) return pt.matrixTransform(ctm.inverse());
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const vbWidth = viewBox.width || Number(svg.getAttribute("width")) || rect.width || 1;
  const vbHeight = viewBox.height || Number(svg.getAttribute("height")) || rect.height || 1;
  const local = svg.createSVGPoint();
  local.x = viewBox.x + ((clientX - rect.left) / Math.max(rect.width, 1)) * vbWidth;
  local.y = viewBox.y + ((clientY - rect.top) / Math.max(rect.height, 1)) * vbHeight;
  return local;
}

export function hasSvgBBox(el: Element): el is SVGGraphicsElement {
  return typeof (el as SVGGraphicsElement).getBBox === "function";
}

/** Resolve the graphics element used for layout chrome and drag (text/tspan → `<text>`). */
export function resolveGraphicsElementForLayout(el: Element | null): SVGGraphicsElement | null {
  if (!el) return null;
  if (hasSvgBBox(el)) return el;
  const textEl = resolveTextElement(el);
  return textEl && hasSvgBBox(textEl) ? textEl : null;
}

export function elementHitAtClientPoint(
  el: Element,
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): boolean {
  if (!hasSvgBBox(el)) return false;
  try {
    const screenCtm = el.getScreenCTM?.() ?? null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = screenCtm
      ? pt.matrixTransform(screenCtm.inverse())
      : (() => {
          const svgLocal = clientPointToSvg(svg, clientX, clientY);
          const elCtm = el.getCTM?.() ?? null;
          if (!elCtm) return svgLocal;
          return svgLocal.matrixTransform(elCtm.inverse());
        })();
    if (el instanceof SVGGeometryElement) {
      if (typeof el.isPointInFill === "function" && el.isPointInFill(local)) return true;
      if (typeof el.isPointInStroke === "function" && el.isPointInStroke(local)) {
        return true;
      }
    }
    const bbox = el.getBBox();
    return (
      local.x >= bbox.x &&
      local.x <= bbox.x + bbox.width &&
      local.y >= bbox.y &&
      local.y <= bbox.y + bbox.height
    );
  } catch {
    return false;
  }
}

/** All direct children of `focusContainer` under the pointer (top-most first). */
export function hitTestFocusChildIndexes(
  focusContainer: Element,
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): number[] {
  const hits: number[] = [];
  const children = [...focusContainer.children];
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (!child || !isSvgInteractiveChild(child)) continue;
    if (elementHitAtClientPoint(child, svg, clientX, clientY)) hits.push(i);
  }
  return hits;
}

/** Top-most direct child of `focusContainer` under the pointer. */
export function hitTestFocusChildIndex(
  focusContainer: Element,
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): number | null {
  return hitTestFocusChildIndexes(focusContainer, svg, clientX, clientY)[0] ?? null;
}

export function describeSvgNodeForOverlapPicker(
  node: Element,
  language: SupportedLanguage = "zh",
): string {
  const tag = node.localName.toLowerCase();
  if (tag === "text") {
    const snippet = (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
    return snippet
      ? translate(language, "coursewareEditor.stage.svgNodeText", { snippet })
      : translate(language, "coursewareEditor.stage.svgNodeTextPlain");
  }
  if (tag === "tspan") return translate(language, "coursewareEditor.stage.svgNodeTextLine");
  const id = node.getAttribute("id")?.trim();
  if (id) return `${tag} #${id}`;
  const label =
    node.getAttribute("aria-label")?.trim() || node.getAttribute("data-name")?.trim();
  if (label) return `${tag} (${label})`;
  return tag;
}

export function serializeInlineSvgMarkup(host: HTMLElement): string | null {
  const svg = host.querySelector("svg");
  if (!svg) return null;
  for (const textEl of svg.querySelectorAll("text[data-svg-text-hidden]")) {
    const fo = textEl.nextElementSibling;
    if (
      fo &&
      fo.localName.toLowerCase() === "foreignobject" &&
      fo.hasAttribute(INLINE_TEXT_FO_ATTR)
    ) {
      const div = fo.querySelector("div");
      if (textEl instanceof SVGTextElement && div) {
        applySvgTextContent(textEl, div.textContent ?? "");
      }
    }
  }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const fo of clone.querySelectorAll(`foreignObject[${INLINE_TEXT_FO_ATTR}]`)) {
    fo.remove();
  }
  for (const el of clone.querySelectorAll("[data-svg-text-hidden]")) {
    el.removeAttribute("data-svg-text-hidden");
    if (el instanceof SVGElement) el.style.removeProperty("visibility");
  }
  for (const el of clone.querySelectorAll("[data-svg-edit-highlight]")) {
    el.removeAttribute("data-svg-edit-highlight");
    if (el instanceof SVGElement) {
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
    }
  }
  return clone.outerHTML;
}

export function setTextContentOnElement(textEl: SVGTextElement, text: string): void {
  applySvgTextContent(textEl, text);
}

/** Write editor text back to SVG; explicit newlines become stacked `<tspan>` rows. */
export function applySvgTextContent(textEl: SVGTextElement, raw: string): void {
  const lines = raw.split("\n");
  for (const child of [...textEl.children]) {
    if (child.localName.toLowerCase() === "tspan") {
      child.remove();
    }
  }
  if (lines.length <= 1) {
    textEl.textContent = lines[0] ?? "";
    return;
  }
  const anchorX = textEl.getAttribute("x");
  const lineHeightRaw = textEl.getAttribute("data-line-height");
  const lineHeight = lineHeightRaw ? Number(lineHeightRaw) : 1.25;
  const dy = `${Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1.25}em`;
  textEl.textContent = "";
  for (let index = 0; index < lines.length; index++) {
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    if (index > 0) {
      if (anchorX !== null) tspan.setAttribute("x", anchorX);
      tspan.setAttribute("dy", dy);
    }
    tspan.textContent = lines[index] ?? "";
    textEl.appendChild(tspan);
  }
}

const INLINE_TEXT_FO_ATTR = "data-svg-inline-text-fo";
const MIN_RESIZE_PX = 2;

export type SvgResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export const SVG_RESIZE_HANDLES: readonly SvgResizeHandle[] = [
  "nw",
  "ne",
  "sw",
  "se",
  "n",
  "s",
  "e",
  "w",
];

export function svgResizeCursor(handle: SvgResizeHandle): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    default:
      return "default";
  }
}

const parseAttrNumber = (el: Element, name: string, fallback = 0): number => {
  const raw = el.getAttribute(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

export function clientPointToElementLocal(
  el: SVGGraphicsElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const svg = el.ownerSVGElement;
  if (!svg || typeof svg.createSVGPoint !== "function") {
    return { x: clientX, y: clientY };
  }
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = el.getScreenCTM?.() ?? null;
  if (!ctm) return clientPointToParentLocal(el, clientX, clientY);
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

/** Pointer position in the coordinate space used by geometry attributes (parent user space). */
export function clientPointToParentLocal(
  el: SVGGraphicsElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const svg = el.ownerSVGElement;
  if (!svg || typeof svg.createSVGPoint !== "function") {
    return { x: clientX, y: clientY };
  }
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const parent = el.parentElement;
  if (parent instanceof SVGGraphicsElement) {
    const parentCtm = parent.getScreenCTM?.() ?? null;
    if (parentCtm) {
      const local = pt.matrixTransform(parentCtm.inverse());
      return { x: local.x, y: local.y };
    }
  }
  const svgLocal = clientPointToSvg(svg, clientX, clientY);
  return { x: svgLocal.x, y: svgLocal.y };
}

export interface ChildNodeSnapshot {
  element: Element;
  tag: string;
  values: Record<string, number>;
  transform: string;
  children: ChildNodeSnapshot[] | null;
}

export interface GenericResizeCapture {
  anchorLocalX: number;
  anchorLocalY: number;
  /** Resize anchor in the parent element's user coordinate system. */
  anchorParentX: number;
  anchorParentY: number;
  bboxWidth: number;
  bboxHeight: number;
  initialScaleX: number;
  initialScaleY: number;
  visualWidth: number;
  visualHeight: number;
  /** Resize anchor in screen (client) coordinates. */
  anchorScreenX: number;
  anchorScreenY: number;
  /** Visual size in screen pixels at capture. */
  visualScreenWidth: number;
  visualScreenHeight: number;
  tlScreenX: number;
  tlScreenY: number;
  groupTransformAtCapture: string;
  /** When present, resize distributes into child geometry instead of group matrix scale. */
  childSnapshots: ChildNodeSnapshot[] | null;
}

export interface SvgResizeCapture {
  handle: SvgResizeHandle;
  tag: string;
  startLocalX: number;
  startLocalY: number;
  attrs: Record<string, number>;
  /** Present for transform-based resize (`<g>`, `<path>`, nested `<svg>`, etc.). */
  generic: GenericResizeCapture | null;
}

function readResizeAttrs(el: Element, tag: string): Record<string, number> {
  switch (tag) {
    case "rect":
      return {
        x: parseAttrNumber(el, "x"),
        y: parseAttrNumber(el, "y"),
        width: parseAttrNumber(el, "width"),
        height: parseAttrNumber(el, "height"),
      };
    case "ellipse":
      return {
        cx: parseAttrNumber(el, "cx"),
        cy: parseAttrNumber(el, "cy"),
        rx: parseAttrNumber(el, "rx"),
        ry: parseAttrNumber(el, "ry"),
      };
    case "circle":
      return {
        cx: parseAttrNumber(el, "cx"),
        cy: parseAttrNumber(el, "cy"),
        r: parseAttrNumber(el, "r"),
      };
    case "text": {
      const fontSize = parseAttrNumber(el, "font-size", 16);
      return {
        x: parseAttrNumber(el, "x"),
        y: parseAttrNumber(el, "y"),
        fontSize,
      };
    }
    case "image":
      return {
        x: parseAttrNumber(el, "x"),
        y: parseAttrNumber(el, "y"),
        width: parseAttrNumber(el, "width"),
        height: parseAttrNumber(el, "height"),
      };
    default: {
      const bbox = (el as SVGGraphicsElement).getBBox();
      return {
        x: bbox.x,
        y: bbox.y,
        width: Math.max(bbox.width, MIN_RESIZE_PX),
        height: Math.max(bbox.height, MIN_RESIZE_PX),
      };
    }
  }
}

const ATTR_RESIZE_TAGS = new Set(["rect", "image", "ellipse", "circle", "text"]);

function transformPointWithCtm(
  ctm: SVGMatrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: ctm.a * x + ctm.c * y + ctm.e,
    y: ctm.b * x + ctm.d * y + ctm.f,
  };
}

/** Map a point in element-local bbox space to the parent element's user space. */
function localAnchorToParentSpace(
  el: SVGGraphicsElement,
  anchorLocalX: number,
  anchorLocalY: number,
): { x: number; y: number } {
  const svg = el.ownerSVGElement;
  const ctm = el.getCTM?.();
  if (!svg || !ctm || typeof svg.createSVGPoint !== "function") {
    return { x: anchorLocalX, y: anchorLocalY };
  }
  const anchorInViewport = transformPointWithCtm(ctm, anchorLocalX, anchorLocalY);
  const parent = el.parentElement;
  const parentEl =
    parent instanceof SVGGraphicsElement ? parent : svg;
  const parentCtm = parentEl.getCTM?.();
  if (!parentCtm) return { x: anchorLocalX, y: anchorLocalY };
  const pt = svg.createSVGPoint();
  pt.x = anchorInViewport.x;
  pt.y = anchorInViewport.y;
  const inParent = pt.matrixTransform(parentCtm.inverse());
  return { x: inParent.x, y: inParent.y };
}

function computeResizeAnchorLocal(
  attrs: Record<string, number>,
  handle: SvgResizeHandle,
): { x: number; y: number } {
  const { x, y, width, height } = attrs;
  return {
    x: handle.includes("w") ? x + width : x,
    y: handle.includes("n") ? y + height : y,
  };
}

const TEXT_COUNTER_TRANSFORM_RE =
  /(?:translate\(\s*[-\d.eE+]+\s+[-\d.eE+]+\s*\)\s*scale\(\s*[-\d.eE+]+\s+[-\d.eE+]+\s*\)\s*translate\(\s*[-\d.eE+]+\s+[-\d.eE+]+\s*\)|matrix\(\s*[-\d.eE+]+\s+0\s+0\s+[-\d.eE+]+\s+0\s+0\s*\))/gi;

function stripTextCounterTransform(transform: string): string {
  return transform.replace(TEXT_COUNTER_TRANSFORM_RE, "").replace(/\s+/g, " ").trim();
}

function containerHasTextDescendants(el: Element): boolean {
  return el.querySelector("text") !== null;
}

function scaleCoord(value: number, anchor: number, ratio: number): number {
  return anchor + (value - anchor) * ratio;
}

function parseMatrixFromTransform(transform: string): {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
} {
  const matrix = transform.match(/matrix\(\s*([^)]+)\)/i);
  if (matrix) {
    const parts = matrix[1]!.split(/[\s,]+/).map(Number);
    return {
      a: parts[0] ?? 1,
      b: parts[1] ?? 0,
      c: parts[2] ?? 0,
      d: parts[3] ?? 1,
      e: parts[4] ?? 0,
      f: parts[5] ?? 0,
    };
  }
  const translate = parseTransformTranslate(transform);
  return { a: 1, b: 0, c: 0, d: 1, e: translate.x, f: translate.y };
}

function translateOnlyGroupTransform(transform: string): string {
  const stripped = stripTextCounterTransform(transform);
  if (!stripped) return "";
  const { e, f } = parseMatrixFromTransform(stripped);
  if (e === 0 && f === 0) return "";
  return `translate(${e}, ${f})`;
}

function snapshotChildElement(el: Element): ChildNodeSnapshot {
  const tag = el.localName.toLowerCase();
  const values: Record<string, number> = {};
  const transform = stripTextCounterTransform(el.getAttribute("transform") ?? "");
  switch (tag) {
    case "text":
      values.x = parseAttrNumber(el, "x");
      values.y = parseAttrNumber(el, "y");
      values.fontSize = parseAttrNumber(el, "font-size", 16);
      break;
    case "rect":
    case "image":
      values.x = parseAttrNumber(el, "x");
      values.y = parseAttrNumber(el, "y");
      values.width = parseAttrNumber(el, "width");
      values.height = parseAttrNumber(el, "height");
      break;
    case "circle":
      values.cx = parseAttrNumber(el, "cx");
      values.cy = parseAttrNumber(el, "cy");
      values.r = parseAttrNumber(el, "r");
      break;
    case "ellipse":
      values.cx = parseAttrNumber(el, "cx");
      values.cy = parseAttrNumber(el, "cy");
      values.rx = parseAttrNumber(el, "rx");
      values.ry = parseAttrNumber(el, "ry");
      break;
    default:
      break;
  }
  const isContainer = tag === "g" || tag === "svg" || tag === "a" || tag === "switch";
  return {
    element: el,
    tag,
    values,
    transform,
    children: isContainer ? snapshotChildren(el) : null,
  };
}

function snapshotChildren(parent: Element): ChildNodeSnapshot[] {
  const out: ChildNodeSnapshot[] = [];
  for (const child of parent.children) {
    if (!isSvgInteractiveChild(child)) continue;
    out.push(snapshotChildElement(child));
  }
  return out;
}

function restoreChildSnapshot(snap: ChildNodeSnapshot): void {
  const el = snap.element;
  switch (snap.tag) {
    case "text":
      el.setAttribute("x", String(snap.values.x));
      el.setAttribute("y", String(snap.values.y));
      el.setAttribute("font-size", String(snap.values.fontSize));
      break;
    case "rect":
    case "image":
      el.setAttribute("x", String(snap.values.x));
      el.setAttribute("y", String(snap.values.y));
      el.setAttribute("width", String(snap.values.width));
      el.setAttribute("height", String(snap.values.height));
      break;
    case "circle":
      el.setAttribute("cx", String(snap.values.cx));
      el.setAttribute("cy", String(snap.values.cy));
      el.setAttribute("r", String(snap.values.r));
      break;
    case "ellipse":
      el.setAttribute("cx", String(snap.values.cx));
      el.setAttribute("cy", String(snap.values.cy));
      el.setAttribute("rx", String(snap.values.rx));
      el.setAttribute("ry", String(snap.values.ry));
      break;
    default:
      break;
  }
  if (snap.transform) el.setAttribute("transform", snap.transform);
  else el.removeAttribute("transform");
  snap.children?.forEach(restoreChildSnapshot);
}

function applyScaleToChildSnapshot(
  snap: ChildNodeSnapshot,
  anchorX: number,
  anchorY: number,
  ratioX: number,
  ratioY: number,
): void {
  const fontScale = uniformScaleFactor(ratioX, ratioY);
  const el = snap.element;
  switch (snap.tag) {
    case "text": {
      el.setAttribute("x", String(scaleCoord(snap.values.x!, anchorX, ratioX)));
      el.setAttribute("y", String(scaleCoord(snap.values.y!, anchorY, ratioY)));
      el.setAttribute(
        "font-size",
        String(Math.max(4, snap.values.fontSize! * fontScale)),
      );
      if (snap.transform) el.setAttribute("transform", snap.transform);
      else el.removeAttribute("transform");
      break;
    }
    case "rect":
    case "image": {
      el.setAttribute("x", String(scaleCoord(snap.values.x!, anchorX, ratioX)));
      el.setAttribute("y", String(scaleCoord(snap.values.y!, anchorY, ratioY)));
      el.setAttribute(
        "width",
        String(Math.max(MIN_RESIZE_PX, snap.values.width! * ratioX)),
      );
      el.setAttribute(
        "height",
        String(Math.max(MIN_RESIZE_PX, snap.values.height! * ratioY)),
      );
      if (snap.transform) el.setAttribute("transform", snap.transform);
      else el.removeAttribute("transform");
      break;
    }
    case "circle": {
      el.setAttribute("cx", String(scaleCoord(snap.values.cx!, anchorX, ratioX)));
      el.setAttribute("cy", String(scaleCoord(snap.values.cy!, anchorY, ratioY)));
      el.setAttribute("r", String(Math.max(MIN_RESIZE_PX, snap.values.r! * fontScale)));
      if (snap.transform) el.setAttribute("transform", snap.transform);
      else el.removeAttribute("transform");
      break;
    }
    case "ellipse": {
      el.setAttribute("cx", String(scaleCoord(snap.values.cx!, anchorX, ratioX)));
      el.setAttribute("cy", String(scaleCoord(snap.values.cy!, anchorY, ratioY)));
      el.setAttribute("rx", String(Math.max(MIN_RESIZE_PX, snap.values.rx! * ratioX)));
      el.setAttribute("ry", String(Math.max(MIN_RESIZE_PX, snap.values.ry! * ratioY)));
      if (snap.transform) el.setAttribute("transform", snap.transform);
      else el.removeAttribute("transform");
      break;
    }
    case "g":
    case "svg":
    case "a":
    case "switch": {
      const translate = parseTransformTranslate(snap.transform);
      const newTx = scaleCoord(translate.x, anchorX, ratioX);
      const newTy = scaleCoord(translate.y, anchorY, ratioY);
      const hasComplex = /scale|matrix|rotate|skew/i.test(snap.transform);
      if (hasComplex) {
        if (snap.transform) el.setAttribute("transform", snap.transform);
      } else if (newTx !== 0 || newTy !== 0) {
        el.setAttribute("transform", `translate(${newTx}, ${newTy})`);
      } else {
        el.removeAttribute("transform");
      }
      const nestedAnchorX = anchorX - newTx;
      const nestedAnchorY = anchorY - newTy;
      snap.children?.forEach((child) =>
        applyScaleToChildSnapshot(child, nestedAnchorX, nestedAnchorY, ratioX, ratioY),
      );
      return;
    }
    default:
      if (snap.transform) el.setAttribute("transform", snap.transform);
      else el.removeAttribute("transform");
      break;
  }
  snap.children?.forEach((child) =>
    applyScaleToChildSnapshot(child, anchorX, anchorY, ratioX, ratioY),
  );
}

function bakeGroupMatrixScaleIntoChildren(
  group: SVGGraphicsElement,
  attrs: Record<string, number>,
): void {
  const transform = group.getAttribute("transform") ?? "";
  const matrix = parseMatrixFromTransform(transform);
  const hasScale =
    Math.abs(matrix.a - 1) > 1e-4 ||
    Math.abs(matrix.d - 1) > 1e-4 ||
    Math.abs(matrix.b) > 1e-4 ||
    Math.abs(matrix.c) > 1e-4;
  if (!hasScale) return;
  const snapshots = snapshotChildren(group);
  const anchorX = attrs.x;
  const anchorY = attrs.y;
  for (const snap of snapshots) {
    applyScaleToChildSnapshot(snap, anchorX, anchorY, matrix.a, matrix.d);
  }
  const translateOnly = translateOnlyGroupTransform(transform);
  if (translateOnly) group.setAttribute("transform", translateOnly);
  else group.removeAttribute("transform");
}

function uniformScaleFactor(scaleX: number, scaleY: number): number {
  return Math.sqrt(Math.max(scaleX, 1e-6) * Math.max(scaleY, 1e-6));
}

function localPointToScreen(
  svg: SVGSVGElement,
  matrix: SVGMatrix,
  localX: number,
  localY: number,
): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = localX;
  pt.y = localY;
  const screen = pt.matrixTransform(matrix);
  return { x: screen.x, y: screen.y };
}

export function computeGenericResizeScales(
  generic: GenericResizeCapture,
  handle: SvgResizeHandle,
  clientX: number,
  clientY: number,
): { scaleX: number; scaleY: number } {
  const w0 = generic.bboxWidth;
  const h0 = generic.bboxHeight;

  let scaleX = generic.initialScaleX;
  let scaleY = generic.initialScaleY;

  if (handle.includes("e")) {
    const span = Math.max(clientX - generic.anchorScreenX, MIN_RESIZE_PX);
    scaleX = Math.max(
      MIN_RESIZE_PX / w0,
      generic.initialScaleX * (span / generic.visualScreenWidth),
    );
  } else if (handle.includes("w")) {
    const span = Math.max(generic.anchorScreenX - clientX, MIN_RESIZE_PX);
    scaleX = Math.max(
      MIN_RESIZE_PX / w0,
      generic.initialScaleX * (span / generic.visualScreenWidth),
    );
  }

  if (handle.includes("s")) {
    const span = Math.max(clientY - generic.anchorScreenY, MIN_RESIZE_PX);
    scaleY = Math.max(
      MIN_RESIZE_PX / h0,
      generic.initialScaleY * (span / generic.visualScreenHeight),
    );
  } else if (handle.includes("n")) {
    const span = Math.max(generic.anchorScreenY - clientY, MIN_RESIZE_PX);
    scaleY = Math.max(
      MIN_RESIZE_PX / h0,
      generic.initialScaleY * (span / generic.visualScreenHeight),
    );
  }

  return { scaleX, scaleY };
}

export function computeGenericResizeRatios(
  generic: GenericResizeCapture,
  handle: SvgResizeHandle,
  clientX: number,
  clientY: number,
): { scaleX: number; scaleY: number; ratioX: number; ratioY: number } {
  const { scaleX, scaleY } = computeGenericResizeScales(
    generic,
    handle,
    clientX,
    clientY,
  );
  return {
    scaleX,
    scaleY,
    ratioX: scaleX / Math.max(generic.initialScaleX, 1e-6),
    ratioY: scaleY / Math.max(generic.initialScaleY, 1e-6),
  };
}

/** Selection chrome during generic resize — computed in screen space to match drag handles. */
export function getGenericResizeChromeRectInContainer(
  container: HTMLElement,
  generic: GenericResizeCapture,
  handle: SvgResizeHandle,
  clientX: number,
  clientY: number,
): { left: number; top: number; width: number; height: number } | null {
  const { ratioX, ratioY } = computeGenericResizeRatios(
    generic,
    handle,
    clientX,
    clientY,
  );
  const newTlX =
    generic.anchorScreenX + (generic.tlScreenX - generic.anchorScreenX) * ratioX;
  const newTlY =
    generic.anchorScreenY + (generic.tlScreenY - generic.anchorScreenY) * ratioY;
  const width = Math.max(generic.visualScreenWidth * ratioX, 1);
  const height = Math.max(generic.visualScreenHeight * ratioY, 1);
  const containerRect = container.getBoundingClientRect();
  return {
    left: newTlX - containerRect.left,
    top: newTlY - containerRect.top,
    width,
    height,
  };
}

export function getDistributedResizeBbox(
  attrs: Record<string, number>,
  generic: GenericResizeCapture,
  ratioX: number,
  ratioY: number,
): { x: number; y: number; width: number; height: number } {
  const { x, y, width, height } = attrs;
  const ax = generic.anchorLocalX;
  const ay = generic.anchorLocalY;
  return {
    x: scaleCoord(x, ax, ratioX),
    y: scaleCoord(y, ay, ratioY),
    width: Math.max(width * ratioX, MIN_RESIZE_PX),
    height: Math.max(height * ratioY, MIN_RESIZE_PX),
  };
}

/** Selection chrome from a frozen bbox + the element's live CTM (ignores child counter-transforms). */
export function getScaledBboxRectInContainer(
  el: SVGGraphicsElement,
  container: HTMLElement,
  bbox: { x: number; y: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } | null {
  const ctm = el.getCTM?.();
  const svg = el.ownerSVGElement;
  if (!ctm || !svg || typeof svg.createSVGPoint !== "function") return null;
  try {
    const containerRect = container.getBoundingClientRect();
    const pt = svg.createSVGPoint();
    const corners = [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x, y: bbox.y + bbox.height },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      pt.x = corner.x;
      pt.y = corner.y;
      const screen = pt.matrixTransform(ctm);
      minX = Math.min(minX, screen.x);
      minY = Math.min(minY, screen.y);
      maxX = Math.max(maxX, screen.x);
      maxY = Math.max(maxY, screen.y);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 && height <= 0) return null;
    return {
      left: minX - containerRect.left,
      top: minY - containerRect.top,
      width: Math.max(width, 1),
      height: Math.max(height, 1),
    };
  } catch {
    return null;
  }
}

function buildGenericResizeCapture(
  el: SVGGraphicsElement,
  attrs: Record<string, number>,
  handle: SvgResizeHandle,
): GenericResizeCapture | null {
  const svg = el.ownerSVGElement;
  const ctm = el.getCTM?.();
  const screenCtm = el.getScreenCTM?.();
  if (!svg || !ctm || !screenCtm) return null;
  const bboxWidth = Math.max(attrs.width, MIN_RESIZE_PX);
  const bboxHeight = Math.max(attrs.height, MIN_RESIZE_PX);
  const anchor = computeResizeAnchorLocal(attrs, handle);
  let topLeft = transformPointWithCtm(ctm, attrs.x, attrs.y);
  let bottomRight = transformPointWithCtm(ctm, attrs.x + bboxWidth, attrs.y + bboxHeight);
  let visualW = Math.max(Math.abs(bottomRight.x - topLeft.x), MIN_RESIZE_PX);
  let visualH = Math.max(Math.abs(bottomRight.y - topLeft.y), MIN_RESIZE_PX);
  const hasText = containerHasTextDescendants(el);
  if (hasText) {
    bakeGroupMatrixScaleIntoChildren(el, attrs);
    const ctmAfter = el.getCTM?.() ?? ctm;
    const screenCtmAfter = el.getScreenCTM?.() ?? screenCtm;
    topLeft = transformPointWithCtm(ctmAfter, attrs.x, attrs.y);
    bottomRight = transformPointWithCtm(ctmAfter, attrs.x + bboxWidth, attrs.y + bboxHeight);
    visualW = Math.max(Math.abs(bottomRight.x - topLeft.x), MIN_RESIZE_PX);
    visualH = Math.max(Math.abs(bottomRight.y - topLeft.y), MIN_RESIZE_PX);
    const tlScreen = localPointToScreen(svg, screenCtmAfter, attrs.x, attrs.y);
    const brScreen = localPointToScreen(
      svg,
      screenCtmAfter,
      attrs.x + bboxWidth,
      attrs.y + bboxHeight,
    );
    const anchorScreen = localPointToScreen(svg, screenCtmAfter, anchor.x, anchor.y);
    const bakedMatrix = parseMatrixFromTransform(el.getAttribute("transform") ?? "");
    const anchorParent = localAnchorToParentSpace(el, anchor.x, anchor.y);
    return {
      anchorLocalX: anchor.x,
      anchorLocalY: anchor.y,
      anchorParentX: anchorParent.x,
      anchorParentY: anchorParent.y,
      bboxWidth,
      bboxHeight,
      initialScaleX: bakedMatrix.a,
      initialScaleY: bakedMatrix.d,
      visualWidth: visualW,
      visualHeight: visualH,
      anchorScreenX: anchorScreen.x,
      anchorScreenY: anchorScreen.y,
      visualScreenWidth: Math.max(Math.abs(brScreen.x - tlScreen.x), MIN_RESIZE_PX),
      visualScreenHeight: Math.max(Math.abs(brScreen.y - tlScreen.y), MIN_RESIZE_PX),
      tlScreenX: tlScreen.x,
      tlScreenY: tlScreen.y,
      groupTransformAtCapture: el.getAttribute("transform") ?? "",
      childSnapshots: snapshotChildren(el),
    };
  }
  const tlScreen = localPointToScreen(svg, screenCtm, attrs.x, attrs.y);
  const brScreen = localPointToScreen(
    svg,
    screenCtm,
    attrs.x + bboxWidth,
    attrs.y + bboxHeight,
  );
  const anchorScreen = localPointToScreen(svg, screenCtm, anchor.x, anchor.y);
  const localMatrix = parseMatrixFromTransform(el.getAttribute("transform") ?? "");
  const anchorParent = localAnchorToParentSpace(el, anchor.x, anchor.y);
  return {
    anchorLocalX: anchor.x,
    anchorLocalY: anchor.y,
    anchorParentX: anchorParent.x,
    anchorParentY: anchorParent.y,
    bboxWidth,
    bboxHeight,
    initialScaleX: localMatrix.a,
    initialScaleY: localMatrix.d,
    visualWidth: visualW,
    visualHeight: visualH,
    anchorScreenX: anchorScreen.x,
    anchorScreenY: anchorScreen.y,
    visualScreenWidth: Math.max(Math.abs(brScreen.x - tlScreen.x), MIN_RESIZE_PX),
    visualScreenHeight: Math.max(Math.abs(brScreen.y - tlScreen.y), MIN_RESIZE_PX),
    tlScreenX: tlScreen.x,
    tlScreenY: tlScreen.y,
    groupTransformAtCapture: el.getAttribute("transform") ?? "",
    childSnapshots: null,
  };
}

function pointerLocalForResize(
  el: SVGGraphicsElement,
  tag: string,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (ATTR_RESIZE_TAGS.has(tag)) {
    return clientPointToParentLocal(el, clientX, clientY);
  }
  return clientPointToElementLocal(el, clientX, clientY);
}

export function beginSvgResizeCapture(
  el: SVGGraphicsElement,
  handle: SvgResizeHandle,
  clientX: number,
  clientY: number,
): SvgResizeCapture {
  const tag = el.localName.toLowerCase();
  const attrs = readResizeAttrs(el, tag);
  const local = pointerLocalForResize(el, tag, clientX, clientY);
  const generic = ATTR_RESIZE_TAGS.has(tag)
    ? null
    : buildGenericResizeCapture(el, attrs, handle);
  return {
    handle,
    tag,
    startLocalX: local.x,
    startLocalY: local.y,
    attrs,
    generic,
  };
}

function setGenericScaleResize(
  el: SVGGraphicsElement,
  capture: SvgResizeCapture,
  clientX: number,
  clientY: number,
): void {
  const generic = capture.generic;
  if (!generic) return;
  const svg = el.ownerSVGElement;
  if (!svg) return;
  const { scaleX, scaleY, ratioX, ratioY } = computeGenericResizeRatios(
    generic,
    capture.handle,
    clientX,
    clientY,
  );

  if (generic.childSnapshots && generic.childSnapshots.length > 0) {
    for (const snap of generic.childSnapshots) restoreChildSnapshot(snap);
    const translateOnly = translateOnlyGroupTransform(generic.groupTransformAtCapture);
    if (translateOnly) el.setAttribute("transform", translateOnly);
    else el.removeAttribute("transform");
    for (const snap of generic.childSnapshots) {
      applyScaleToChildSnapshot(
        snap,
        generic.anchorLocalX,
        generic.anchorLocalY,
        ratioX,
        ratioY,
      );
    }
    return;
  }

  const e = generic.anchorParentX - scaleX * generic.anchorLocalX;
  const f = generic.anchorParentY - scaleY * generic.anchorLocalY;
  el.setAttribute("transform", `matrix(${scaleX} 0 0 ${scaleY} ${e} ${f})`);
}

export function applySvgResizeDrag(
  el: SVGGraphicsElement,
  capture: SvgResizeCapture,
  clientX: number,
  clientY: number,
): void {
  const local = pointerLocalForResize(el, capture.tag, clientX, clientY);
  const dx = local.x - capture.startLocalX;
  const dy = local.y - capture.startLocalY;
  const a = capture.attrs;
  const handle = capture.handle;

  switch (capture.tag) {
    case "rect": {
      let x = a.x;
      let y = a.y;
      let width = a.width;
      let height = a.height;
      if (handle.includes("e")) width = Math.max(MIN_RESIZE_PX, a.width + dx);
      if (handle.includes("w")) {
        width = Math.max(MIN_RESIZE_PX, a.width - dx);
        x = a.x + dx;
      }
      if (handle.includes("s")) height = Math.max(MIN_RESIZE_PX, a.height + dy);
      if (handle.includes("n")) {
        height = Math.max(MIN_RESIZE_PX, a.height - dy);
        y = a.y + dy;
      }
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(y));
      el.setAttribute("width", String(width));
      el.setAttribute("height", String(height));
      return;
    }
    case "image": {
      let x = a.x;
      let y = a.y;
      let width = a.width;
      let height = a.height;
      if (handle.includes("e")) width = Math.max(MIN_RESIZE_PX, a.width + dx);
      if (handle.includes("w")) {
        width = Math.max(MIN_RESIZE_PX, a.width - dx);
        x = a.x + dx;
      }
      if (handle.includes("s")) height = Math.max(MIN_RESIZE_PX, a.height + dy);
      if (handle.includes("n")) {
        height = Math.max(MIN_RESIZE_PX, a.height - dy);
        y = a.y + dy;
      }
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(y));
      el.setAttribute("width", String(Math.max(width, MIN_RESIZE_PX)));
      el.setAttribute("height", String(Math.max(height, MIN_RESIZE_PX)));
      return;
    }
    case "ellipse": {
      let cx = a.cx;
      let cy = a.cy;
      let rx = a.rx;
      let ry = a.ry;
      if (handle.includes("e")) rx = Math.max(MIN_RESIZE_PX, a.rx + dx);
      if (handle.includes("w")) {
        rx = Math.max(MIN_RESIZE_PX, a.rx - dx);
        cx = a.cx + dx;
      }
      if (handle.includes("s")) ry = Math.max(MIN_RESIZE_PX, a.ry + dy);
      if (handle.includes("n")) {
        ry = Math.max(MIN_RESIZE_PX, a.ry - dy);
        cy = a.cy + dy;
      }
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(cy));
      el.setAttribute("rx", String(rx));
      el.setAttribute("ry", String(ry));
      return;
    }
    case "circle": {
      let delta = 0;
      if (handle === "e") delta = dx;
      else if (handle === "w") delta = -dx;
      else if (handle === "s") delta = dy;
      else if (handle === "n") delta = -dy;
      else delta = (dx + dy) / 2;
      const r = Math.max(MIN_RESIZE_PX, a.r + delta);
      el.setAttribute("cx", String(a.cx));
      el.setAttribute("cy", String(a.cy));
      el.setAttribute("r", String(r));
      return;
    }
    case "text": {
      const delta =
        handle === "e" || handle === "w"
          ? dx
          : handle === "n" || handle === "s"
            ? -dy
            : (dx - dy) / 2;
      const fontSize = Math.max(4, a.fontSize + delta * 0.35);
      el.setAttribute("font-size", String(fontSize));
      return;
    }
    default:
      setGenericScaleResize(el, capture, clientX, clientY);
  }
}

export function readTextElementPosition(textEl: SVGTextElement): {
  x: number;
  y: number;
  transform: { x: number; y: number };
} {
  return {
    x: parseAttrNumber(textEl, "x"),
    y: parseAttrNumber(textEl, "y"),
    transform: parseTransformTranslate(textEl.getAttribute("transform")),
  };
}

export function applyTextElementPositionDelta(
  textEl: SVGTextElement,
  delta: { x: number; y: number },
  base: { x: number; y: number; transform: { x: number; y: number } },
): void {
  textEl.setAttribute("x", String(base.x + delta.x));
  textEl.setAttribute("y", String(base.y + delta.y));
  if (base.transform.x !== 0 || base.transform.y !== 0) {
    setTransformTranslate(textEl, base.transform);
  }
}

/** Nudge a selected SVG sub-node by logical user-space delta. */
export function nudgeSvgNodePosition(node: Element, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const textEl = isSvgTextElement(node)
    ? (node as SVGTextElement)
    : resolveTextElement(node);
  if (textEl) {
    const base = readTextElementPosition(textEl);
    applyTextElementPositionDelta(textEl, { x: dx, y: dy }, base);
    return;
  }
  const base = parseTransformTranslate(node.getAttribute("transform"));
  setTransformTranslate(node, { x: base.x + dx, y: base.y + dy });
}

export function getUnionElementRectInContainer(
  elements: Element[],
  container: HTMLElement,
): { left: number; top: number; width: number; height: number } | null {
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  for (const el of elements) {
    const graphics = resolveGraphicsElementForLayout(el);
    if (!graphics) continue;
    const rect = getElementRectInContainer(graphics, container);
    if (!rect) continue;
    minLeft = Math.min(minLeft, rect.left);
    minTop = Math.min(minTop, rect.top);
    maxRight = Math.max(maxRight, rect.left + rect.width);
    maxBottom = Math.max(maxBottom, rect.top + rect.height);
  }
  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) return null;
  const width = maxRight - minLeft;
  const height = maxBottom - minTop;
  if (width <= 0 && height <= 0) return null;
  return {
    left: minLeft,
    top: minTop,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

export function getElementRectInContainer(
  el: Element,
  container: HTMLElement,
): { left: number; top: number; width: number; height: number } | null {
  const graphics = resolveGraphicsElementForLayout(el);
  if (!graphics) return null;
  try {
    const containerRect = container.getBoundingClientRect();
    const elRect = graphics.getBoundingClientRect();
    if (elRect.width > 0 || elRect.height > 0) {
      return {
        left: elRect.left - containerRect.left,
        top: elRect.top - containerRect.top,
        width: elRect.width,
        height: elRect.height,
      };
    }
    const bbox = graphics.getBBox();
    const ctm = graphics.getScreenCTM?.() ?? null;
    if (!ctm || (bbox.width <= 0 && bbox.height <= 0)) return null;
    const svg = graphics.ownerSVGElement;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    const corners = [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x, y: bbox.y + bbox.height },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      pt.x = corner.x;
      pt.y = corner.y;
      const screen = pt.matrixTransform(ctm);
      minX = Math.min(minX, screen.x);
      minY = Math.min(minY, screen.y);
      maxX = Math.max(maxX, screen.x);
      maxY = Math.max(maxY, screen.y);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 && height <= 0) return null;
    return {
      left: minX - containerRect.left,
      top: minY - containerRect.top,
      width: Math.max(width, 1),
      height: Math.max(height, 1),
    };
  } catch {
    return null;
  }
}

export interface InlineSvgTextEditorSession {
  commit: () => string;
  focus: () => void;
}

function readSvgTextEditorStyle(textEl: SVGTextElement): string {
  const snapshot = readSvgTextStyleSnapshot(textEl);
  return [
    "margin:0",
    "padding:0",
    "border:0",
    "outline:none",
    "background:transparent",
    "box-sizing:border-box",
    "display:block",
    "width:100%",
    "min-width:1ch",
    "max-width:none",
    "overflow:visible",
    "white-space:pre",
    `color:${snapshot.color}`,
    `font-size:${snapshot.fontSize}px`,
    `font-family:${snapshot.fontFamily}`,
    `font-weight:${snapshot.bold ? 700 : "normal"}`,
    `font-style:${snapshot.italic ? "italic" : "normal"}`,
    `text-align:${snapshot.align}`,
    `line-height:${snapshot.lineHeight}`,
    snapshot.backgroundColor !== "transparent"
      ? `background-color:${snapshot.backgroundColor}`
      : "",
  ]
    .filter(Boolean)
    .join(";");
}

function syncForeignObjectEditorSize(
  fo: SVGForeignObjectElement,
  div: HTMLDivElement,
  textEl: SVGTextElement,
): void {
  layoutInlineSvgTextEditorForeignObject(fo, div, textEl);
}

/** Mount a `foreignObject` editor at the text's bbox so editing happens in place. */
export function mountInlineSvgTextEditor(
  textEl: SVGTextElement,
  options?: {
    onInput?: (text: string) => void;
    onCommit?: () => void;
  },
): InlineSvgTextEditorSession {
  unmountInlineSvgTextEditor(textEl);

  const parent = textEl.parentNode;
  if (!parent) {
    return {
      commit: () => textEl.textContent ?? "",
      focus: () => undefined,
    };
  }

  const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  fo.setAttribute(INLINE_TEXT_FO_ATTR, "true");

  const div = document.createElement("div");
  div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  div.contentEditable = "true";
  div.spellcheck = false;
  div.textContent = readSvgTextContentForEditor(textEl);
  div.style.cssText = readSvgTextEditorStyle(textEl);
  div.style.outline = "2px solid rgba(59, 130, 246, 0.9)";
  div.style.outlineOffset = "2px";

  const handleInput = () => {
    options?.onInput?.(div.textContent ?? "");
    syncForeignObjectEditorSize(fo, div, textEl);
  };
  const handleBlur = () => options?.onCommit?.();
  div.addEventListener("input", handleInput);
  div.addEventListener("blur", handleBlur);

  fo.appendChild(div);
  parent.insertBefore(fo, textEl.nextSibling);
  syncForeignObjectEditorSize(fo, div, textEl);
  textEl.setAttribute("data-svg-text-hidden", "true");
  textEl.style.visibility = "hidden";

  return {
    commit: () => {
      div.removeEventListener("input", handleInput);
      div.removeEventListener("blur", handleBlur);
      const next = div.textContent ?? "";
      unmountInlineSvgTextEditor(textEl);
      applySvgTextContent(textEl, next);
      return next;
    },
    focus: () => {
      div.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(div);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    },
  };
}

export function unmountInlineSvgTextEditor(textEl: SVGTextElement): void {
  const next = textEl.nextElementSibling;
  if (
    next &&
    next.localName.toLowerCase() === "foreignobject" &&
    next.hasAttribute(INLINE_TEXT_FO_ATTR)
  ) {
    next.remove();
  }
  textEl.removeAttribute("data-svg-text-hidden");
  textEl.style.removeProperty("visibility");
}

const SVG_EDIT_HIGHLIGHT_OUTLINE = "1px dashed rgba(59, 130, 246, 0.55)";

export function clearSvgEditHighlights(svg: SVGSVGElement): void {
  for (const el of svg.querySelectorAll("[data-svg-edit-highlight]")) {
    el.removeAttribute("data-svg-edit-highlight");
    if (el instanceof SVGElement) {
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
    }
  }
  for (const el of svg.querySelectorAll("*")) {
    if (!(el instanceof SVGElement)) continue;
    if (el.style.outline === SVG_EDIT_HIGHLIGHT_OUTLINE) {
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
      el.removeAttribute("data-svg-edit-highlight");
    }
  }
}

export function applySvgEditHighlights(
  svg: SVGSVGElement,
  focusPath: SvgNodePath,
  selectedPaths: SvgNodePath[],
): void {
  clearSvgEditHighlights(svg);
  // Only show sibling hints after drilling into a container (double-click a group).
  if (focusPath.length === 0) return;
  const focus = getFocusContainer(svg, focusPath);
  for (let index = 0; index < focus.children.length; index++) {
    const child = focus.children[index];
    if (!child || !isSvgInteractiveChild(child)) continue;
    const childFullPath = childPath(focusPath, index);
    if (isSvgPathSelected(selectedPaths, childFullPath)) continue;
    child.setAttribute("data-svg-edit-highlight", "focus");
    if (child instanceof SVGElement) {
      child.style.outline = "1px dashed rgba(59, 130, 246, 0.55)";
      child.style.outlineOffset = "1px";
    }
  }
}
