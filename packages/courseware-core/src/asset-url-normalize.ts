// SPDX-License-Identifier: AGPL-3.0-only
// Runtime-neutral courseware asset URL parsing. Deployment-specific persistence
// policy (which storage backend is active, which hosts collapse to bare keys) reads
// the environment and lives with its host: @ainobi/courseware-cli's
// `cli/asset-url-persistence.ts`.

/**
 * Matches agent `normalizeObjectKeyFromInput`: the prefixes persistence recognises as
 * courseware object keys.
 */
export const SIGNABLE_FILE_PATH_PREFIXES = [
  "courseware_assets/",
  "tts_outputs/",
  "organization/",
  "public/",
  "raw/",
  "artifact/",
] as const;

/**
 * Prefixes load-time presign signs. Adds the default AI-teacher models, served from the
 * private bucket since `example-public` went private; persistence handles them through its
 * pathname fallback instead, so they stay out of {@link SIGNABLE_FILE_PATH_PREFIXES}.
 */
export const PRESIGN_FILE_PATH_PREFIXES = [...SIGNABLE_FILE_PATH_PREFIXES, "model/live2d_model/"] as const;

/** Handles both OCI native and compat hosts (splits on the `/o/` marker first to avoid a false `public/` match inside the bucket name
 *  — prevents the `example-public` → `public/o/raw/...` broken-key regression). */
const OCI_OBJECT_HOST = /objectstorage\./i;
/** Strips the bucket name from an OCI compat URL (`/<bucket>/<key>`). When the bucket name ends in "public"
 *  (example-public), a naive search matches inside the bucket name and doubles it into `public/public/...`. */
const OCI_COMPAT_OBJECT_HOST = /(^|\.)compat\.objectstorage\.[^.]+\.oci\.customer-oci\.com$/i;

export const extractSignableFilePathFromUrl = (
  value: string,
  prefixes: readonly string[] = SIGNABLE_FILE_PATH_PREFIXES,
): string | null => {
  const raw = value.trim();
  if (!raw) return null;
  const fromPath = (path: string): string | null => {
    for (const prefix of prefixes) {
      const index = path.indexOf(prefix);
      if (index >= 0) {
        // Strip the doubled `public/o/` prefix that earlier saves mixed in
        // (traces of broken URLs like b/<bucket>/o/public/o/raw/...).
        return path.slice(index).replace(/^public\/o\//, "") || null;
      }
    }
    return null;
  };
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const marker = "/courseware/asset/file/";
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return fromPath(parsed.pathname.slice(markerIndex + marker.length));
      }
      if (OCI_OBJECT_HOST.test(parsed.hostname)) {
        const oIndex = parsed.pathname.indexOf("/o/");
        if (oIndex >= 0) {
          return fromPath(parsed.pathname.slice(oIndex + 3));
        }
        // OCI compat form (`/<bucket>/<key>`): the bucket name is the first segment, stripped explicitly — when the bucket name
        // ends in "public" (example-public), a naive search cuts into the bucket name and produces `public/public/...`.
        if (OCI_COMPAT_OBJECT_HOST.test(parsed.hostname)) {
          const m = parsed.pathname.match(/^\/[^/]+\/(.+)$/);
          if (m) {
            return fromPath(m[1]);
          }
        }
      }
      return fromPath(parsed.pathname.replace(/^\/+/, ""));
    } catch {
      return null;
    }
  }
  return fromPath(raw.replace(/^\/+/, ""));
};

/** Drop presign query parameters (S3, OSS, CloudFront) in place. */
export const stripPresignQueryParams = (url: URL): void => {
  // Copy the keys first: deleting while iterating the live iterator skips entries.
  // oxlint-disable-next-line no-useless-spread -- copy the keys: deleting while iterating the live iterator skips entries
  for (const key of [...url.searchParams.keys()]) {
    if (/^(x-amz-|ossaccesskeyid|signature|expires|credential|policy|key-pair-id)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
};

/**
 * Collapse `//` (and longer runs) in the path after the origin.
 * e.g. `https://bucket.s3.amazonaws.com//public/foo` → `.../public/foo`
 * Leaves the scheme separator (`://`) untouched.
 */
export const collapseDuplicateUrlPathSlashes = (value: string): string => {
  const raw = value.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const collapsed = url.pathname.replace(/\/{2,}/g, "/");
    if (collapsed === url.pathname) return raw;
    url.pathname = collapsed;
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw;
  }
};
