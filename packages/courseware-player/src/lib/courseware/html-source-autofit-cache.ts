// SPDX-License-Identifier: AGPL-3.0-only
import { extractCoursewareAssetFilePath } from "../../api/courseware.ts";

/** Cache Storage bucket name; bump the version when the storage format changes. */
export const HTML_SOURCE_AUTOFIT_CACHE_NAME = "ainobi-courseware-html-v1";

/** A synthetic URL used only as the Cache API cache key; no network request is made. */
const HTML_SOURCE_AUTOFIT_CACHE_ORIGIN = "https://cache.ainobi.internal";

export type HtmlSourceAutofitCachedEntry = {
  html: string;
  savedAt: number;
};

export type FetchHtmlSourceResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

const memoryHits = new Map<string, FetchHtmlSourceResult>();
const memoryInflight = new Map<string, Promise<FetchHtmlSourceResult>>();

function isRemoteHtmlSrc(src: string): boolean {
  const trimmed = src.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function resolveEmbedCoursewareId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("courseware_id")?.trim() || null;
}

function isCacheStorageAvailable(): boolean {
  return typeof caches !== "undefined";
}

/** Stable cache key: courseware asset path when available, else full remote URL. */
export function resolveHtmlSourceAutofitCacheKey(
  src: string,
  coursewareId?: string | null,
): string | null {
  const trimmed = src.trim();
  if (!trimmed || !isRemoteHtmlSrc(trimmed)) return null;
  const cwId = coursewareId?.trim() || resolveEmbedCoursewareId();
  const assetKey = cwId ? extractCoursewareAssetFilePath(trimmed) : null;
  if (cwId && assetKey) return `proxy:${cwId}\0${assetKey}`;
  // Presign querystrings must not become part of the cache key — the document
  // identity is the path; a signed src would cache under an unmatchable key.
  const queryIndex = trimmed.indexOf("?");
  return `direct:${queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed}`;
}

export function toHtmlSourceAutofitCacheRequest(logicalKey: string): Request {
  return new Request(
    `${HTML_SOURCE_AUTOFIT_CACHE_ORIGIN}/html-source/${encodeURIComponent(logicalKey)}`,
  );
}

function logicalKeyFromCacheRequest(request: Request): string | null {
  const prefix = `${HTML_SOURCE_AUTOFIT_CACHE_ORIGIN}/html-source/`;
  if (!request.url.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(request.url.slice(prefix.length));
  } catch {
    return null;
  }
}

function collectHtmlSourceAutofitCacheKeys(input: {
  coursewareId?: string;
  filePath?: string;
  src?: string;
}): string[] {
  const keys = new Set<string>();
  const cwId = input.coursewareId?.trim();
  const candidates = [input.filePath, input.src].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  for (const candidate of candidates) {
    const key = resolveHtmlSourceAutofitCacheKey(candidate, cwId ?? null);
    if (key) keys.add(key);
  }
  return [...keys];
}

function clearMemoryForKeys(keys: Iterable<string>): void {
  for (const key of keys) {
    memoryHits.delete(key);
    memoryInflight.delete(key);
  }
}

async function openHtmlSourceAutofitCache(): Promise<Cache | null> {
  if (!isCacheStorageAvailable()) return null;
  try {
    return await caches.open(HTML_SOURCE_AUTOFIT_CACHE_NAME);
  } catch {
    return null;
  }
}

async function readPersistedHtmlSource(
  logicalKey: string,
): Promise<HtmlSourceAutofitCachedEntry | null> {
  const cache = await openHtmlSourceAutofitCache();
  if (!cache) return null;

  try {
    const response = await cache.match(toHtmlSourceAutofitCacheRequest(logicalKey));
    if (!response) return null;
    const html = await response.text();
    if (!html) return null;
    const savedAt = Number(response.headers.get("X-Ainobi-Cached-At") ?? Date.now());
    return { html, savedAt };
  } catch {
    return null;
  }
}

async function writePersistedHtmlSource(logicalKey: string, html: string): Promise<void> {
  const cache = await openHtmlSourceAutofitCache();
  if (!cache) return;

  const savedAt = Date.now();
  try {
    await cache.put(
      toHtmlSourceAutofitCacheRequest(logicalKey),
      new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Ainobi-Cached-At": String(savedAt),
        },
      }),
    );
  } catch {
    /* quota / private mode — L1 memory still helps within the session */
  }
}

async function deletePersistedHtmlSource(logicalKey: string): Promise<void> {
  const cache = await openHtmlSourceAutofitCache();
  if (!cache) return;
  try {
    await cache.delete(toHtmlSourceAutofitCacheRequest(logicalKey));
  } catch {
    /* ignore */
  }
}

async function deletePersistedHtmlSourceByPrefix(prefix: string): Promise<void> {
  const cache = await openHtmlSourceAutofitCache();
  if (!cache) return;

  try {
    const requests = await cache.keys();
    await Promise.all(
      requests.map(async (request) => {
        const logicalKey = logicalKeyFromCacheRequest(request);
        if (logicalKey?.startsWith(prefix)) {
          await cache.delete(request);
        }
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Read an L1 in-memory hit (synchronous). */
export function peekHtmlSourceAutofitMemoryCache(
  logicalKey: string,
): FetchHtmlSourceResult | undefined {
  return memoryHits.get(logicalKey);
}

/** Write L1 + L2 (L2 persisted asynchronously). */
export function storeHtmlSourceAutofitCache(
  logicalKey: string,
  result: Extract<FetchHtmlSourceResult, { ok: true }>,
): void {
  memoryHits.set(logicalKey, result);
  void writePersistedHtmlSource(logicalKey, result.html);
}

/**
 * Read the persistent cache (L2). A hit is written back into L1.
 * Used for the first load after a refresh: memory is empty but Cache Storage still has the data.
 */
export async function readHtmlSourceAutofitCache(
  logicalKey: string,
): Promise<Extract<FetchHtmlSourceResult, { ok: true }> | null> {
  const memory = memoryHits.get(logicalKey);
  if (memory?.ok) return memory;

  const persisted = await readPersistedHtmlSource(logicalKey);
  if (!persisted) return null;

  const result = { ok: true as const, html: persisted.html };
  memoryHits.set(logicalKey, result);
  return result;
}

/** Drop cached HTML for one asset (e.g. after re-upload). */
export async function invalidateHtmlSourceAutofitCacheAsync(input?: {
  coursewareId?: string;
  filePath?: string;
  src?: string;
}): Promise<void> {
  if (!input) {
    memoryHits.clear();
    memoryInflight.clear();
    if (!isCacheStorageAvailable()) return;
    try {
      await caches.delete(HTML_SOURCE_AUTOFIT_CACHE_NAME);
    } catch {
      /* ignore */
    }
    return;
  }

  const keys = collectHtmlSourceAutofitCacheKeys(input);
  clearMemoryForKeys(keys);
  await Promise.all(keys.map((key) => deletePersistedHtmlSource(key)));
}

/** Fire-and-forget wrapper; upload flows should prefer {@link invalidateHtmlSourceAutofitCacheAsync}. */
export function invalidateHtmlSourceAutofitCache(input?: {
  coursewareId?: string;
  filePath?: string;
  src?: string;
}): void {
  void invalidateHtmlSourceAutofitCacheAsync(input);
}

/** Drop all cached HTML for a courseware. */
export async function invalidateHtmlSourceAutofitCacheForCoursewareAsync(
  coursewareId: string,
): Promise<void> {
  const prefix = `proxy:${coursewareId.trim()}\0`;
  clearMemoryForKeys([...memoryHits.keys()].filter((key) => key.startsWith(prefix)));
  clearMemoryForKeys([...memoryInflight.keys()].filter((key) => key.startsWith(prefix)));
  await deletePersistedHtmlSourceByPrefix(prefix);
}

export function invalidateHtmlSourceAutofitCacheForCourseware(coursewareId: string): void {
  void invalidateHtmlSourceAutofitCacheForCoursewareAsync(coursewareId);
}

export function getHtmlSourceAutofitInflight(
  logicalKey: string,
): Promise<FetchHtmlSourceResult> | undefined {
  return memoryInflight.get(logicalKey);
}

/**
 * Concurrent requests for the same logicalKey merge into one; the placeholder Promise is registered synchronously to avoid a race before await.
 */
export function runDedupedHtmlSourceAutofitFetch(
  logicalKey: string,
  run: () => Promise<FetchHtmlSourceResult>,
): Promise<FetchHtmlSourceResult> {
  const existing = memoryInflight.get(logicalKey);
  if (existing) return existing;

  let resolve!: (value: FetchHtmlSourceResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<FetchHtmlSourceResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  memoryInflight.set(logicalKey, promise);

  void (async () => {
    try {
      resolve(await run());
    } catch (error) {
      reject(error);
    } finally {
      memoryInflight.delete(logicalKey);
    }
  })();

  return promise;
}

export function setHtmlSourceAutofitInflight(
  logicalKey: string,
  promise: Promise<FetchHtmlSourceResult>,
): void {
  memoryInflight.set(logicalKey, promise);
}

export function clearHtmlSourceAutofitInflight(logicalKey: string): void {
  memoryInflight.delete(logicalKey);
}

/** For tests: clear only L1, simulating a page refresh that keeps Cache Storage. */
export function clearHtmlSourceAutofitMemoryCacheForTests(): void {
  memoryHits.clear();
  memoryInflight.clear();
}
