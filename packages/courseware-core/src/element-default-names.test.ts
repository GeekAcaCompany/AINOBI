// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  nextDefaultElementName,
  withDefaultElementName,
  type ElementNameLabels,
} from "./element-default-names.ts";
import type { Element, SlideElement } from "./elements.ts";

// FT4: default element naming accepts injected localized labels while the
// no-labels call keeps the historical Chinese output (CLI compatibility), and
// the module stays self-contained (synced student→CLI, where "@/lib/i18n"
// does not exist).

const slideWith = (children: Array<Pick<Element, "element_type">>) =>
  ({ children_elements: children }) as Pick<SlideElement, "children_elements">;

const enLabels: ElementNameLabels = {
  displayNames: { image: "Image", text: "Text" },
  formatName: (label, ordinal) => `${label} ${ordinal}`,
};

describe("nextDefaultElementName", () => {
  it("keeps the historical Chinese names by default", () => {
    expect(nextDefaultElementName(slideWith([]), "image")).toBe("图片1");
    expect(nextDefaultElementName(slideWith([{ element_type: "image" }]), "image")).toBe("图片2");
    expect(nextDefaultElementName(slideWith([]), "text")).toBe("文本1");
  });

  it("uses injected display names and name format", () => {
    expect(nextDefaultElementName(slideWith([]), "image", enLabels)).toBe("Image 1");
    expect(
      nextDefaultElementName(slideWith([{ element_type: "image" }]), "image", enLabels),
    ).toBe("Image 2");
  });

  it("falls back to the built-in label when the injected map misses a type", () => {
    expect(nextDefaultElementName(slideWith([]), "video", enLabels)).toBe("视频 1");
  });
});

describe("withDefaultElementName", () => {
  it("keeps an explicit name and assigns localized defaults otherwise", () => {
    const named = { element_type: "image", name: "hero" } as Element;
    expect(withDefaultElementName(named, slideWith([]), enLabels).name).toBe("hero");
    const unnamed = { element_type: "image", name: "" } as Element;
    expect(withDefaultElementName(unnamed, slideWith([]), enLabels).name).toBe("Image 1");
    expect(withDefaultElementName(unnamed, slideWith([])).name).toBe("图片1");
  });
});
