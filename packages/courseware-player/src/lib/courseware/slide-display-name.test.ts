// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { translate, type SupportedLanguage, type TranslationKey } from "../i18n/index.ts";
import { resolveSlideDisplayName } from "./slide-display-name.ts";

// FT4: slides created by the CLI/MCP carry an empty name (or the legacy
// "第一页" placeholder); the editor/preview must show a localized page label
// instead of persisting or echoing Chinese.

const tFor =
  (language: SupportedLanguage) =>
  (key: TranslationKey, variables?: Record<string, string | number>) =>
    translate(language, key, variables);

describe("resolveSlideDisplayName", () => {
  it("falls back to the localized page pattern for empty names", () => {
    expect(resolveSlideDisplayName("", 0, tFor("zh"))).toBe("第 1 页");
    expect(resolveSlideDisplayName("", 0, tFor("en"))).toBe("Page 1");
    expect(resolveSlideDisplayName("   ", 2, tFor("ja"))).toBe("3ページ目");
  });

  it("treats the legacy Chinese placeholder as an auto-generated name", () => {
    expect(resolveSlideDisplayName("第一页", 0, tFor("en"))).toBe("Page 1");
    expect(resolveSlideDisplayName("第一页", 0, tFor("ja"))).toBe("1ページ目");
    expect(resolveSlideDisplayName("第一页", 0, tFor("zh"))).toBe("第 1 页");
  });

  it("keeps user-authored names untouched", () => {
    expect(resolveSlideDisplayName("Intro", 0, tFor("ja"))).toBe("Intro");
    expect(resolveSlideDisplayName("第一页 概述", 0, tFor("en"))).toBe("第一页 概述");
  });
});
