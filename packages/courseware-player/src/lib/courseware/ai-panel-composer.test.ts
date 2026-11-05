// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  getComposerSelectionOffsets,
  locateComposerDomPoint,
  markAiPanelComposerChip,
  readComposerPlainText,
  setComposerSelectionOffsets,
} from "./ai-panel-composer.ts";

function mount(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("ai-panel-composer", () => {
  it("reads plain text with br newlines and chips", () => {
    const root = mount("");
    root.appendChild(document.createTextNode("你好"));
    root.appendChild(document.createElement("br"));
    const chip = document.createElement("span");
    markAiPanelComposerChip(chip);
    chip.textContent = "@slide.png";
    root.appendChild(chip);
    root.appendChild(document.createTextNode("结束"));
    expect(readComposerPlainText(root)).toBe("你好\n@slide.png结束");
    root.remove();
  });

  it("keeps a trailing newline from content + br (Shift+Enter)", () => {
    const root = mount("");
    root.appendChild(document.createTextNode("hello"));
    root.appendChild(document.createElement("br"));
    expect(readComposerPlainText(root)).toBe("hello\n");
    root.remove();
  });

  it("treats a sole placeholder br as empty text", () => {
    const root = mount("");
    root.appendChild(document.createElement("br"));
    expect(readComposerPlainText(root)).toBe("");
    root.remove();
  });

  it("maps caret offsets around chips", () => {
    const root = mount("");
    root.appendChild(document.createTextNode("前"));
    const chip = document.createElement("span");
    markAiPanelComposerChip(chip);
    chip.textContent = "@a";
    root.appendChild(chip);
    root.appendChild(document.createTextNode("后"));
    document.body.appendChild(root);

    setComposerSelectionOffsets(root, 1, 1);
    expect(getComposerSelectionOffsets(root)).toEqual({ start: 1, end: 1 });

    // An offset inside a chip snaps to after the chip (before + @a = 3)
    const midChip = locateComposerDomPoint(root, 2);
    setComposerSelectionOffsets(root, 2, 2);
    const sel = getComposerSelectionOffsets(root);
    expect(sel.start).toBeGreaterThanOrEqual(1);
    expect(midChip.node).toBe(root);

    setComposerSelectionOffsets(root, 3, 3);
    expect(getComposerSelectionOffsets(root).start).toBe(3);
    root.remove();
  });
});
