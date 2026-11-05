// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Safe localStorage writes and quota reclamation.
 * Large data such as courseware scenes/previews/agent conversations easily fills the ~5MB quota, making writes of key entries such as `session` fail.
 */

import logger from "../host/logger.ts";

const PREVIEW_STORAGE_KEY_PREFIX = "courseware-preview-scene:";
const PREVIEW_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

/** Exact keys never cleaned automatically */
const PROTECTED_EXACT_KEYS = new Set([
  "session",
  "currentRole",
  "wechat_user_id",
  "lastSelectedOrgId",
  "ainobi.student.was_agent",
  "ainobi-ui-language",
  "courseware-editor-theme-mode",
  "courseware-editor-layout",
  "courseware-editor-recent-colors",
  "subtitle-on",
  "userInfo",
]);

/** Prefixes never cleaned automatically (small data such as auth and layout preferences) */
const PROTECTED_PREFIXES = [
  "ainobi.agent.",
  "slide-layout:",
  "live2d-layout:",
];

/**
 * Cleanable key prefixes, in priority order: large, regenerable caches go first.
 * When an editor draft already has a copy in IndexedDB, deleting the localStorage leftover doesn't affect recovery.
 */
const EVICTABLE_PREFIXES = [
  "courseware-preview-scene:",
  "courseware-editor-scene:",
  "courseware-editor-agent-thread:v1:",
  "player-note:",
  "ainobi-dashboard-live2d-model:",
  "cw-chunk-upload:",
  "cw-quiz-answer-recording-chunk-upload:",
] as const;

const CHUNK_UPLOAD_RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DASHBOARD_LIVE2D_PREFIX = "ainobi-dashboard-live2d-model:";

/**
 * Resume positions (recordings + courseware preview) are reclaimed with a 30-day TTL (matching each lib's TTL; the libs
 * depend on this module in turn, so the value is copied here to avoid a cycle). Expired records must be reclaimable, otherwise
 * keys accumulating per section × learner would defeat quota reclamation completely; unexpired resume positions stay out of ordinary reclamation
 * and come last only in aggressive reclamation.
 */
const PLAYBACK_RESUME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLAYBACK_RESUME_PREFIXES = [
  "courseware-playback-position:",
  "recording-playback-position:",
] as const;

function isExpiredPlaybackResume(raw: string, now: number): boolean {
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown };
    return (
      typeof parsed.updatedAt !== "number" ||
      !Number.isFinite(parsed.updatedAt) ||
      now - parsed.updatedAt > PLAYBACK_RESUME_TTL_MS
    );
  } catch {
    return true;
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014)
  );
}

function isProtectedKey(key: string): boolean {
  if (PROTECTED_EXACT_KEYS.has(key)) return true;
  return PROTECTED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isEvictableKey(key: string): boolean {
  if (isProtectedKey(key)) return false;
  return EVICTABLE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function estimateEntryBytes(key: string, value: string | null): number {
  return key.length + (value?.length ?? 0);
}

function isExpiredPreviewValue(raw: string, now: number): boolean {
  try {
    const parsed = JSON.parse(raw) as { createdAt?: unknown };
    return (
      typeof parsed.createdAt !== "number" ||
      now - parsed.createdAt > PREVIEW_STORAGE_TTL_MS
    );
  } catch {
    return true;
  }
}

function isExpiredChunkUploadResume(raw: string, now: number): boolean {
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown };
    return (
      typeof parsed.updatedAt !== "number" ||
      now - parsed.updatedAt > CHUNK_UPLOAD_RESUME_TTL_MS
    );
  } catch {
    return true;
  }
}

function isExpiredDashboardLive2d(raw: string, now: number): boolean {
  try {
    const parsed = JSON.parse(raw) as { expiresAt?: unknown };
    return typeof parsed.expiresAt !== "number" || now > parsed.expiresAt;
  } catch {
    return true;
  }
}

function shouldEvictByTtl(key: string, raw: string | null, now: number): boolean {
  if (!raw) return true;
  if (key.startsWith(PREVIEW_STORAGE_KEY_PREFIX)) {
    return isExpiredPreviewValue(raw, now);
  }
  if (key.startsWith("cw-chunk-upload:") || key.startsWith("cw-quiz-answer-recording-chunk-upload:")) {
    return isExpiredChunkUploadResume(raw, now);
  }
  if (key.startsWith(DASHBOARD_LIVE2D_PREFIX)) {
    return isExpiredDashboardLive2d(raw, now);
  }
  if (PLAYBACK_RESUME_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return isExpiredPlaybackResume(raw, now);
  }
  return false;
}

export type CleanupLocalStorageOptions = {
  /** The key being written, kept during cleanup */
  exceptKey?: string;
  /** Additionally protected keys (e.g. cleanable data in use during this write), treated as protected during cleanup */
  protectKeys?: string[];
  /** When true, delete every cleanable key (still keeping exceptKey, protectKeys and protected keys) */
  aggressive?: boolean;
};

/**
 * Reclaim cleanable localStorage entries. Returns the number of keys deleted.
 */
export function cleanupEvictableLocalStorage(options: CleanupLocalStorageOptions = {}): number {
  if (typeof window === "undefined") return 0;
  const { exceptKey, aggressive = false } = options;
  const protectKeys = options.protectKeys ?? [];
  const now = Date.now();
  let removed = 0;

  try {
    const candidates: { key: string; bytes: number; priority: number }[] = [];

    // Snapshot the key list first, then process one by one: removeItem in the loop shifts later indexes forward,
    // and deleting while iterating would skip some entries
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }

    for (const key of keys) {
      if (
        key === exceptKey ||
        protectKeys.includes(key) ||
        isProtectedKey(key)
      ) {
        continue;
      }

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      if (shouldEvictByTtl(key, raw, now)) {
        try {
          localStorage.removeItem(key);
          removed += 1;
        } catch {
          /* ignore */
        }
        continue;
      }

      if (!isEvictableKey(key) && !aggressive) continue;

      const prefixIndex = EVICTABLE_PREFIXES.findIndex((p) => key.startsWith(p));
      const priority = prefixIndex >= 0 ? prefixIndex : EVICTABLE_PREFIXES.length;
      candidates.push({ key, bytes: estimateEntryBytes(key, raw), priority });
    }

    candidates.sort((a, b) => a.priority - b.priority || b.bytes - a.bytes);

    for (const { key } of candidates) {
      if (key === exceptKey) continue;
      try {
        localStorage.removeItem(key);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    logger.warn("localStorage 清理失败:", error);
  }

  if (removed > 0) {
    logger.info(`localStorage 已回收 ${removed} 条可清理缓存`);
  }
  return removed;
}

export type SafeLocalStorageSetOptions = CleanupLocalStorageOptions;

/**
 * Write to localStorage; when the quota is short, clean evictable caches automatically and retry.
 * @returns whether the write succeeded
 */
export function safeLocalStorageSetItem(
  key: string,
  value: string,
  options: SafeLocalStorageSetOptions = {},
): boolean {
  if (typeof window === "undefined") return false;

  const attempt = (): boolean => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      return false;
    }
  };

  if (attempt()) return true;

  cleanupEvictableLocalStorage({ ...options, exceptKey: key });
  if (attempt()) return true;

  cleanupEvictableLocalStorage({ ...options, exceptKey: key, aggressive: true });
  if (attempt()) return true;

  logger.error(`localStorage 写入失败（配额不足）: ${key}`);
  return false;
}

export function safeLocalStorageRemoveItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Proactively reclaim expired/large caches at app startup, lowering the chance of later key writes failing. */
export function runStartupLocalStorageMaintenance(): void {
  if (typeof window === "undefined") return;
  cleanupEvictableLocalStorage();
}
