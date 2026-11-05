// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kept consistent with `SIGNABLE_FILE_PATH_PREFIXES` in `packages/courseware-core/src/asset-url-normalize.ts`.
 * `public/` = public bucket assets (live2d_models etc.) — the editor-side list always had it; missing on the agent side, it once made
 * live2d model3.json get dropped at the key extraction stage (batch_presign silently missing entries).
 */
export const SIGNABLE_OBJECT_KEY_PREFIXES = [
  "raw/",
  "artifact/",
  "courseware_assets/",
  "tts_outputs/",
  "organization/",
  "public/",
  // Default AI teacher models (served by private bucket presign after example-public went private).
  // fromPath must recognize this prefix at the normalize stage, or a bare key gets dropped here (key=null).
  "model/live2d_model/",
  "public/avatar/",
] as const;

import {
  coursewareAssetBaseUrl,
  OCI_S3_PUBLIC_BUCKET,
  ossVirtualHostedAccessBaseUrl,
} from "@ainobi/courseware-cli/cli/url-policy.ts";

/** OCI anonymously readable public bucket (the same constant as batch_presign's poisoned-input normalization). */
export const OCI_PUBLIC_BUCKET = OCI_S3_PUBLIC_BUCKET;

/**
 * Host form check for OCI (independent of this deployment's OCI_S3_* env — the host is globally unique to OCI,
 * so the URL form itself is the evidence; isOciS3StorageUrl misses it when env is unconfigured).
 */
const OCI_ANY_NATIVE_HOST = /(^|\.)objectstorage\.[^.]+\.oraclecloud\.com$/i;
const OCI_ANY_COMPAT_HOST = /(^|\.)compat\.objectstorage\.[^.]+\.oci\.customer-oci\.com$/i;

const isOciStorageHost = (host: string): boolean =>
  OCI_ANY_NATIVE_HOST.test(host) || OCI_ANY_COMPAT_HOST.test(host);

const aliyunPublicHosts = (): Set<string> => {
  const hosts = new Set<string>();
  for (const base of [coursewareAssetBaseUrl(), ossVirtualHostedAccessBaseUrl()]) {
    if (!base) continue;
    try {
      hosts.add(new URL(base).host);
    } catch {
      /* ignore */
    }
  }
  return hosts;
};

/** Bucket name of an OCI native (`…/b/<bucket>/o/…`) or compat (`/<bucket>/…`) URL; null for non-OCI hosts. */
export const bucketFromOciUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (!isOciStorageHost(parsed.host)) return null;
    const native = parsed.pathname.match(/^\/n\/[^/]+\/b\/([^/]+)\/o\//);
    if (native) return native[1];
    const compat = parsed.pathname.match(/^\/([^/]+)\//);
    return compat ? compat[1] : null;
  } catch {
    return null;
  }
};

/**
 * Evidence strength of a batch_presign input (smaller is stronger). The same key may appear in several forms
 * (aliyun URL / OCI native URL / signed URL / bare key); the strongest evidence decides how it is served:
 * 0 = aliyun public CDN URL (the object is only in the old bucket; the agent no longer has OSS credentials, so presign always 502s)
 * 1 = OCI public bucket URL (anonymously readable, no signing needed)
 * 2 = other URL (OCI private bucket → presign)
 * 3 = bare key (presign by the active backend)
 */
export function evidenceRankForCoursewarePresign(value: string): number {
  if (!/^https?:\/\//i.test(value.trim())) return 3;
  let host: string;
  try {
    host = new URL(value.trim()).host;
  } catch {
    return 3;
  }
  if (aliyunPublicHosts().has(host)) return 0;
  if (isOciStorageHost(host) && bucketFromOciUrl(value) === OCI_PUBLIC_BUCKET) return 1;
  return 2;
}

/**
 * Public serving rule during the migration transition: aliyun public CDN / OCI public bucket inputs are **not signed**,
 * the stable public URL is returned directly (both are anonymously readable; the aliyun credentials were removed from the agent, so the signing path would break).
 * The OCI public bucket reuses the evidence URL itself (signature query stripped) — the native form is not rebuilt from env
 * (ociS3NativeObjectBaseUrl depends on OCI_S3_* env and would be wrong when it's missing or in multi-region deployments).
 * Returning null = normal presign (private bucket / bare key).
 */
export function publicEchoUrlForCoursewarePresign(
  _key: string,
  _evidence: string | undefined,
): string | null {
  // 2026-09-09: example-public went fully private — echoing public bucket URLs (including the aliyun CDN form)
  // always 404s. Keys of every example-public evidence go to signObjectReadUrl (example-storage).
  return null;
}

/**
 * `public/`-prefixed keys (public bucket assets: live2d_models etc.) → the **public bucket native URL** (anonymously readable).
 * The Live2D runtime fetches moc3/texture/motion files by relative path — the query of a presigned URL isn't
 * passed on to relative requests, so a signed form breaks loading of the whole model; it must be the unsigned public bucket form.
 * When the evidence URL carries origin+namespace it is reused first (independent of this deployment's env), otherwise it falls back to
 * building from env (production env is complete).
 */
export function publicBucketEchoUrlForCoursewarePresign(
  _key: string,
  _evidence: string | undefined,
): string | null {
  // 2026-09-09: example-public went fully private (NoPublicAccess), so echoed public URLs always 404.
  // Every object was copied to example-storage, so everything is signed through signObjectReadUrl.
  return null;
}


/** Object key prefixes stored in AWS S3 buckets (not the agent's direct OSS `raw/` uploads). */
export const AWS_S3_OBJECT_KEY_PREFIXES = [
  "courseware_assets/",
  "tts_outputs/",
  "organization/",
] as const;

/** Agent/CLI direct uploads to OSS (not in the `courseware_assets` asset table). `public/` = public bucket assets (live2d_models etc.). */
export const AGENT_DIRECT_OSS_OBJECT_KEY_PREFIXES = ["raw/", "artifact/", "public/"] as const;

export function isAgentDirectOssObjectKey(key: string): boolean {
  const normalized = key.trim().replace(/^\/+/, "");
  return AGENT_DIRECT_OSS_OBJECT_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Whether the scene JSON references this object key (both a full URL and a bare key match). */
export function coursewareContentReferencesObjectKey(
  content: Record<string, unknown>,
  key: string,
): boolean {
  const normalized = key.trim().replace(/^\/+/, "");
  if (!normalized) return false;
  return JSON.stringify(content).includes(normalized);
}

/**
 * Derived artifacts pass: `artifact/<ext>/<md5>/…` (the conversion output of pdf2html/pptx2html) is
 * derived from a registered raw asset (`raw/<ext>/<md5>.<ext>`) — when the raw one may be signed,
 * its derived tree may be too. On the OCI private bucket, per-page presign of slide HTML is required
 * (it wasn't needed in the aliyun public CDN era).
 */
export function isDerivedArtifactAllowedForCoursewarePresign(
  key: string,
  registeredAssetPaths: ReadonlySet<string>,
): boolean {
  const match = key.match(/^artifact\/(pdf|pptx)\/([0-9a-f]{32})\//i);
  if (!match) return false;
  const rawPrefix = `raw/${match[1]}/${match[2]}.`;
  for (const registered of registeredAssetPaths) {
    if (typeof registered === "string" && registered.startsWith(rawPrefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Default assets public by design (the default AI teacher models / default avatars). After example-public went fully private,
 * these keys are served by private bucket presign instead — they never had access control, so letting them be signed costs no security.
 */
export const PUBLIC_BY_DESIGN_KEY_PREFIXES = [
  "model/live2d_model/",
  "public/avatar/",
  "public/live2d_models/",
] as const;

export function isOssKeyAllowedForCoursewarePresign(
  key: string,
  coursewareContent: Record<string, unknown>,
  registeredAssetPaths: ReadonlySet<string>,
): boolean {
  const normalized = key.trim().replace(/^\/+/, "");
  if (PUBLIC_BY_DESIGN_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  // Slide HTML derived assets (raw/html/assets/*, relative references of pdf/pptx conversion output):
  // allowed once the courseware has registered any raw/html/*.html — the same shape as the artifact ← raw derived unlock;
  // the assets aren't registered in the asset library/content, but strictly belong to that courseware's conversion output family.
  if (normalized.startsWith("raw/html/assets/")) {
    for (const registered of registeredAssetPaths) {
      if (typeof registered === "string" && registered.startsWith("raw/html/")) return true;
    }
  }
  if (registeredAssetPaths.has(key)) return true;
  if (isDerivedArtifactAllowedForCoursewarePresign(key, registeredAssetPaths)) {
    return true;
  }
  return (
    isAgentDirectOssObjectKey(key) &&
    coursewareContentReferencesObjectKey(coursewareContent, key)
  );
}

export function isAwsS3ObjectKey(key: string): boolean {
  return AWS_S3_OBJECT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

const fromPath = (path: string): string | null => {
  const p = path.replace(/^\/+/, "");
  if (!p) return null;
  for (const prefix of SIGNABLE_OBJECT_KEY_PREFIXES) {
    if (p.startsWith(prefix)) {
      // Strip the doubled `public/o/` prefix that earlier saves mixed in
      return p.replace(/^public\/o\//, "") || null;
    }
    const index = p.indexOf(prefix);
    if (index >= 0) {
      return p.slice(index).replace(/^public\/o\//, "") || null;
    }
  }
  return null;
};

/** OCI S3-compat URL host: `<ns>.compat.objectstorage.<region>.oci.customer-oci.com`. */
const OCI_COMPAT_HOST = /(^|\.)compat\.objectstorage\.[^.]+\.oci\.customer-oci\.com$/i;

/** Host of the OCI native form (objectstorage.<region>.oraclecloud.com). */
const OCI_NATIVE_HOST = /(^|\.)objectstorage\.[^.]+\.oraclecloud\.com$/i;

/**
 * Normalize a URL or path passed by the client into a storage object key.
 * OSS: `raw/`, `artifact/`; S3: `courseware_assets/`, `tts_outputs/`, `organization/`.
 *
 * OCI native URLs (`.../n/<ns>/b/<bucket>/o/<key>`) are split on the `/o/` marker.
 * A naive prefix search would match inside the bucket name
 * (example-public → the broken key `public/o/raw/...` → BucketNotFound).
 */
export function normalizeObjectKeyFromInput(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const marker = "/courseware/asset/file/";
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return fromPath(url.pathname.slice(markerIndex + marker.length));
      }
      if (OCI_NATIVE_HOST.test(url.hostname)) {
        const oIndex = url.pathname.indexOf("/o/");
        if (oIndex >= 0) {
          return fromPath(url.pathname.slice(oIndex + 3));
        }
      }
      // OCI compat URL (`/​<bucket>/<key>`): the bucket name is the first segment and must be stripped explicitly. A naive prefix
      // search cuts into the bucket name when it ends in "public" (example-public),
      // producing a doubled `public/public/...` prefix → the gate never passes → presign silently misses entries.
      if (OCI_COMPAT_HOST.test(url.hostname)) {
        const m = url.pathname.match(/^\/[^/]+\/(.+)$/);
        if (m) {
          return fromPath(m[1]);
        }
      }
      return fromPath(url.pathname);
    } catch {
      return null;
    }
  }

  return fromPath(raw);
}
