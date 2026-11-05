// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";

import {
  UI_LANGUAGE_STORAGE_KEY,
  readStoredUiLanguage,
  resolveInitialUiLanguage,
  clearStoredUiLanguage,
  writeStoredUiLanguage,
} from "./ui-language-preference.ts";

describe("ui-language-preference", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("writes to sessionStorage and localStorage", () => {
    writeStoredUiLanguage("en");
    expect(window.sessionStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("en");
  });

  it("prefers stored language over browser default", () => {
    writeStoredUiLanguage("ja");
    expect(resolveInitialUiLanguage()).toBe("ja");
  });

  it("falls back to sessionStorage when localStorage is empty", () => {
    window.sessionStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "en");
    expect(readStoredUiLanguage()).toBe("en");
  });

  it("prefers sessionStorage over stale localStorage", () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "zh");
    window.sessionStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "ja");
    expect(readStoredUiLanguage()).toBe("ja");
    expect(resolveInitialUiLanguage()).toBe("ja");
  });

  it("clears stored language preference from both storages", () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "zh");
    window.sessionStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "en");
    clearStoredUiLanguage();
    expect(window.sessionStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(readStoredUiLanguage()).toBeNull();
  });
});
