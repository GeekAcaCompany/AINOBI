// SPDX-License-Identifier: AGPL-3.0-only
import { publicUrlForObjectKey } from "@ainobi/courseware-cli/cli/assets.ts";
import { extractSignableFilePathFromUrl } from "@ainobi/courseware-core/asset-url-normalize.ts";
import { isOciS3StorageUrl } from "@ainobi/courseware-cli/cli/url-policy.ts";

/** Object key from a stored courseware URL: `courseware_covers/` prefix anchor (same rule as cover-http). */
function coverObjectKeyFromStoredUrl(coverUrl: string): string | null {
  const idx = coverUrl.indexOf("courseware_covers/");
  if (idx < 0) return null;
  const key = coverUrl
    .slice(idx)
    .split("?")[0]
    .split("#")[0]
    .trim();
  return key || null;
}

/** Object key from a stored recording URL: `quiz_answer_recordings/` prefix anchor. */
function recordingObjectKeyFromStoredUrl(fileUrl: string): string | null {
  const idx = fileUrl.indexOf("quiz_answer_recordings/");
  if (idx < 0) return null;
  const key = fileUrl
    .slice(idx)
    .split("?")[0]
    .split("#")[0]
    .trim();
  return key || null;
}

/**
 * Serve a playable URL for a persisted object reference (URL **or bare key**).
 *
 * Persistence policy: durable stores keep the object key / signature-free
 * forms — never an expiring signature. Response shaping derives the URL here:
 * - bare key → URL from the **active** backend (aliyun public base / OCI presigned GET)
 * - legacy aliyun public URL → pass through (permanent)
 * - OCI URL (native or compat, legacy rows) → re-signed from the extracted key
 */
function playableUrlForStoredReference(
  raw: string,
  objectKeyFromStored: (value: string) => string | null,
): string | null {
  // Bare key (no scheme): the new persistence shape.
  if (!/^https?:\/\//i.test(raw)) {
    try {
      return publicUrlForObjectKey(raw.replace(/^\/+/, ""));
    } catch {
      return raw;
    }
  }
  if (!isOciS3StorageUrl(raw)) {
    // Legacy aliyun public bucket URL — permanent, still valid.
    return raw;
  }
  const objectKey = objectKeyFromStored(raw);
  if (!objectKey) {
    return raw;
  }
  try {
    return publicUrlForObjectKey(objectKey, undefined, { backend: "oci_s3" });
  } catch {
    // Configuration problem — better to return the stored URL than to fail the listing.
    return raw;
  }
}

/** Fresh playable URL for the `coverUrl` column (see {@link playableUrlForStoredReference}). */
export function refreshCoursewareCoverUrlForResponse(
  coverUrl: string | null | undefined,
): string | null {
  const raw = coverUrl?.trim();
  if (!raw) {
    return coverUrl ?? null;
  }
  return playableUrlForStoredReference(raw, coverObjectKeyFromStoredUrl);
}

/** Fresh playable URL for the `courseware_assets.file_url` column. */
export function refreshCoursewareAssetFileUrlForResponse(
  fileUrl: string | null | undefined,
): string | null {
  const raw = fileUrl?.trim();
  if (!raw) {
    return fileUrl ?? null;
  }
  return playableUrlForStoredReference(raw, extractSignableFilePathFromUrl);
}

/** Fresh playable URL for the `courseware_quiz_answer_recordings.file_url` column. */
export function refreshCoursewareRecordingFileUrlForResponse(
  fileUrl: string | null | undefined,
): string | null {
  const raw = fileUrl?.trim();
  if (!raw) {
    return fileUrl ?? null;
  }
  return playableUrlForStoredReference(raw, recordingObjectKeyFromStoredUrl);
}
