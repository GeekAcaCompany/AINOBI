// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeTeacherLanguage } from "@ainobi/courseware-cli/cli/narration-language-detect.ts";
import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { ainobiBackendApiUrl } from "../config/ainobi-backend-api.ts";
import { redisClient } from "../db/db.ts";
import { normalizeQuizFeedbackLanguage } from "./courseware-quiz-ai-scoring.ts";

// NOTE: this cache key is keyed by section only (NOT by user token) because the
// AI teacher language of a section is the same for every viewer. That is why the
// cache policy below is strict: only conclusions derived from HTTP 200 bodies may
// be written, otherwise one user's transient auth/network failure would poison
// the shared entry for everyone.
const FEEDBACK_LANGUAGE_CACHE_KEY_PREFIX = "ainobi-courseware-agent:quiz-feedback-language:";
const POSITIVE_CACHE_TTL_SECONDS = 300;
const NEGATIVE_CACHE_TTL_SECONDS = 60;
// Redis is an optional accelerator: cache commands on the scoring path must be
// time-boxed so an unreachable Redis (ioredis lazy connect + default retries)
// degrades to a direct backend lookup instead of stalling the request.
const CACHE_COMMAND_TIMEOUT_MS = 250;

/** Cached conclusion for a section: `language` is a trusted base code or null (no teacher / unconfigured). */
export type QuizFeedbackLanguageCacheValue = {
  language: string | null;
};

/**
 * Cache injection seam (unit tests pass a recording/no-op cache so they never
 * touch real Redis). `write` receives the TTL so tests can assert the
 * positive-300s / negative-60s policy.
 */
export type QuizFeedbackLanguageCacheOps = {
  read: (sectionId: string) => Promise<QuizFeedbackLanguageCacheValue | null>;
  write: (
    sectionId: string,
    value: QuizFeedbackLanguageCacheValue,
    ttlSeconds: number,
  ) => Promise<void>;
};

type PlatformEnvelope<T> = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: T;
};

type SectionInfoApiData = {
  teacher_id?: string | null;
};

type AiTeacherInfoApiData = {
  ai_teacher_language?: string | null;
};

function feedbackLanguageCacheKey(sectionId: string): string {
  return `${FEEDBACK_LANGUAGE_CACHE_KEY_PREFIX}${sectionId}`;
}

const CACHE_COMMAND_TIMED_OUT = Symbol("cache-command-timed-out");

/**
 * Time-box a single Redis command: a timeout counts as "cache miss / skip
 * write" so an unreachable Redis cannot stall the request. After a timeout the
 * underlying command promise gets an empty catch so a late rejection does not
 * become an unhandled rejection. (Mirrors ainobi-section-access.ts.)
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

async function readCachedFeedbackLanguage(
  sectionId: string,
): Promise<QuizFeedbackLanguageCacheValue | null> {
  try {
    const raw = await withCacheCommandTimeout(
      () => redisClient.get(feedbackLanguageCacheKey(sectionId)),
      null,
    );
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<QuizFeedbackLanguageCacheValue>;
    if (parsed.language === null) {
      return { language: null };
    }
    if (typeof parsed.language === "string") {
      return { language: parsed.language };
    }
    return null;
  } catch (error) {
    console.warn(
      "[quiz-feedback-language] Redis cache read failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function writeCachedFeedbackLanguage(
  sectionId: string,
  value: QuizFeedbackLanguageCacheValue,
  ttlSeconds: number,
): Promise<void> {
  try {
    await withCacheCommandTimeout(
      () =>
        redisClient.set(
          feedbackLanguageCacheKey(sectionId),
          JSON.stringify(value),
          "EX",
          ttlSeconds,
        ),
      null,
    );
  } catch (error) {
    console.warn(
      "[quiz-feedback-language] Redis cache write failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

const defaultCacheOps: QuizFeedbackLanguageCacheOps = {
  read: readCachedFeedbackLanguage,
  write: writeCachedFeedbackLanguage,
};

/**
 * Pick the quiz AI feedback language with the unified priority chain
 * (issue #749): the section's configured AI-teacher language wins, then the
 * client hint normalized through the trusted set (anti prompt-injection),
 * then English as the final fallback.
 */
export function pickQuizFeedbackLanguage(
  teacherLanguage: string | null,
  clientLanguage: string | null | undefined,
): string {
  return teacherLanguage ?? normalizeQuizFeedbackLanguage(clientLanguage) ?? "en";
}

/**
 * Resolve the AI-teacher language configured for a course section, as the
 * authoritative feedback language for quiz AI scoring (issue #749).
 *
 * Backend lookups (both envelope-tolerant, `body.data ?? body`, mirroring
 * fetchAiTeacherProfile in ainobi-interaction-service):
 * 1. `GET /course_section/{sectionId}/info` -> `teacher_id`
 * 2. `GET /ai_teacher/{teacherId}/info` -> `ai_teacher_language`
 *
 * The raw value is normalized through {@link normalizeQuizFeedbackLanguage};
 * garbage counts as unconfigured (null). Never throws.
 *
 * Cache policy (the Redis key is shared across users — see the note at the
 * constants): only conclusions derived from HTTP 200 responses are written —
 * positive `{language: "ja"}` for 300s, negative `{language: null}` (no
 * teacher / no or invalid language, both from 200 bodies) for 60s. On
 * 401/403/404/5xx, network errors, or JSON parse failures the resolver
 * returns null WITHOUT writing the cache.
 */
export async function resolveSectionAiTeacherLanguage(
  session: Pick<AinobiAuthorizedSession, "accessToken">,
  sectionId: string,
  cache: QuizFeedbackLanguageCacheOps = defaultCacheOps,
): Promise<string | null> {
  const id = sectionId.trim();
  const token = session.accessToken?.trim();
  if (!id || !token) {
    return null;
  }

  const cached = await cache.read(id);
  if (cached) {
    return cached.language;
  }

  const teacherId = await fetchSectionTeacherId(token, id);
  if (teacherId === undefined) {
    // Transient failure (non-200 / network / parse) — do not poison the shared cache.
    return null;
  }
  if (teacherId === null) {
    // Settled conclusion from a 200 body: this section has no AI teacher.
    await cache.write(id, { language: null }, NEGATIVE_CACHE_TTL_SECONDS);
    return null;
  }

  const rawLanguage = await fetchAiTeacherLanguage(token, teacherId);
  if (rawLanguage === undefined) {
    return null;
  }
  // Compatibility aliases of platform fields (Chinese / Japanese / en-US …): first through narration's alias normalization,
  // keeping the same tolerance for teacher languages as the narration path, then into quiz normalization.
  const aliasNormalized = normalizeTeacherLanguage(rawLanguage);
  const language = normalizeQuizFeedbackLanguage(aliasNormalized ?? rawLanguage) ?? null;
  await cache.write(
    id,
    { language },
    language ? POSITIVE_CACHE_TTL_SECONDS : NEGATIVE_CACHE_TTL_SECONDS,
  );
  return language;
}

/**
 * `GET /course_section/{id}/info` -> teacher id.
 * Returns `undefined` on transient failure (do not cache), `null` when the
 * 200 body has no teacher bound, or the trimmed teacher id.
 */
async function fetchSectionTeacherId(
  accessToken: string,
  sectionId: string,
): Promise<string | null | undefined> {
  const url = ainobiBackendApiUrl(`/course_section/${encodeURIComponent(sectionId)}/info`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
  } catch (error) {
    console.warn(
      "[quiz-feedback-language] course_section info request failed:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
  if (!response.ok) {
    console.warn("[quiz-feedback-language] course_section info returned", response.status);
    return undefined;
  }
  let body: PlatformEnvelope<SectionInfoApiData>;
  try {
    body = (await response.json()) as PlatformEnvelope<SectionInfoApiData>;
  } catch {
    return undefined;
  }
  const data = body.data ?? (body as unknown as SectionInfoApiData);
  const teacherId = typeof data?.teacher_id === "string" ? data.teacher_id.trim() : "";
  return teacherId || null;
}

/**
 * `GET /ai_teacher/{id}/info` -> raw `ai_teacher_language`.
 * Returns `undefined` on transient failure (do not cache), otherwise the raw
 * value (possibly null/empty) for the caller to normalize.
 */
async function fetchAiTeacherLanguage(
  accessToken: string,
  teacherId: string,
): Promise<string | null | undefined> {
  const url = ainobiBackendApiUrl(`/ai_teacher/${encodeURIComponent(teacherId)}/info`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
  } catch (error) {
    console.warn(
      "[quiz-feedback-language] ai_teacher info request failed:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
  if (!response.ok) {
    console.warn("[quiz-feedback-language] ai_teacher info returned", response.status);
    return undefined;
  }
  let body: PlatformEnvelope<AiTeacherInfoApiData>;
  try {
    body = (await response.json()) as PlatformEnvelope<AiTeacherInfoApiData>;
  } catch {
    return undefined;
  }
  const data = body.data ?? (body as unknown as AiTeacherInfoApiData);
  return typeof data?.ai_teacher_language === "string" ? data.ai_teacher_language : null;
}
