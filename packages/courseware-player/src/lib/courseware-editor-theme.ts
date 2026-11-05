// SPDX-License-Identifier: AGPL-3.0-only
import { safeLocalStorageSetItem } from "./safe-storage.ts";

export type EditorThemeMode = "light" | "dark";

export const COURSEWARE_EDITOR_THEME_ATTR = "data-courseware-editor-theme";

const STORAGE_KEY = "courseware-editor-theme-mode";

function readFromStore(store: Storage): EditorThemeMode | null {
  try {
    const stored = store.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function writeToStore(store: Storage, mode: EditorThemeMode): boolean {
  try {
    store.setItem(STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/** sessionStorage first, so the theme can still be read/written after courseware scenes fill up localStorage. */
export function readEditorThemeModeFromStorage(): EditorThemeMode {
  if (typeof window === "undefined") return "dark";
  return (
    readFromStore(window.sessionStorage) ??
    readFromStore(window.localStorage) ??
    "dark"
  );
}

export function writeEditorThemeModeToStorage(mode: EditorThemeMode): void {
  if (typeof window === "undefined") return;
  writeToStore(window.sessionStorage, mode);
  if (!writeToStore(window.localStorage, mode)) {
    safeLocalStorageSetItem(STORAGE_KEY, mode);
  }
}

/** Theme on the live editor shell (falls back to stored preference). */
export function readActiveEditorThemeMode(): EditorThemeMode {
  if (typeof document === "undefined") return readEditorThemeModeFromStorage();
  const host = document.querySelector(`[${COURSEWARE_EDITOR_THEME_ATTR}]`);
  const live = host?.getAttribute(COURSEWARE_EDITOR_THEME_ATTR);
  if (live === "light" || live === "dark") return live;
  return readEditorThemeModeFromStorage();
}
