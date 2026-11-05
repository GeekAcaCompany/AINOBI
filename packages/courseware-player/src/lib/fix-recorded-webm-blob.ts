// SPDX-License-Identifier: AGPL-3.0-only
import { fixWebmDuration } from "@fix-webm-duration/fix";

/**
 * MediaRecorder WebM blobs often lack a correct Duration in the container.
 * Inject wall-clock duration (ms) so `<audio>` timelines match the actual take.
 */
export const fixRecordedWebmBlob = async (blob: Blob, durationSec: number): Promise<Blob> => {
  const type = blob.type.toLowerCase();
  if (!type.includes("webm")) return blob;

  const durationMs = Math.max(0, Math.round(durationSec * 1000));
  if (durationMs <= 0) return blob;

  try {
    return await fixWebmDuration(blob, durationMs, { logger: false });
  } catch {
    return blob;
  }
};
