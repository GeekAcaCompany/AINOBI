// SPDX-License-Identifier: AGPL-3.0-only
/** Utilities for rich-element internal layer editing on the courseware canvas. */

import { translate, type SupportedLanguage } from "@ainobi/courseware-player/lib/i18n/index";
import type { RichAstNode } from "@ainobi/courseware-core/rich-ast.ts";
import { SVG_RESIZE_HANDLES, svgResizeCursor, type SvgResizeHandle } from "@ainobi/courseware-player/lib/courseware/svg-edit";

export type RichNodePath = number[];

export { SVG_RESIZE_HANDLES, svgResizeCursor };
export type { SvgResizeHandle };

const MIN_RESIZE_PX = 8;

export function pathKey(path: RichNodePath): string {
  return path.join(".");
}

export function pathsEqual(
  a: RichNodePath | null | undefined,
  b: RichNodePath | null | undefined,
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function childPath(parentPath: RichNodePath, childIndex: number): RichNodePath {
  return [...parentPath, childIndex];
}

export function parseRichNodePath(raw: string | null | undefined): RichNodePath | null {
  if (raw === null || raw === undefined) return null;
  if (raw === "") return [];
  const parts = raw.split(".");
  if (parts.some((part) => part === "" || !Number.isFinite(Number(part)))) return null;
  return parts.map((part) => Number.parseInt(part, 10));
}

export function getRichAstNodeAtPath(node: RichAstNode, path: RichNodePath): RichAstNode | null {
  if (path.length === 0) return node;
  if (node.kind !== "element") return null;
  const [head, ...rest] = path;
  const child = node.children[head];
  return child ? getRichAstNodeAtPath(child, rest) : null;
}

export function isRichContainerNode(node: RichAstNode | null): boolean {
  if (!node || node.kind !== "element") return false;
  return node.children.some((child) => child.kind === "element");
}

export function isRichElementNode(node: RichAstNode | null): boolean {
  return Boolean(node && node.kind === "element");
}

export function getRichElementStyleAtPath(
  node: RichAstNode,
  path: RichNodePath,
): Record<string, string | number> {
  const target = getRichAstNodeAtPath(node, path);
  if (!target || target.kind !== "element") return {};
  const style = target.props.style;
  return style && typeof style === "object" && !Array.isArray(style)
    ? ({ ...style } as Record<string, string | number>)
    : {};
}

export function readRichMarginPx(
  style: Record<string, string | number>,
  key: "marginTop" | "marginRight" | "marginBottom" | "marginLeft",
): number {
  const raw = style[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

export function buildRichMarginNudgePatch(
  layout: RichAstNode,
  path: RichNodePath,
  dx: number,
  dy: number,
): Record<string, string> | null {
  if (dx === 0 && dy === 0) return null;
  const target = getRichAstNodeAtPath(layout, path);
  if (!target || target.kind !== "element") return null;
  const style = getRichElementStyleAtPath(layout, path);
  const patch: Record<string, string> = {};
  if (dy !== 0) {
    patch.marginTop = `${readRichMarginPx(style, "marginTop") + dy}px`;
  }
  if (dx !== 0) {
    patch.marginLeft = `${readRichMarginPx(style, "marginLeft") + dx}px`;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Remove a child node at `path` (cannot remove the layout root). */
export function removeRichNodeAtPath(
  node: RichAstNode,
  path: RichNodePath,
): RichAstNode | null {
  if (path.length === 0) return null;
  if (node.kind !== "element") return null;
  if (path.length === 1) {
    const index = path[0];
    if (index === undefined || index < 0 || index >= node.children.length) return null;
    const children = [...node.children];
    children.splice(index, 1);
    return { ...node, children };
  }
  const [head, ...rest] = path;
  const child = node.children[head];
  if (!child) return null;
  const nextChild = removeRichNodeAtPath(child, rest);
  if (!nextChild) return null;
  const children = [...node.children];
  children[head] = nextChild;
  return { ...node, children };
}

export function focusPathAfterRichNodeDelete(
  focusPath: RichNodePath,
  deletedPath: RichNodePath,
): RichNodePath {
  if (deletedPath.length === 0) return focusPath;

  if (
    focusPath.length >= deletedPath.length &&
    deletedPath.every((value, index) => focusPath[index] === value)
  ) {
    return deletedPath.slice(0, -1);
  }

  const next = [...focusPath];
  const depth = deletedPath.length - 1;
  if (depth < 0) return focusPath;
  const parentMatches = deletedPath
    .slice(0, depth)
    .every((value, index) => (next[index] ?? -1) === value);
  if (!parentMatches) return focusPath;
  const deletedIndex = deletedPath[depth] ?? -1;
  if ((next[depth] ?? -1) > deletedIndex) {
    next[depth] -= 1;
  }
  return next;
}

export function getDomElementAtPath(root: HTMLElement, path: RichNodePath): HTMLElement | null {
  if (path.length === 0) return root;
  return root.querySelector(`[data-rich-node-path="${pathKey(path)}"]`) as HTMLElement | null;
}

const RICH_EDIT_OVERLAY_ATTR = "data-rich-edit-overlay";
const RICH_EDIT_CHROME_ATTR = "data-rich-edit-chrome";

export function isRichEditChromeElement(el: Element): boolean {
  return Boolean(el.closest(`[${RICH_EDIT_CHROME_ATTR}]`));
}

/** Topmost rendered rich node under the pointer, skipping editor chrome overlays. */
export function getRichHitElementAtClientPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): Element | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el.hasAttribute(RICH_EDIT_OVERLAY_ATTR)) continue;
    if (isRichEditChromeElement(el)) continue;
    if (root.contains(el)) return el;
  }
  return null;
}

export { RICH_EDIT_CHROME_ATTR, RICH_EDIT_OVERLAY_ATTR };

export function getDomRectInContainer(
  el: HTMLElement,
  container: HTMLElement,
): { left: number; top: number; width: number; height: number } | null {
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (elRect.width <= 0 && elRect.height <= 0) return null;
  return {
    left: elRect.left - containerRect.left,
    top: elRect.top - containerRect.top,
    width: elRect.width,
    height: elRect.height,
  };
}

/** Resolve the AST element path for a pointer hit within the current focus layer. */
export function resolveRichSelectionPathFromHit(
  hit: Element,
  focusPath: RichNodePath,
): RichNodePath | null {
  const textHost = hit.closest("[data-rich-text-path]");
  if (textHost) {
    const textPath = parseRichNodePath(textHost.getAttribute("data-rich-text-path"));
    if (!textPath || textPath.length === 0) return null;
    if (!focusPath.every((value, index) => textPath[index] === value)) return null;
    return textPath.slice(0, -1);
  }

  const nodeHost = hit.closest("[data-rich-node-path]");
  if (!nodeHost) return null;
  const path = parseRichNodePath(nodeHost.getAttribute("data-rich-node-path"));
  if (!path || path.length === 0) return null;
  if (!focusPath.every((value, index) => path[index] === value)) return null;
  return path;
}

export function hitTestRichFocusChildIndex(
  root: HTMLElement,
  focusPath: RichNodePath,
  clientX: number,
  clientY: number,
): number | null {
  return hitTestRichFocusChildIndexes(root, focusPath, clientX, clientY)[0] ?? null;
}

function richFocusChildContainsPoint(
  root: HTMLElement,
  focusPath: RichNodePath,
  childIndex: number,
  clientX: number,
  clientY: number,
): boolean {
  const path = childPath(focusPath, childIndex);
  const el = getDomElementAtPath(root, path);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return false;
  }
  for (const hit of document.elementsFromPoint(clientX, clientY)) {
    if (hit.hasAttribute(RICH_EDIT_OVERLAY_ATTR)) continue;
    if (isRichEditChromeElement(hit)) continue;
    if (!root.contains(hit)) continue;
    const selectionPath = resolveRichSelectionPathFromHit(hit, focusPath);
    if (!selectionPath || selectionPath.length <= focusPath.length) continue;
    if (selectionPath[focusPath.length] === childIndex) return true;
  }
  return false;
}

/** All direct children of the current focus layer under the pointer (top-most first). */
export function hitTestRichFocusChildIndexes(
  root: HTMLElement,
  focusPath: RichNodePath,
  clientX: number,
  clientY: number,
): number[] {
  const focusEl = getDomElementAtPath(root, focusPath);
  if (!focusEl) return [];
  const hits: number[] = [];
  const children = focusEl.querySelectorAll(":scope > [data-rich-node-path]");
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (!child) continue;
    const path = parseRichNodePath(child.getAttribute("data-rich-node-path"));
    if (!path || path.length !== focusPath.length + 1) continue;
    if (!focusPath.every((value, index) => path[index] === value)) continue;
    const index = path[focusPath.length];
    if (index === undefined) continue;
    if (richFocusChildContainsPoint(root, focusPath, index, clientX, clientY)) {
      hits.push(index);
    }
  }
  return hits;
}

export function describeRichNodeForOverlapPicker(
  node: RichAstNode | null,
  language: SupportedLanguage = "zh",
): string {
  if (!node || node.kind !== "element") {
    return translate(language, "coursewareEditor.stage.richNodeGeneric");
  }
  const tag = node.tag;
  const textChild = node.children.find((child) => child.kind === "text");
  const snippet =
    textChild && textChild.kind === "text"
      ? textChild.text.replace(/\s+/g, " ").trim().slice(0, 24)
      : "";
  if (snippet) return `${tag}：${snippet}`;
  const className = node.props.className;
  if (typeof className === "string" && className.trim()) {
    const first = className.trim().split(/\s+/)[0];
    if (first) return `${tag} .${first}`;
  }
  return tag;
}

export interface RichResizeCapture {
  handle: SvgResizeHandle;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
}

export function beginRichResizeCapture(
  el: HTMLElement,
  handle: SvgResizeHandle,
  clientX: number,
  clientY: number,
  scale: number,
): RichResizeCapture {
  const rect = el.getBoundingClientRect();
  const safeScale = scale > 0 ? scale : 1;
  return {
    handle,
    startClientX: clientX,
    startClientY: clientY,
    startWidth: rect.width / safeScale,
    startHeight: rect.height / safeScale,
  };
}

export function applyRichResizeDrag(
  capture: RichResizeCapture,
  clientX: number,
  clientY: number,
  scale: number,
): { width: number; height: number } {
  const safeScale = scale > 0 ? scale : 1;
  const dx = (clientX - capture.startClientX) / safeScale;
  const dy = (clientY - capture.startClientY) / safeScale;
  const handle = capture.handle;
  let width = capture.startWidth;
  let height = capture.startHeight;

  if (handle.includes("e")) width = capture.startWidth + dx;
  if (handle.includes("w")) width = capture.startWidth - dx;
  if (handle.includes("s")) height = capture.startHeight + dy;
  if (handle.includes("n")) height = capture.startHeight - dy;

  return {
    width: Math.max(MIN_RESIZE_PX, width),
    height: Math.max(MIN_RESIZE_PX, height),
  };
}

export function clearRichEditHighlights(root: HTMLElement): void {
  for (const el of root.querySelectorAll("[data-rich-edit-highlight]")) {
    el.removeAttribute("data-rich-edit-highlight");
    if (el instanceof HTMLElement) {
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
    }
  }
}

export function applyRichEditHighlights(
  root: HTMLElement,
  focusPath: RichNodePath,
  selectedPath: RichNodePath | null,
): void {
  clearRichEditHighlights(root);
  const focusEl = getDomElementAtPath(root, focusPath);
  if (!focusEl) return;

  for (const child of focusEl.querySelectorAll(":scope > [data-rich-node-path]")) {
    const path = parseRichNodePath(child.getAttribute("data-rich-node-path"));
    if (!path) continue;
    if (!pathsEqual(path.slice(0, focusPath.length), focusPath)) continue;
    if (path.length !== focusPath.length + 1) continue;
    if (pathsEqual(path, selectedPath)) continue;
    child.setAttribute("data-rich-edit-highlight", "focus");
    if (child instanceof HTMLElement) {
      child.style.outline = "1px dashed rgba(59, 130, 246, 0.55)";
      child.style.outlineOffset = "1px";
    }
  }
}
