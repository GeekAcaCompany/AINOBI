// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Presign URL sanitizer for durable stores.
 *
 * Tool outputs and agent transcripts embed presigned GET URLs (OSS `Signature`,
 * SigV4 `X-Amz-*`). Those signatures expire (7 days for OCI), so anything
 * persisted durably — tool-result blobs, transcript lines — must not keep them.
 * URLs with presign params are reduced to their signature-free form (the path
 * keeps the object key recoverable); everything else passes through untouched.
 */

const URL_TEXT_RE = /https?:\/\/[^\s"'<>\\)]+/g;
/** Query param whose NAME contains a presign marker (`X-Amz-Algorithm`, `Signature`, `Expires`, …). */
const PRESIGN_QUERY_RE = /[?&][a-z0-9_-]*(?:signature|expires|x-amz|ossaccesskeyid)[a-z0-9_-]*=/i;

/** Rewrite every presigned URL inside a free-form text blob to its query-free form. */
export function stripPresignQueriesInText(text: string): string {
  if (!text || !text.includes("http")) {
    return text;
  }
  return text.replace(URL_TEXT_RE, (url) =>
    PRESIGN_QUERY_RE.test(url) ? url.split("?")[0] : url,
  );
}

/** Deep variant for JSON-shaped values (transcript entries, tool payloads). */
export function deepStripPresignQueries<T>(value: T): T {
  if (typeof value === "string") {
    return (value.includes("http") ? stripPresignQueriesInText(value) : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepStripPresignQueries(entry)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepStripPresignQueries(entry);
    }
    return out as T;
  }
  return value;
}
