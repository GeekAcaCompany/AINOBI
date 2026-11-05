// SPDX-License-Identifier: AGPL-3.0-only
/** Narration segment audio preloading (fetch everything before playing, reducing dropped audio at segment switches on weak networks). */

const preloadPromises = new Map<string, Promise<void>>();
const preloadReadyUrls = new Set<string>();
const blobPlaybackUrls = new Map<string, string>();
const decodeWarmPromises = new Map<string, Promise<void>>();
const decodeWarmedUrls = new Set<string>();

/** Headless Hyperframes: narration segments must not be swapped for blob:, or FFmpeg can't fetch them. */
let narrationBlobPlaybackEnabled = true;

export function setNarrationBlobPlaybackEnabled(enabled: boolean): void {
  narrationBlobPlaybackEnabled = enabled;
  if (enabled) return;
  for (const blobUrl of blobPlaybackUrls.values()) {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      /* noop */
    }
  }
  blobPlaybackUrls.clear();
}

/** The fetch preload completed (an HTTP cache hit counts too). */
export function isNarrationSegmentPreloaded(url: string): boolean {
  const key = url.trim();
  return key.length > 0 && preloadReadyUrls.has(key);
}

/** The hidden `<audio>` finished its canplaythrough decoding warmup. */
export function isNarrationDecodeWarmed(url: string): boolean {
  const key = url.trim();
  return key.length > 0 && decodeWarmedUrls.has(key);
}

/** Whether the playback URL can start immediately (blob or already fetch-warmed). */
export function isNarrationPlaybackSrcReady(playbackSrc: string): boolean {
  const key = playbackSrc.trim();
  if (!key) return false;
  if (key.startsWith("blob:")) return true;
  return isNarrationSegmentPreloaded(key);
}

/**
 * URL for playback: on a preload hit returns the in-memory blob, so `<audio>` doesn't switch src and go through a network/decoding cold start again.
 */
export function resolveNarrationSegmentPlaybackUrl(url: string): string {
  const key = url.trim();
  if (!key) return "";
  if (!narrationBlobPlaybackEnabled) return key;
  return blobPlaybackUrls.get(key) ?? key;
}

/** Wait for the given segment's decoding warmup (optionally awaited before playing the segment start). */
export function waitForNarrationDecodeWarm(canonicalUrl: string): Promise<void> {
  const key = canonicalUrl.trim();
  if (!key || decodeWarmedUrls.has(key)) return Promise.resolve();
  return decodeWarmPromises.get(key) ?? Promise.resolve();
}

function warmNarrationBlobDecode(canonicalUrl: string, blobUrl: string): void {
  const key = canonicalUrl.trim();
  if (!key || !blobUrl || decodeWarmPromises.has(key)) return;

  const promise = new Promise<void>((resolve) => {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.src = blobUrl;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      decodeWarmedUrls.add(key);
      el.pause();
      el.removeAttribute("src");
      el.load();
      resolve();
    };
    el.addEventListener("canplaythrough", finish, { once: true });
    el.addEventListener("error", finish, { once: true });
    el.load();
    void el.play()
      .then(() => el.pause())
      .catch(() => {
        /* when the autoplay policy refuses, it still relies on canplaythrough */
      });
    window.setTimeout(finish, 8000);
  });

  decodeWarmPromises.set(key, promise);
  void promise;
}

/** Wait for a single segment's preload (also resolves on failure, consistent with preload's behavior). */
export function waitForNarrationSegmentPreload(url: string): Promise<void> {
  const key = url.trim();
  if (!key) return Promise.resolve();
  return preloadPromises.get(key) ?? Promise.resolve();
}

export async function waitForAllNarrationSegmentPreloads(urls: readonly string[]): Promise<void> {
  await Promise.all(urls.map((url) => waitForNarrationSegmentPreload(url)));
}

export function preloadNarrationSegmentUrls(urls: readonly string[]): void {
  if (typeof window === "undefined") return;
  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url) continue;

    if (!preloadPromises.has(url)) {
      // In headless rendering environments the first fetch may fail with a network interruption (ERR_ABORTED).
      // Caching the failed promise would mean it is never retried and
      // the player stays stuck loading, so it retries up to 3 times until it succeeds,
      // and on failure is removed from the cache so later calls can retry.
      const promise = (async () => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
            if (!res.ok) {
              throw new Error(`narration preload HTTP ${res.status}`);
            }
            const buffer = await res.arrayBuffer();
            if (narrationBlobPlaybackEnabled) {
              const prevBlob = blobPlaybackUrls.get(url);
              if (prevBlob) URL.revokeObjectURL(prevBlob);
              const blobUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
              blobPlaybackUrls.set(url, blobUrl);
              warmNarrationBlobDecode(url, blobUrl);
            }
            preloadReadyUrls.add(url);
            return;
          } catch (error) {
            if (attempt >= 3) {
              // When preloading fails, fall back to playing the URL directly (retrying after backoff is left to the caller)
              console.warn(`[narration-preload] gave up after ${attempt} attempts: …${url.slice(-40)}`);
              return;
            }
            await new Promise((r) => setTimeout(r, attempt * 1500));
          }
        }
      })().finally(() => {
        // A successful preload **keeps** its promise in the cache: this function is called
        // very often from the playback loop, so deleting it here would make every call a real network
        // fetch (the response has no Cache-Control and the HTTP cache
        // doesn't help either), re-downloading the audio every frame. It is deleted only on failure —
        // keeping the retry on the next call.
        if (!preloadReadyUrls.has(url)) preloadPromises.delete(url);
      });
      preloadPromises.set(url, promise);
      void promise;
    }
  }
}
