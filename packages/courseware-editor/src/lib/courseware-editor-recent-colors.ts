// SPDX-License-Identifier: AGPL-3.0-only
import { parseCssColor, rgbToHex } from "@ainobi/courseware-core/css-color.ts";
import { safeLocalStorageSetItem } from "@ainobi/courseware-player/lib/safe-storage";

const STORAGE_KEY = "courseware-editor-recent-colors";
const MAX_RECENT_COLORS = 10;

export const COURSEWARE_EDITOR_RECENT_COLORS_EVENT = "courseware-editor-recent-colors-changed";

function readStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => {
        const parsedColor = parseCssColor(item);
        return parsedColor ? rgbToHex(parsedColor) : null;
      })
      .filter((item): item is string => Boolean(item));
  } catch {
    return [];
  }
}

function writeStorage(colors: string[]): void {
  if (typeof window === "undefined") return;
  try {
    safeLocalStorageSetItem(STORAGE_KEY, JSON.stringify(colors));
    window.dispatchEvent(new CustomEvent(COURSEWARE_EDITOR_RECENT_COLORS_EVENT));
  } catch {
    // localStorage may be unavailable
  }
}

export function readCoursewareEditorRecentColors(): string[] {
  return readStorage();
}

/** Write a color into the recently used list (deduplicated, newest first) and return the updated list. */
export function pushCoursewareEditorRecentColor(hex: string): string[] {
  const parsed = parseCssColor(hex);
  if (!parsed) return readStorage();
  const normalized = rgbToHex(parsed);

  const withoutDup = readStorage().filter((item) => item !== normalized);
  const next = [normalized, ...withoutDup].slice(0, MAX_RECENT_COLORS);
  writeStorage(next);
  return next;
}
