// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { pickPreferredVoice } from "./NarrationModal.tsx";

const zhA = { tts_id: "zh-a", tts_language: "zh" };
const zhB = { tts_id: "zh-b", tts_language: "zh" };
const jaA = { tts_id: "ja-a", tts_language: "ja" };
const legacyZh = { tts_id: "legacy-zh", tts_language: "zh" };
const catalog = [jaA, zhA, zhB, legacyZh];

describe("pickPreferredVoice", () => {
  it("prefers the teacher binding over an earlier automatic fallback", () => {
    // Catalog finished first and auto-selected zh-a; the teacher (bound to a hidden
    // legacy voice) arrives afterwards and must win over the fallback.
    expect(
      pickPreferredVoice(catalog, { teacherTtsId: "legacy-zh", currentTtsId: "zh-a" })?.tts_id,
    ).toBe("legacy-zh");
  });

  it("keeps an explicit user pick above saved and bound voices", () => {
    expect(
      pickPreferredVoice(catalog, {
        userPickedTtsId: "zh-b",
        persistedTtsId: "zh-a",
        teacherTtsId: "legacy-zh",
      })?.tts_id,
    ).toBe("zh-b");
  });

  it("stays in an explicitly switched language during a catalog refresh", () => {
    // User switched to ja while a refresh was pending: do not jump back to the zh
    // teacher binding / saved voice.
    expect(
      pickPreferredVoice(catalog, {
        userPickedLanguage: "ja",
        persistedTtsId: "zh-a",
        teacherTtsId: "legacy-zh",
        currentTtsId: "ja-a",
      })?.tts_id,
    ).toBe("ja-a");
  });

  it("falls back to zh, then the first voice", () => {
    expect(pickPreferredVoice(catalog, {})?.tts_id).toBe("zh-a");
    expect(pickPreferredVoice([jaA], {})?.tts_id).toBe("ja-a");
    expect(pickPreferredVoice([], {})).toBeUndefined();
  });

  it("ignores a picked language that has no voices in the catalog", () => {
    expect(
      pickPreferredVoice(catalog, { userPickedLanguage: "en", teacherTtsId: "legacy-zh" })?.tts_id,
    ).toBe("legacy-zh");
  });
});
