// SPDX-License-Identifier: AGPL-3.0-only
import {
  SUPPORTED_LANGUAGES,
  defaultLanguage,
  type SupportedLanguage,
} from "./index.ts";
import { safeLocalStorageRemoveItem, safeLocalStorageSetItem } from "../safe-storage.ts";

export const UI_LANGUAGE_STORAGE_KEY = "ainobi-ui-language";

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

function readFromStore(store: Storage): SupportedLanguage | null {
  try {
    const stored = store.getItem(UI_LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeToStore(store: Storage, language: SupportedLanguage): boolean {
  try {
    store.setItem(UI_LANGUAGE_STORAGE_KEY, language);
    return true;
  } catch {
    return false;
  }
}

export function readStoredUiLanguage(): SupportedLanguage | null {
  if (typeof window === "undefined") return null;
  return (
    // The latest switch within the current tab wins; an old value left in localStorage shouldn't override it.
    readFromStore(window.sessionStorage) ?? readFromStore(window.localStorage)
  );
}

/** Double write: sessionStorage can still save when the localStorage quota is full (valid for refreshes in the same tab). */
export function writeStoredUiLanguage(language: SupportedLanguage): void {
  if (typeof window === "undefined") return;
  writeToStore(window.sessionStorage, language);
  if (!writeToStore(window.localStorage, language)) {
    safeLocalStorageSetItem(UI_LANGUAGE_STORAGE_KEY, language);
  }
}

/**
 * Clear the manually chosen UI language preference, back to "inferred from the browser language".
 * Removes the old values from sessionStorage/localStorage too.
 */
export function clearStoredUiLanguage(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(UI_LANGUAGE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  safeLocalStorageRemoveItem(UI_LANGUAGE_STORAGE_KEY);
}

export function detectBrowserLanguage(): SupportedLanguage {
  if (typeof window === "undefined") {
    return defaultLanguage;
  }

  const browserLanguage = window.navigator.language?.toLowerCase();
  if (browserLanguage) {
    if (browserLanguage.startsWith("zh")) return "zh";
    if (browserLanguage.startsWith("ja")) return "ja";
    if (browserLanguage.startsWith("en")) return "en";
  }

  return defaultLanguage;
}

/** A manual choice wins when the user made one; otherwise inferred from the browser language. */
export function resolveInitialUiLanguage(): SupportedLanguage {
  return readStoredUiLanguage() ?? detectBrowserLanguage();
}
