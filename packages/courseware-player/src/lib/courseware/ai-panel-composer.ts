// SPDX-License-Identifier: AGPL-3.0-only
/** contenteditable of the agent input area: plain text offsets ↔ DOM selection */

const CHIP_ATTR = "data-ai-panel-chip";

export function isAiPanelComposerChip(el: Element): boolean {
  return el.hasAttribute(CHIP_ATTR);
}

export function markAiPanelComposerChip(el: HTMLElement): void {
  el.setAttribute(CHIP_ATTR, "1");
  el.contentEditable = "false";
}

/**
 * Read the plain text equivalent to the controlled value.
 * Line breaks are normalized to `\\n` (from line breaks in TEXT or `<br>`).
 */
export function readComposerPlainText(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\r\n?/g, "\n");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    if (isAiPanelComposerChip(el)) {
      out += el.textContent ?? "";
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(root);
  // An empty editor holding only the placeholder <br> shouldn't read a trailing \\n; a trailing <br> after content counts as the user's line break (Shift+Enter / paste) and is kept.
  if (
    out.endsWith("\n") &&
    root.lastChild?.nodeName === "BR" &&
    !(root.lastChild as HTMLElement).previousSibling
  ) {
    return "";
  }
  return out;
}

type DomPoint = { node: Node; offset: number };

function nodePlainLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\r\n?/g, "\n").length;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = node as HTMLElement;
  if (el.tagName === "BR") return 1;
  if (isAiPanelComposerChip(el)) return el.textContent?.length ?? 0;
  let n = 0;
  for (const child of Array.from(el.childNodes)) n += nodePlainLength(child);
  return n;
}

/** Map a plain text offset to a DOM point (snapping to after the chip when it lands inside one) */
export function locateComposerDomPoint(root: HTMLElement, target: number): DomPoint {
  let remaining = Math.max(0, target);

  const walk = (node: Node): DomPoint | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? "").replace(/\r\n?/g, "\n").length;
      if (remaining <= len) return { node, offset: remaining };
      remaining -= len;
      return null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      if (remaining === 0) {
        const parent = el.parentNode ?? root;
        return { node: parent, offset: Array.from(parent.childNodes).indexOf(el) };
      }
      remaining -= 1;
      return null;
    }
    if (isAiPanelComposerChip(el)) {
      const len = el.textContent?.length ?? 0;
      const parent = el.parentNode ?? root;
      const index = Array.from(parent.childNodes).indexOf(el);
      if (remaining === 0) return { node: parent, offset: index };
      if (remaining < len) return { node: parent, offset: index + 1 };
      remaining -= len;
      return null;
    }
    for (const child of Array.from(el.childNodes)) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };

  return walk(root) ?? { node: root, offset: root.childNodes.length };
}

export function offsetFromComposerRoot(
  root: HTMLElement,
  container: Node,
  offset: number,
): number {
  if (!root.contains(container) && container !== root) return readComposerPlainText(root).length;

  let total = 0;
  const walkUntil = (node: Node): boolean => {
    if (node === container) {
      if (container.nodeType === Node.TEXT_NODE) {
        total += Math.min(offset, (container.textContent ?? "").length);
        return true;
      }
      const el = container as HTMLElement;
      for (let i = 0; i < offset && i < el.childNodes.length; i++) {
        total += nodePlainLength(el.childNodes[i]!);
      }
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent ?? "").length;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      total += 1;
      return false;
    }
    if (isAiPanelComposerChip(el)) {
      if (el === container || el.contains(container)) {
        total += el.textContent?.length ?? 0;
        return true;
      }
      total += el.textContent?.length ?? 0;
      return false;
    }
    for (const child of Array.from(el.childNodes)) {
      if (walkUntil(child)) return true;
    }
    return false;
  };

  walkUntil(root);
  return total;
}

export function getComposerSelectionOffsets(root: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    const len = readComposerPlainText(root).length;
    return { start: len, end: len };
  }
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!anchor || !focus || (!root.contains(anchor) && anchor !== root)) {
    const len = readComposerPlainText(root).length;
    return { start: len, end: len };
  }
  const a = offsetFromComposerRoot(root, anchor, sel.anchorOffset);
  const b = offsetFromComposerRoot(root, focus, sel.focusOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function setComposerSelectionOffsets(
  root: HTMLElement,
  start: number,
  end: number = start,
): void {
  const sel = window.getSelection();
  if (!sel) return;
  const startPoint = locateComposerDomPoint(root, start);
  const endPoint = locateComposerDomPoint(root, end);
  const range = document.createRange();
  try {
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
  } catch {
    return;
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The cursor's coordinates in the viewport (for the fixed-positioned @ list) */
export function getComposerCaretClientRect(
  root: HTMLElement,
  position: number,
): { top: number; left: number } {
  const point = locateComposerDomPoint(root, position);
  const range = document.createRange();
  try {
    range.setStart(point.node, point.offset);
    range.collapse(true);
  } catch {
    const rect = root.getBoundingClientRect();
    return { top: rect.top, left: rect.left };
  }
  let rect = range.getBoundingClientRect();
  if ((rect.width === 0 && rect.height === 0) || (rect.top === 0 && rect.left === 0)) {
    const probe = document.createTextNode("\u200b");
    try {
      range.insertNode(probe);
      const probeRange = document.createRange();
      probeRange.selectNode(probe);
      rect = probeRange.getBoundingClientRect();
      probe.parentNode?.removeChild(probe);
    } catch {
      const fallback = root.getBoundingClientRect();
      return { top: fallback.top, left: fallback.left };
    }
  }
  return { top: rect.top, left: rect.left };
}

export function insertComposerPlainText(root: HTMLElement, text: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    root.focus();
  }
  const selection = window.getSelection();
  if (!selection) return;
  if (selection.rangeCount === 0) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    selection.addRange(range);
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  const frag = document.createDocumentFragment();
  parts.forEach((part, i) => {
    if (part) frag.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) frag.appendChild(document.createElement("br"));
  });
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
  }
}
