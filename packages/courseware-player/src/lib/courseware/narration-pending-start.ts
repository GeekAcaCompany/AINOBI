// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The narration audio "cold start wait" signal (module-level state, the same pattern as narration-preload).
 *
 * useSyncedNarrationAudio sets it while the segment audio isn't ready (never latched); the route layer's
 * rAF scene clock freezes at the segment start by elapsed, and once the audio is ready it plays fully from 0 — replacing
 * seeking to catch up on start (swallowing words) and truncation at the end of the slide. Only one narration audio plays at a time,
 * and when several NarrationRenderer instances run concurrently the last writer wins.
 *
 * The pending start timestamp is managed by this module: setNarrationPendingStart(true) records
 * the start, (false) clears it — the timeout escape is based on monotonically increasing elapsed and never rearms;
 * cleanup paths such as unmount/pause/error must call setNarrationPendingStart(false) explicitly,
 * so a leaked flag doesn't freeze the clock on later pages out of nowhere.
 */

/** Cold start freeze limit: if still not ready beyond this duration, stop waiting (skip that segment's audio and resume the wall clock). */
export const NARRATION_COLD_START_HOLD_MS = 15_000;

let pendingSince: number | null = null;

export function setNarrationPendingStart(value: boolean): void {
  if (value) {
    // Already waiting: keep the original start timestamp (raf-retry rewrites true every frame,
    // and refreshing performance.now() each time would mean the 15s escape never fires and the scene freezes forever).
    if (pendingSince !== null) return;
    pendingSince = performance.now();
    return;
  }
  pendingSince = null;
}

/** null = not in a cold start wait; otherwise returns the milliseconds waited (monotonically increasing until cleared). */
export function narrationPendingStartElapsedMs(
  now: number = performance.now(),
): number | null {
  if (pendingSince === null) return null;
  return Math.max(0, now - pendingSince);
}

export function isNarrationPendingStart(): boolean {
  return pendingSince !== null;
}
