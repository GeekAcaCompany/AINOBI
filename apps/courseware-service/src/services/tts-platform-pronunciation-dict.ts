// SPDX-License-Identifier: AGPL-3.0-only
import { IsNull } from 'typeorm';

import { dataSource } from '../db/db.ts';
import { ensureDataSource } from '../db/ensure-data-source.ts';
import { TtsPronunciationPlatform } from '../models/tts-pronunciation-platform.ts';
import { listEnabledPronunciationDictEntries } from './courseware-tts-pronunciation-dict-service.ts';
import {
  normalizePronunciationSourceKey,
  type PronunciationDictEntry,
} from './tts-pronunciation-apply.ts';

/**
 * Platform-level pronunciation dictionary: read straight from the backend-owned
 * `tts_pronunciation` table (same database, no HTTP) and applied below every
 * organization's own dictionary: org > platform > kuroshiro auto conversion.
 * Its entries are Japanese-only, so it is merged ONLY into Japanese narration
 * (see `loadMergedPronunciationDictEntries`'s `includePlatform`).
 *
 * The lookup is cached in-process per instance (default 60 s, single-flight).
 * A failed query never fails synthesis: the previous copy is kept, or `[]` is
 * used when there is none (e.g. the backend migration has not run yet).
 */

const DEFAULT_CACHE_TTL_SECONDS = 60;
const PLATFORM_DICT_LANGUAGE = 'ja';

export type PlatformPronunciationDictQuery = () => Promise<PronunciationDictEntry[]>;

type CacheState = { entries: PronunciationDictEntry[]; fetchedAt: number };

let cache: CacheState | null = null;
let inflight: Promise<PronunciationDictEntry[]> | null = null;

function isPlatformDictDisabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.AINOBI_TTS_PLATFORM_DICT_DISABLED?.trim() ?? '');
}

function cacheTtlMs(): number {
  // Unset, empty or invalid means the default; only an explicit number counts
  // (`Number('')` is 0, which would disable the cache and the failure back-off).
  const raw = process.env.AINOBI_TTS_PLATFORM_DICT_CACHE_TTL_SECONDS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  const seconds =
    Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_SECONDS;
  return seconds * 1000;
}

const queryPlatformDictFromDb: PlatformPronunciationDictQuery = async () => {
  await ensureDataSource();
  const repo = dataSource.getRepository(TtsPronunciationPlatform);
  const rows = await repo.find({
    where: { language: PLATFORM_DICT_LANGUAGE, enabled: true, deletedAt: IsNull() },
    order: { sourceText: 'ASC' },
  });
  return rows.map((row) => ({
    sourceText: row.sourceText,
    language: 'ja' as const,
    pronunciation: row.pronunciation,
    enabled: true,
  }));
};

/** Test-only: forget the in-process cache and any in-flight query. */
export function __resetPlatformDictCacheForTests(): void {
  cache = null;
  inflight = null;
}

/**
 * Enabled platform entries (ja), cached in-process. Never throws.
 */
export async function listEnabledPlatformPronunciationDictEntries(
  options: {
    query?: PlatformPronunciationDictQuery;
    now?: () => number;
  } = {},
): Promise<PronunciationDictEntry[]> {
  if (isPlatformDictDisabled()) return [];
  const now = options.now ?? Date.now;
  if (cache && now() - cache.fetchedAt < cacheTtlMs()) {
    return cache.entries;
  }
  if (inflight) return inflight;
  const query = options.query ?? queryPlatformDictFromDb;
  inflight = (async () => {
    try {
      // `Promise.resolve().then(query)`: a query that throws synchronously would
      // otherwise run the finally (inflight = null) before `inflight` is assigned
      // below, leaving a settled promise wedged in as the in-flight lookup.
      const entries = await Promise.resolve().then(query);
      cache = { entries, fetchedAt: now() };
      return entries;
    } catch (error) {
      console.warn(
        '[tts-platform-dict] failed to load the platform pronunciation dict; using the previous copy:',
        error instanceof Error ? error.message : String(error),
      );
      // Keep serving the last good copy (or nothing) and back off for one TTL so a
      // missing table does not turn every synthesis into a failing query.
      cache = { entries: cache?.entries ?? [], fetchedAt: now() };
      return cache.entries;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Org entries win on the normalized source key (trim + digit fold, case-sensitive
 * like the trie, per language); platform entries the org did not define are
 * appended after.
 */
export function mergePlatformIntoOrgEntries(
  orgEntries: readonly PronunciationDictEntry[],
  platformEntries: readonly PronunciationDictEntry[],
): PronunciationDictEntry[] {
  const keyOf = (entry: PronunciationDictEntry): string =>
    `${entry.language} ${normalizePronunciationSourceKey(entry.sourceText)}`;
  const shadowed = new Set(orgEntries.map(keyOf));
  const rest = platformEntries.filter((entry) => !shadowed.has(keyOf(entry)));
  return [...orgEntries, ...rest];
}

/**
 * Org dict + platform dict for one organization: org entries first (in their own
 * order), then platform entries the org did not shadow. A platform lookup failure
 * degrades to org-only; an org lookup failure propagates as before.
 *
 * `includePlatform` must be `true` only for Japanese narration (AI teacher or
 * selected voice language `ja`, resolved from the catalogs, never from the text).
 * The platform dict is ja-only and its readings are "digit + counter" kana: merged
 * into a Chinese / English job they rewrite `9月3日` to `くがつみっか`. The org dict
 * is the org's own responsibility and is always included.
 */
export async function loadMergedPronunciationDictEntries(
  orgId: string,
  options: {
    includePlatform: boolean;
    listOrg?: (orgId: string) => Promise<PronunciationDictEntry[]>;
    listPlatform?: () => Promise<PronunciationDictEntry[]>;
  },
): Promise<PronunciationDictEntry[]> {
  const listOrg = options.listOrg ?? listEnabledPronunciationDictEntries;
  if (!options.includePlatform) {
    return listOrg(orgId);
  }
  const listPlatform = options.listPlatform ?? listEnabledPlatformPronunciationDictEntries;
  const [orgEntries, platformEntries] = await Promise.all([
    listOrg(orgId),
    listPlatform().catch((error: unknown) => {
      console.warn(
        '[tts-platform-dict] platform dict unavailable; using org dict only:',
        error instanceof Error ? error.message : String(error),
      );
      return [] as PronunciationDictEntry[];
    }),
  ]);
  return mergePlatformIntoOrgEntries(orgEntries, platformEntries);
}
