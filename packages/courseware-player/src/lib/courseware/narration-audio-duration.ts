// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Narration TTS audio duration: decoding the whole file first (more accurate than metadata), falling back to `<audio>.duration`.
 */

const METADATA_TIMEOUT_MS = 12_000;

const durationMsFromMetadata = (
  url: string,
  options?: { crossOrigin?: boolean },
): Promise<number> =>
  new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(0);
      return;
    }
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    if (options?.crossOrigin) {
      audio.crossOrigin = "anonymous";
    }
    audio.src = url;
    let settled = false;
    const finish = (ms: number): void => {
      if (settled) return;
      settled = true;
      resolve(Math.max(0, ms));
    };
    audio.onloadedmetadata = () => {
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0;
      finish(seconds * 1000);
    };
    audio.onerror = () => finish(0);
    window.setTimeout(() => finish(0), METADATA_TIMEOUT_MS);
  });

const durationMsFromDecode = async (url: string): Promise<number> => {
  if (typeof window === "undefined") return 0;
  const Ctor =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return 0;
  let ctx: AudioContext | null = null;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (!res.ok) return 0;
    const arrayBuffer = await res.arrayBuffer();
    ctx = new Ctor();
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const maybePromise = ctx!.decodeAudioData(
        arrayBuffer,
        (buf) => resolve(buf),
        (err) => reject(err),
      );
      if (maybePromise && typeof (maybePromise as Promise<AudioBuffer>).then === "function") {
        (maybePromise as Promise<AudioBuffer>).then(resolve, reject);
      }
    });
    return Math.max(0, decoded.duration * 1000);
  } catch {
    return 0;
  } finally {
    void ctx?.close();
  }
};

import {
  resolveNarrationSegmentPlaybackUrl,
  waitForNarrationSegmentPreload,
} from "./narration-preload.ts";

/** Generate/validate the narration segment duration (ms). */
export async function measureNarrationAudioDurationMs(url: string): Promise<number> {
  const trimmed = url.trim();
  if (!trimmed) return 0;
  // OSS presigned / internal URLs often lack CORS: read metadata without crossOrigin first, then decode / CORS.
  const metaPlain = await durationMsFromMetadata(trimmed, { crossOrigin: false });
  if (metaPlain > 0) return Math.round(metaPlain);
  const decoded = await durationMsFromDecode(trimmed);
  if (decoded > 0) return Math.round(decoded);
  const metaCors = await durationMsFromMetadata(trimmed, { crossOrigin: true });
  return Math.round(metaCors);
}

/** Export/headless rendering: wait for the preload first, then try the blob and the original URL in turn (retrying once on failure). */
export async function measureNarrationAudioDurationMsForExport(canonicalUrl: string): Promise<number> {
  const key = canonicalUrl.trim();
  if (!key) return 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitForNarrationSegmentPreload(key);
    const playbackUrl = resolveNarrationSegmentPlaybackUrl(key);
    const candidates = playbackUrl !== key ? [playbackUrl, key] : [key];
    for (const url of candidates) {
      const ms = await measureNarrationAudioDurationMs(url);
      if (ms > 0) return ms;
    }
    if (typeof document !== "undefined") {
      const fallbackUrl = playbackUrl !== key ? playbackUrl : key;
      const metaMs = await durationMsFromMetadata(fallbackUrl, { crossOrigin: false });
      if (metaMs > 0) return metaMs;
    }
    if (attempt === 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
    }
  }
  return 0;
}

/** Read the duration (ms) from a mounted `<audio>`, for correction during playback. */
export function readHtmlMediaDurationMs(media: HTMLMediaElement): number {
  const seconds = Number.isFinite(media.duration) ? media.duration : 0;
  return seconds > 0 ? Math.round(seconds * 1000) : 0;
}
