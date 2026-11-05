// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Decode a recorded blob to read its true PCM length. More reliable than wall-clock
 * timing or MediaRecorder WebM headers for shadowing playback duration.
 */
export const measureBlobAudioDurationSec = async (blob: Blob): Promise<number | null> => {
  if (typeof window === "undefined") return null;

  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : null;
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => undefined);
  }
};
