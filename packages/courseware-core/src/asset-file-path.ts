// SPDX-License-Identifier: AGPL-3.0-only
// Recognizes courseware asset URLs and object keys, in the shapes stored scenes and signed URLs use.
export const COURSEWARE_ASSET_FILE_PATH_PREFIXES = [
  "courseware_assets/",
  "quiz_answer_recordings/",
  "tts_outputs/",
  "organization/",
  "public/",
  // Default AI teacher models (served by private bucket presign after example-public went private).
  // Without it, bare keys / relative URLs in the scene metadata get dropped at the key extraction stage → presign
  // silently misses entries → the frontend falls back to fileJoin (the public bucket base) → 404 once the bucket is closed.
  "model/live2d_model/",
  "raw/",
  "artifact/",
] as const;

/** OCI native URL host: `objectstorage.<region>.oraclecloud.com`. */
const OCI_NATIVE_OBJECT_HOST = /(^|\.)objectstorage\.[^.]+\.oraclecloud\.com$/i;
/** OCI S3-compat URL host: `<ns>.compat.objectstorage.<region>.oci.customer-oci.com`. */
const OCI_COMPAT_OBJECT_HOST = /(^|\.)compat\.objectstorage\.[^.]+\.oci\.customer-oci\.com$/i;

/** Extract object key from URL or path for batch presign / signature stripping. */
export const extractCoursewareAssetFilePath = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) return null;
  const fromPath = (path: string): string | null => {
    for (const prefix of COURSEWARE_ASSET_FILE_PATH_PREFIXES) {
      const index = path.indexOf(prefix);
      if (index >= 0) {
        // Strip the doubled `public/o/` prefix that earlier saves mixed in
        return path.slice(index).replace(/^public\/o\//, "") || null;
      }
    }
    return null;
  };

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const marker = "/courseware/asset/file/";
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return fromPath(url.pathname.slice(markerIndex + marker.length));
      }
      // OCI native URLs (`/n/<ns>/b/<bucket>/o/<key>`) are split on the `/o/` marker.
      // A naive prefix search falsely matches the "public/" inside the bucket name `example-public`,
      // returning the broken key `public/o/public/...` — which never matches the filePath in the agent's response,
      // so every presign result mapping fails (the root cause of live2d not loading).
      if (OCI_NATIVE_OBJECT_HOST.test(url.hostname)) {
        const oIndex = url.pathname.indexOf("/o/");
        if (oIndex >= 0) {
          return fromPath(url.pathname.slice(oIndex + 3));
        }
      }
      // OCI compat URL (`/<bucket>/<key>`): the bucket name is the first segment and is stripped explicitly — when the bucket name ends in "public"
      // (example-public), a naive search cuts into the bucket name and produces the poisoned key `public/public/...`,
      // which never matches the filePath in the agent's response (every presign mapping fails).
      if (OCI_COMPAT_OBJECT_HOST.test(url.hostname)) {
        const m = url.pathname.match(/^\/[^/]+\/(.+)$/);
        if (m) {
          return fromPath(m[1]);
        }
      }
      return fromPath(url.pathname.replace(/^\/+/, ""));
    } catch {
      return null;
    }
  }

  return fromPath(raw.replace(/^\/+/, ""));
};

/** Remove S3 / presign query string from a courseware asset URL before persisting; non-asset URLs unchanged. */
export const stripCoursewareAssetSignatureFromUrl = (value: string): string => {
  const raw = value.trim();
  if (!raw || !extractCoursewareAssetFilePath(raw)) return value;
  if (!/^https?:\/\//i.test(raw)) return value;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value;
  }
};
