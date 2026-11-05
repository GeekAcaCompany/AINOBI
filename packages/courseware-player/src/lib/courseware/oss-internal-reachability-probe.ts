// SPDX-License-Identifier: AGPL-3.0-only
const DEFAULT_PROBE_TIMEOUT_MS = 2500;

/**
 * Probe whether a single URL is reachable in the current network environment (not caring about the response content/status, only whether the request itself
 * completed before the timeout — in `no-cors` mode cross-origin responses are opaque, but DNS/connection failures still
 * reject, and so does a timeout).
 *
 * Used for probing the OSS internal host dedicated to FC headless rendering: the internal host is unreachable from the internet, and once all the requested
 * asset signed URLs point at the internal host while the current runtime (the FC network config) can't actually reach it, large parts of the picture/
 * audio go missing while the render flow itself "looks" successful — a silent half-failure more dangerous than an outright error,
 * so a one-off probe with a sample URL must happen before really fetching a pile of assets.
 */
export async function probeUrlReachable(
  url: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof fetch !== "function") return true;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Same as the Hyperframes producer's `downloadToTemp`: GET and verify the response is readable.
 * Used to confirm before headless output that FFmpeg can download narration MP3s etc., avoiding readable metadata with a missing track after mux.
 */
export async function probeUrlFetchable(
  url: string,
  timeoutMs = 12_000,
): Promise<boolean> {
  if (typeof fetch !== "function") return true;
  const trimmed = url.trim();
  if (!trimmed) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(trimmed, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const reader = response.body?.getReader();
    if (!reader) return true;
    const chunk = await reader.read();
    void reader.cancel().catch(() => undefined);
    return !chunk.done && (chunk.value?.byteLength ?? 0) > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retries a limited number of times on occasional OSS disconnects (ERR_CONNECTION_CLOSED etc.).
 * Returns whether it was finally readable; `attemptsUsed` helps diagnostic logs.
 */
export async function probeUrlFetchableWithRetry(
  url: string,
  options?: { timeoutMs?: number; maxAttempts?: number; backoffMs?: number },
): Promise<{ ok: boolean; attemptsUsed: number }> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);
  const backoffMs = Math.max(0, options?.backoffMs ?? 250);
  const timeoutMs = options?.timeoutMs ?? 12_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await probeUrlFetchable(url, timeoutMs)) {
      return { ok: true, attemptsUsed: attempt };
    }
    if (attempt < maxAttempts && backoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
  return { ok: false, attemptsUsed: maxAttempts };
}
