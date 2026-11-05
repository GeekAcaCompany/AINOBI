// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Persistence of the courseware editor's three-column layout.
 * Like `theme`, `sessionStorage` comes first with `localStorage` as the fallback.
 */

import { safeLocalStorageSetItem } from "@ainobi/courseware-player/lib/safe-storage";

export interface CoursewareEditorLayoutState {
  /** Width of the right panel (px, managed separately from the collapsed value). */
  rightPanelWidth: number;
  isLeftPanelCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  /** Height of the bottom timeline area (px). */
  timelineHeight: number;
}

const STORAGE_KEY = "courseware-editor-layout";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseStored(raw: string | null): Partial<CoursewareEditorLayoutState> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const next: Partial<CoursewareEditorLayoutState> = {};
    const p = parsed as Record<string, unknown>;
    if (isFiniteNumber(p.rightPanelWidth)) next.rightPanelWidth = p.rightPanelWidth;
    if (typeof p.isLeftPanelCollapsed === "boolean") next.isLeftPanelCollapsed = p.isLeftPanelCollapsed;
    if (typeof p.isRightPanelCollapsed === "boolean") next.isRightPanelCollapsed = p.isRightPanelCollapsed;
    if (isFiniteNumber(p.timelineHeight)) next.timelineHeight = p.timelineHeight;
    return next;
  } catch {
    return null;
  }
}

function readFromStore(store: Storage): Partial<CoursewareEditorLayoutState> | null {
  try {
    return parseStored(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeToStore(store: Storage, state: CoursewareEditorLayoutState): boolean {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function readCoursewareEditorLayoutFromStorage(): Partial<CoursewareEditorLayoutState> {
  if (typeof window === "undefined") return {};
  return (
    readFromStore(window.sessionStorage) ??
    readFromStore(window.localStorage) ??
    {}
  );
}

export function writeCoursewareEditorLayoutToStorage(state: CoursewareEditorLayoutState): void {
  if (typeof window === "undefined") return;
  writeToStore(window.sessionStorage, state);
  if (!writeToStore(window.localStorage, state)) {
    safeLocalStorageSetItem(STORAGE_KEY, JSON.stringify(state));
  }
}
