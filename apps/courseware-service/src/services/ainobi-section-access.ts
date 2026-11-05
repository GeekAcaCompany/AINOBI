// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

import { normalizeOrgId } from '../auth/ainobi-org-access.ts';
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import { redisClient } from '../db/db.ts';

const SECTION_ACCESS_CACHE_KEY_PREFIX = 'ainobi-courseware-agent:section-access:';
const DEFAULT_POSITIVE_CACHE_TTL_SECONDS = 300;
const DEFAULT_NEGATIVE_CACHE_TTL_SECONDS = 60;
// Redis is an optional acceleration layer: cache commands on the hot read path must be time-limited, so when Redis is unreachable
// (ioredis lazy connect + default retries would stall every command) it quickly degrades to querying the backend directly
const CACHE_COMMAND_TIMEOUT_MS = 250;

/** The backend's decision on "can this user read this section" (ids all normalized to lowercase uuids). */
export type SectionReadAccess = {
  canRead: boolean;
  orgId: string | null;
  courseId: string | null;
  chapterId: string | null;
};

export type SectionReadAccessFetcher = (
  accessToken: string,
  sectionId: string,
) => Promise<SectionReadAccess>;

/** Cache operation injection point (node:test passes a no-op cache so unit tests never touch a real Redis). */
export type SectionAccessCacheOps = {
  read: (accessToken: string, sectionId: string) => Promise<SectionReadAccess | null>;
  write: (accessToken: string, sectionId: string, access: SectionReadAccess) => Promise<void>;
};

const DENIED_ACCESS: SectionReadAccess = {
  canRead: false,
  orgId: null,
  courseId: null,
  chapterId: null,
};

type SectionInfoApiData = {
  section_id?: string;
  org_id?: string;
  course_id?: string;
  chapter_id?: string;
};

type PlatformEnvelope<T> = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: T;
};

function sectionAccessCacheKey(accessToken: string, sectionId: string): string {
  const digest = createHash('sha256').update(accessToken, 'utf8').digest('hex');
  return `${SECTION_ACCESS_CACHE_KEY_PREFIX}${digest}:${sectionId}`;
}

const CACHE_COMMAND_TIMED_OUT = Symbol('cache-command-timed-out');

/**
 * Put a time limit on a single Redis command: a timeout counts as "cache miss / write abandoned", so an
 * unreachable Redis never stalls the read request. After the timeout the underlying command's promise gets an empty catch,
 * so its later reject doesn't become an unhandled rejection.
 */
async function withCacheCommandTimeout<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const command = run();
    const result = await Promise.race([
      command,
      new Promise<typeof CACHE_COMMAND_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(CACHE_COMMAND_TIMED_OUT), CACHE_COMMAND_TIMEOUT_MS);
      }),
    ]);
    if (result === CACHE_COMMAND_TIMED_OUT) {
      command.catch(() => {});
      return fallback;
    }
    return result as T;
  } catch {
    return fallback;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function positiveCacheTtlSeconds(): number {
  const n = Number(
    process.env.AINOBI_SECTION_ACCESS_CACHE_TTL_SECONDS ?? DEFAULT_POSITIVE_CACHE_TTL_SECONDS,
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_POSITIVE_CACHE_TTL_SECONDS;
}

async function readCachedSectionAccess(
  accessToken: string,
  sectionId: string,
): Promise<SectionReadAccess | null> {
  try {
    const raw = await withCacheCommandTimeout(
      () => redisClient.get(sectionAccessCacheKey(accessToken, sectionId)),
      null,
    );
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SectionReadAccess>;
    if (typeof parsed.canRead !== 'boolean') {
      return null;
    }
    return {
      canRead: parsed.canRead,
      orgId: typeof parsed.orgId === 'string' ? parsed.orgId : null,
      courseId: typeof parsed.courseId === 'string' ? parsed.courseId : null,
      chapterId: typeof parsed.chapterId === 'string' ? parsed.chapterId : null,
    };
  } catch (error) {
    console.warn(
      '[section-access] Redis cache read failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function writeCachedSectionAccess(
  accessToken: string,
  sectionId: string,
  access: SectionReadAccess,
): Promise<void> {
  try {
    // Refusals use a shorter negative cache, so a just-enrolled user isn't stuck for long
    const ttl = access.canRead ? positiveCacheTtlSeconds() : DEFAULT_NEGATIVE_CACHE_TTL_SECONDS;
    await withCacheCommandTimeout(
      () =>
        redisClient.set(
          sectionAccessCacheKey(accessToken, sectionId),
          JSON.stringify(access),
          'EX',
          ttl,
        ),
      null,
    );
  } catch (error) {
    console.warn(
      '[section-access] Redis cache write failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

const defaultCacheOps: SectionAccessCacheOps = {
  read: readCachedSectionAccess,
  write: writeCachedSectionAccess,
};

/**
 * Call the backend's existing lookup route `GET /course_section/{id}/info` as the user to decide
 * "can this user read this section's content". External students of a public course (enrolled, not organization members)
 * pass that route's unified content permission gate too — exactly the semantics step ④ of the courseware read decision relies on
 * (issue #825; the contract is locked by the backend regression test test_course_section_lookup_access.py).
 *
 * - HTTP 200 with code==0 → canRead=true, with the normalized org/course/chapter ids;
 * - 401/403/404 and other 4xx, or code!=0 → refused (negative cache 60s);
 * - 5xx / network error / response parse failure → refused but **not cached** (treated as a transient failure);
 * - the can_access/locked/expired fields in the response are deliberately ignored — the same semantics as the internal student binding check
 *   (isCoursewareBoundInOrg): courseware reads don't check lock/expiry.
 *
 * Never throws; positive/negative results are cached 300s / 60s. When Redis is unavailable it degrades to direct queries:
 * each cache command is capped at 250ms (see withCacheCommandTimeout), and unit tests inject a no-op
 * cache so they never touch a real Redis.
 */
export async function fetchSectionReadAccess(
  accessToken: string,
  sectionId: string,
  cache: SectionAccessCacheOps = defaultCacheOps,
): Promise<SectionReadAccess> {
  const token = accessToken.trim();
  const id = sectionId.trim();
  if (!token || !id) {
    return DENIED_ACCESS;
  }

  const cached = await cache.read(token, id);
  if (cached) {
    return cached;
  }

  const url = ainobiBackendApiUrl(`/course_section/${encodeURIComponent(id)}/info`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });
  } catch (error) {
    console.warn(
      '[section-access] course_section info request failed:',
      error instanceof Error ? error.message : error,
    );
    return DENIED_ACCESS;
  }

  if (response.status >= 500) {
    console.warn('[section-access] course_section info returned', response.status);
    return DENIED_ACCESS;
  }

  let body: PlatformEnvelope<SectionInfoApiData>;
  try {
    body = (await response.json()) as PlatformEnvelope<SectionInfoApiData>;
  } catch {
    return DENIED_ACCESS;
  }

  if (!response.ok || body.code !== 0 || body.success !== true || body.data == null) {
    await cache.write(token, id, DENIED_ACCESS);
    return DENIED_ACCESS;
  }

  const access: SectionReadAccess = {
    canRead: true,
    orgId: normalizeOrgId(body.data.org_id),
    courseId: normalizeOrgId(body.data.course_id),
    chapterId: normalizeOrgId(body.data.chapter_id),
  };
  await cache.write(token, id, access);
  return access;
}
