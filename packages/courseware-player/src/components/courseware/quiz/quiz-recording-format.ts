// SPDX-License-Identifier: AGPL-3.0-only
/** Format seconds as `m:ss` for recording timers in quiz UI. */
export const formatRecordingClock = (totalSec: number): string => {
  const sec = Math.max(0, Math.floor(totalSec));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};
