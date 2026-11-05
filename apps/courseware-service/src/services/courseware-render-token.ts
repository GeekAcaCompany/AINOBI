// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, stateless bearer token that lets the FC headless renderer page
 * (`courseware-renderer?hf=1`, running with no logged-in session) read one
 * specific courseware's content without normal org/`is_public`/`is_share`
 * checks. Minted by `courseware-render-http.ts` at task-creation time (after
 * the *requesting user's* own read access has already been verified);
 * verified narrowly in `courseware-http.ts`'s `GET /courseware` handler —
 * read-only, scoped to a single courseware id, and expires quickly.
 *
 * Stateless HMAC (no DB/Redis lookup) so verification works no matter which
 * warm FC instance the renderer's request happens to land on.
 */
const DEFAULT_RENDER_TOKEN_TTL_SECONDS = 2 * 60 * 60; // 2h — comfortably longer than any single render.

let warnedNoRenderTokenSecret = false;

function resolveRenderTokenSecret(): string {
  const raw = process.env.AINOBI_RENDER_TOKEN_SECRET?.trim();
  if (raw) {
    return raw;
  }
  if (!warnedNoRenderTokenSecret) {
    warnedNoRenderTokenSecret = true;
    console.warn(
      "[courseware-render-token] AINOBI_RENDER_TOKEN_SECRET not set; using an insecure " +
        "development-only fallback secret. Set this in production (e.g. `openssl rand -hex 32`) " +
        "so render tokens granting anonymous read access can't be forged.",
    );
  }
  return "dev-insecure-render-token-secret-do-not-use-in-production";
}

function sign(coursewareId: string, expiresAtEpochSeconds: number): string {
  return createHmac("sha256", resolveRenderTokenSecret())
    .update(`${coursewareId}.${expiresAtEpochSeconds}`)
    .digest("hex");
}

/** Token format: `<expiresAtEpochSeconds>.<hexHmac>` — URL-safe with no escaping needed. */
export function mintCoursewareRenderToken(
  coursewareId: string,
  ttlSeconds: number = DEFAULT_RENDER_TOKEN_TTL_SECONDS,
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  return `${expiresAt}.${sign(coursewareId, expiresAt)}`;
}

/** Test-only: mint a token with an explicit (possibly already-expired) `expiresAt`, bypassing the production TTL floor. */
export function _mintCoursewareRenderTokenForTests(
  coursewareId: string,
  expiresAtEpochSeconds: number,
): string {
  return `${expiresAtEpochSeconds}.${sign(coursewareId, expiresAtEpochSeconds)}`;
}

/** Verifies the token was minted for exactly this `coursewareId` and hasn't expired. */
export function verifyCoursewareRenderToken(
  token: string | null | undefined,
  coursewareId: string,
): boolean {
  const trimmed = token?.trim();
  if (!trimmed) {
    return false;
  }
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex <= 0) {
    return false;
  }
  const expiresAtRaw = trimmed.slice(0, dotIndex);
  const signature = trimmed.slice(dotIndex + 1);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || !signature) {
    return false;
  }
  if (Math.floor(Date.now() / 1000) > expiresAt) {
    return false; // expired
  }

  const expected = Buffer.from(sign(coursewareId, expiresAt), "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
