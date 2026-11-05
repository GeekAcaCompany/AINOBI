// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

// FT1/FT2 guard: the codegen entry arrays and the committed locale JSONs must
// stay in sync, otherwise regenerating deletes live keys (see the backfill
// module for the historical incident this protects against).
import { entries } from "../../../scripts/build-courseware-routes-i18n.mjs";
import zhJson from "./messages/coursewareRoutes.zh.json";
import enJson from "./messages/coursewareRoutes.en.json";
import jaJson from "./messages/coursewareRoutes.ja.json";

const zhMessages: Record<string, string> = zhJson;
const enMessages: Record<string, string> = enJson;
const jaMessages: Record<string, string> = jaJson;

const sortedPlaceholders = (value: string): string =>
  [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");

describe("courseware routes i18n codegen", () => {
  // FT1: codegen entries and committed JSONs describe the exact same key set.
  it("has no duplicate keys in the entry arrays", () => {
    const keys = entries.map(([key]) => key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicates).toEqual([]);
  });

  it("locale JSONs share an identical key set", () => {
    expect(Object.keys(enMessages)).toEqual(Object.keys(zhMessages));
    expect(Object.keys(jaMessages)).toEqual(Object.keys(zhMessages));
  });

  it("covers every committed JSON key (regenerating must not delete keys)", () => {
    const entryKeys = new Set(entries.map(([key]) => key));
    const missingFromScripts = Object.keys(zhMessages).filter((key) => !entryKeys.has(key));
    expect(
      missingFromScripts,
      `keys present in committed JSONs but absent from codegen scripts (first 20): ${missingFromScripts
        .slice(0, 20)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("has no entries missing from the committed JSONs (regenerate after editing entries)", () => {
    const extraInScripts = entries.map(([key]) => key).filter((key) => !(key in zhMessages));
    expect(
      extraInScripts,
      `keys defined in codegen scripts but absent from committed JSONs — run \`node scripts/build-courseware-routes-i18n.mjs\`: ${extraInScripts
        .slice(0, 20)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("matches committed JSON values for every entry and locale", () => {
    for (const [key, value] of entries) {
      expect(zhMessages[key], `zh value drift for ${key}`).toBe(value.zh);
      expect(enMessages[key], `en value drift for ${key}`).toBe(value.en);
      expect(jaMessages[key], `ja value drift for ${key}`).toBe(value.ja);
    }
  });

  // FT2: {var} placeholders must agree across locales for every entry.
  it("keeps interpolation placeholders aligned across zh/en/ja", () => {
    for (const [key, value] of entries) {
      expect(sortedPlaceholders(value.en), `en placeholders drift for ${key}`).toBe(
        sortedPlaceholders(value.zh),
      );
      expect(sortedPlaceholders(value.ja), `ja placeholders drift for ${key}`).toBe(
        sortedPlaceholders(value.zh),
      );
    }
  });

  // FT1 (i18n hygiene): ja/en values must not carry untranslated Chinese. The
  // ja denylist holds simplified-only characters that never appear in
  // Japanese text (e.g. "页" vs "頁/ページ"); en allows one example string
  // that intentionally shows CJK sample input.
  const SIMPLIFIED_ONLY_CHARS = ["页", "选", "个", "击", "这", "们"];
  const EN_CJK_ALLOWLIST = new Set([
    "coursewareEditor.narration.pronDict.pronunciationPlaceholder",
  ]);

  it("ja values contain no simplified-Chinese-only characters", () => {
    const offenders = entries
      .filter(([, value]) => SIMPLIFIED_ONLY_CHARS.some((ch) => value.ja.includes(ch)))
      .map(([key, value]) => `${key}: ${value.ja}`);
    expect(offenders).toEqual([]);
  });

  it("en values contain no CJK text", () => {
    const offenders = entries
      .filter(([key, value]) => !EN_CJK_ALLOWLIST.has(key) && /[\u4e00-\u9fff\u3040-\u30ff]/.test(value.en))
      .map(([key, value]) => `${key}: ${value.en}`);
    expect(offenders).toEqual([]);
  });
});
