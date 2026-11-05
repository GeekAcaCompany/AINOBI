// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recording playhead persistence (localStorage).
 *
 * When courseware-preview is opened standalone (`?courseware_id=` remote courseware / `?id=` local draft),
 * refreshing or closing and re-entering would replay from 0; this module persists the scene-level playhead (ms) by courseware identity,
 * and the route restores it on re-entry. The editor's postMessage embedded preview is driven by the editor and doesn't resume.
 */

import { safeLocalStorageRemoveItem, safeLocalStorageSetItem } from "../safe-storage.ts";

const PLAYBACK_RESUME_KEY_PREFIX = "courseware-playback-position:";
/** Resume positions not updated for 30 days count as expired (the courseware content may have changed). */
const PLAYBACK_RESUME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A playhead within the final 1s counts as finished: the resume position is cleared, and it plays from the start next time. */
const PLAYBACK_FINISHED_EPSILON_MS = 1000;

export type CoursewarePlaybackResumePosition = {
  sceneTimeMs: number;
  updatedAt: number;
};

/** Build the resume storage key from the courseware identity (courseware_id or local draft id); returns null for an empty identity. */
export function buildCoursewarePlaybackResumeKey(
  identity: string | null | undefined,
): string | null {
  const trimmed = identity?.trim();
  return trimmed ? `${PLAYBACK_RESUME_KEY_PREFIX}${encodeURIComponent(trimmed)}` : null;
}

/** Read the resume position; returns null when missing, corrupted or expired (>30 days). */
export function readCoursewarePlaybackResume(
  key: string | null | undefined,
): CoursewarePlaybackResumePosition | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CoursewarePlaybackResumePosition>;
    if (
      typeof parsed.sceneTimeMs !== "number" ||
      !Number.isFinite(parsed.sceneTimeMs) ||
      parsed.sceneTimeMs <= 0
    ) {
      return null;
    }
    if (
      typeof parsed.updatedAt !== "number" ||
      !Number.isFinite(parsed.updatedAt) ||
      Date.now() - parsed.updatedAt > PLAYBACK_RESUME_TTL_MS
    ) {
      return null;
    }
    return { sceneTimeMs: Math.floor(parsed.sceneTimeMs), updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

export type SaveCoursewarePlaybackResumeOptions = {
  /** Keys additionally protected when a write triggers quota reclamation (e.g. the currently loaded local preview scene package). */
  protectKeys?: string[];
};

/**
 * Save the playhead. When the playhead is back at the start (<=0, respecting a manual "back to the beginning") or in the final
 * stretch (<1s from the total duration, finished) the resume position is cleared instead. A failed write (quota etc.) silently degrades to no resume.
 */
export function saveCoursewarePlaybackResume(
  key: string | null | undefined,
  sceneTimeMs: number,
  sceneTotalDurationMs: number,
  options: SaveCoursewarePlaybackResumeOptions = {},
): boolean {
  if (!key || typeof window === "undefined") return false;
  if (!Number.isFinite(sceneTimeMs) || sceneTimeMs < 0) return false;
  if (
    sceneTimeMs <= 0 ||
    (Number.isFinite(sceneTotalDurationMs) &&
      sceneTotalDurationMs > 0 &&
      sceneTimeMs >= sceneTotalDurationMs - PLAYBACK_FINISHED_EPSILON_MS)
  ) {
    safeLocalStorageRemoveItem(key);
    return true;
  }
  return safeLocalStorageSetItem(
    key,
    JSON.stringify({
      sceneTimeMs: Math.floor(sceneTimeMs),
      updatedAt: Date.now(),
    }),
    { protectKeys: options.protectKeys },
  );
}

/** Clear the resume position by hand (e.g. the user chose to play from the start). */
export function clearCoursewarePlaybackResume(key: string | null | undefined): void {
  if (!key || typeof window === "undefined") return;
  safeLocalStorageRemoveItem(key);
}

/**
 * One-off migration of old keys (`content@learner`, without the section segment): after the key upgrade to `…@section segment`,
 * old standalone records have no cross-section ambiguity and can be moved safely; old records with a section context
 * may come from any lesson (exactly the mix-up this upgrade fixes) and aren't migrated.
 * Runs only when the new key has no record and the old key's record is valid (not expired, complete payload); after a successful move the old key
 * is deleted; repeated calls are idempotent.
 */
export function migrateStandaloneCoursewarePlaybackResume(
  key: string | null | undefined,
  legacyKey: string | null | undefined,
  sceneTotalDurationMs: number,
  options: SaveCoursewarePlaybackResumeOptions = {},
): void {
  if (!key || !legacyKey || key === legacyKey || typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(key)) return;
    const saved = readCoursewarePlaybackResume(legacyKey);
    if (!saved) return;
    // If the old head already lies in the final window of the new total duration, save clears the new key as "finished", and the old key goes with it
    if (saveCoursewarePlaybackResume(key, saved.sceneTimeMs, sceneTotalDurationMs, options)) {
      safeLocalStorageRemoveItem(legacyKey);
    }
  } catch {
    /* without storage, no migration; treated as no resume */
  }
}
