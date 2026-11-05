// SPDX-License-Identifier: AGPL-3.0-only
import { cliEnv } from "./env.ts";

export const DEFAULT_COURSEWARE_ASSET_BASE_URL =
  "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

/** VPC/internal virtual-hosted OSS host (prod bucket). */
export const DEFAULT_COURSEWARE_OSS_INTERNAL_HOST =
  "example-courseware.oss-ap-northeast-1-internal.aliyuncs.com";

export const DEFAULT_COURSEWARE_HTML_BASE_URL = "https://courseware.example.com";

const normalizePrefix = (value: string): string => value.trim().replace(/\/+$/, "");

export const coursewareAssetBaseUrl = (): string => {
  const configured =
    cliEnv().OSS_PUBLIC_BASE_URL?.trim() ||
    cliEnv().AINOBI_COURSEWARE_ASSET_BASE_URL?.trim() ||
    DEFAULT_COURSEWARE_ASSET_BASE_URL;
  return normalizePrefix(configured);
};

/** Virtual-hosted OSS base for server/VPC access (`https://{bucket}.{endpoint}`). */
export const ossVirtualHostedAccessBaseUrl = (): string | null => {
  const bucket = cliEnv().OSS_BUCKET?.trim();
  if (!bucket) return null;
  const endpoint = cliEnv().OSS_ENDPOINT?.trim();
  const region = cliEnv().OSS_REGION?.trim();
  // OSS_ENDPOINT wins; OSS_REGION — the other shape `assertOssEnv()` accepts —
  // derives `oss-<region>.aliyuncs.com` (mirrors the ali-oss SDK). Without this
  // the hand-rolled signer bailed to unsigned URLs on region-only
  // configurations, which the private bucket then 403s (Codex P1).
  const host = endpoint
    ? endpoint.replace(/^https?:\/\//i, "").replace(/\/+$/, "")
    : region
      ? `${region.startsWith("oss-") ? region : `oss-${region}`}.aliyuncs.com`
      : "";
  if (!host) return null;
  const secureRaw = cliEnv().OSS_SECURE;
  const secure = secureRaw == null || secureRaw === "" || !/^(0|false|no)$/i.test(String(secureRaw));
  const scheme = secure ? "https" : "http";
  return `${scheme}://${bucket}.${host}`;
};

/** Stable public object URL for persistence (no presign query params). */
export const publicUrlForCoursewareObjectKey = (objectKey: string): string => {
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) return "";
  const isHtml = key.startsWith("raw/html/") || key.startsWith("artifact/");
  const base = isHtml ? coursewareHtmlAssetBaseUrl() : coursewareAssetBaseUrl();
  return `${base}/${key}`;
};

/**
 * Inverse of `rewriteSignedUrlForServerAccess`: rewrite VPC/internal OSS host back to
 * `OSS_PUBLIC_BASE_URL` so persisted scene JSON stays browser-reachable.
 */
export const rewriteSignedUrlForPublicPersistence = (signedUrl: string): string => {
  try {
    const signed = new URL(signedUrl);
    const accessBase = ossVirtualHostedAccessBaseUrl();
    if (!accessBase) return signedUrl;

    const publicBase = coursewareAssetBaseUrl();
    const accessHost = new URL(accessBase).host;
    const publicHost = new URL(publicBase).host;
    if (signed.host === accessHost && signed.host !== publicHost) {
      signed.protocol = new URL(publicBase).protocol;
      signed.host = publicHost;
      return signed.toString();
    }
    return signedUrl;
  } catch {
    return signedUrl;
  }
};

/** Public base URL for uploaded HTML assets (CDN/proxy; avoids OSS forced download). */
export const coursewareHtmlAssetBaseUrl = (): string => {
  const configured =
    cliEnv().COURSEWARE_HTML_ASSET_BASE_URL?.trim() || DEFAULT_COURSEWARE_HTML_BASE_URL;
  return normalizePrefix(configured);
};

/**
 * Origin of an **explicitly configured** HTML custom domain (`COURSEWARE_HTML_ASSET_BASE_URL`),
 * or null when unset. Unlike {@link coursewareHtmlAssetBaseUrl} this never falls back to the
 * built-in default: browser-facing html URLs must only be rewritten to a domain that is
 * actually bound to the active bucket (OSS console CNAME binding), which is an operator
 * decision — auto-rewriting to the legacy default would point objects at a host that
 * does not front this bucket.
 */
export const htmlAssetCdnOrigin = (): string | null => {
  const configured = cliEnv().COURSEWARE_HTML_ASSET_BASE_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
};

const uniquePrefixes = (prefixes: string[]): string[] => [...new Set(prefixes.filter(Boolean))];

export const coursewareAssetUrlPrefixes = (): string[] => {
  const multi =
    cliEnv().AINOBI_COURSEWARE_ASSET_BASE_URLS ??
    cliEnv().COURSEWARE_ASSET_BASE_URLS;
  const assetPrefixes = !multi
    ? [coursewareAssetBaseUrl()]
    : (() => {
        const prefixes = multi
          .split(",")
          .map(normalizePrefix)
          .filter(Boolean);
        return prefixes.length > 0 ? prefixes : [coursewareAssetBaseUrl()];
      })();
  const ociBase = ociS3NativeObjectBaseUrl();
  // S3-compat form (https://<ns>.compat.../<bucket>): presigned TTS audio URLs
  // use the compat host — without it in the allowlist, validate --publish falsely flags platform audio as
  // "External courseware asset URL" (the origin of the disclaimer in the 2026-09-06 session-not-loading case).
  const ociCompatEndpoint = ociS3CompatEndpointHost();
  const ociS3Bucket = cliEnv().OCI_S3_BUCKET?.trim();
  // ★The matcher (isAllowedCoursewareAssetUrl) has startsWith semantics and compares the full
  // URL ("https://host/...") — the prefix must carry the scheme too, or it never matches
  // (2026-09-06 review: the first cut missed the scheme, so the compat entry did nothing).
  const ociCompatPrefixes =
    ociCompatEndpoint && ociS3Bucket
      ? [
          `${ociS3CompatEndpointScheme()}://${normalizePrefix(ociCompatEndpoint)}/${normalizePrefix(ociS3Bucket)}`,
        ]
      : [];
  return uniquePrefixes([
    ...assetPrefixes,
    ...(ociBase ? [ociBase] : []),
    ...ociCompatPrefixes,
    coursewareHtmlAssetBaseUrl(),
    // The legacy html origin stays accepted even when COURSEWARE_HTML_ASSET_BASE_URL
    // overrides it: existing scenes legitimately store courseware.example.com
    // references (PPT docs/tests included). The override migrates NEW URL
    // emission — it must not retroactively flag legacy references as external
    // and block `validate --publish` (Codex P1).
    DEFAULT_COURSEWARE_HTML_BASE_URL,
  ]);
};

export const isAllowedCoursewareAssetUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return true;
  return coursewareAssetUrlPrefixes().some((prefix) => (
    trimmed === prefix || trimmed.startsWith(`${prefix}/`)
  ));
};

/** Hosts for which persistence may rewrite asset URLs (public OSS, VPC OSS, HTML CDN). */
export const coursewarePersistenceUrlHosts = (): Set<string> => {
  const hosts = new Set<string>([DEFAULT_COURSEWARE_OSS_INTERNAL_HOST]);
  for (const base of [coursewareAssetBaseUrl(), coursewareHtmlAssetBaseUrl()]) {
    try {
      hosts.add(new URL(base).host);
    } catch {
      /* ignore */
    }
  }
  const access = ossVirtualHostedAccessBaseUrl();
  if (access) {
    try {
      hosts.add(new URL(access).host);
    } catch {
      /* ignore */
    }
  }
  for (const host of ociS3StorageUrlHosts()) {
    hosts.add(host);
  }
  return hosts;
};

// ---------------------------------------------------------------------------
// OCI Object Storage (S3-compatible) URL policy — active when
// `STORAGE_BACKEND=oci_s3` (see `cli/oci-s3-storage.ts` for the client).
// ---------------------------------------------------------------------------

/** `STORAGE_BACKEND=oci_s3` switches the courseware write path to OCI; default keeps aliyun_oss. */
export const resolveCoursewareStorageBackend = (): "aliyun_oss" | "oci_s3" => {
  const value = cliEnv().STORAGE_BACKEND?.trim().toLowerCase();
  return value === "oci_s3" ? "oci_s3" : "aliyun_oss";
};

const normalizeUrlHost = (value: string): string | null => {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

/** Host of the OCI S3-compat endpoint (`<namespace>.compat.objectstorage.<region>.oci.customer-oci.com`). */
export const ociS3CompatEndpointHost = (): string | null => {
  const endpoint = cliEnv().OCI_S3_ENDPOINT?.trim();
  if (!endpoint) return null;
  return endpoint.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || null;
};

/** https, unless the endpoint is explicitly a local store on a plain address (`pnpm lite`). */
const ociS3CompatEndpointScheme = (): string =>
  cliEnv().AINOBI_STORAGE_LOCAL_ENDPOINT?.trim().toLowerCase() === "true" &&
  /^http:\/\//i.test(cliEnv().OCI_S3_ENDPOINT?.trim() ?? "")
    ? "http"
    : "https";

/** Tenancy namespace: `OCI_S3_NAMESPACE` or derived from the compat endpoint host. */
export const ociS3Namespace = (): string => {
  const configured = cliEnv().OCI_S3_NAMESPACE?.trim();
  if (configured) return configured;
  const host = ociS3CompatEndpointHost();
  return host ? host.split(".")[0] : "";
};

/**
 * Stable native-form object base:
 * `https://objectstorage.<region>.oraclecloud.com/n/<namespace>/b/<bucket>/o`.
 * Objects on the private bucket are NOT anonymously readable at this URL —
 * persistence stores this stable shape and browsers get presigned GETs instead.
 */
export const ociS3NativeObjectBaseUrl = (bucketOverride?: string): string | null => {
  const region = cliEnv().OCI_S3_REGION?.trim();
  const bucket = bucketOverride?.trim() || cliEnv().OCI_S3_BUCKET?.trim();
  const namespace = ociS3Namespace();
  if (!region || !bucket || !namespace) return null;
  return `https://objectstorage.${region}.oraclecloud.com/n/${namespace}/b/${bucket}/o`;
};

/** Stable (never-expiring) native-form OCI object URL, or null when OCI is not configured. */
export const publicUrlForOciS3ObjectKey = (
  objectKey: string,
  bucketOverride?: string,
): string | null => {
  const base = ociS3NativeObjectBaseUrl(bucketOverride);
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!base || !key) return null;
  return `${base}/${key}`;
};

/** Public bucket (anonymously readable assets, live2d_models etc.). */
export const OCI_S3_PUBLIC_BUCKET = "example-public";

/**
 * Stable S3-compat object base: `https://<ns>.compat.objectstorage.<region>.oci.customer-oci.com/<bucket>`.
 *
 * The native form (`objectstorage.<region>.oraclecloud.com`) serves NO CORS
 * headers, so browsers can never fetch it — the S3-compat endpoint is the only
 * stable shape that is both anonymously readable AND CORS-enabled
 * (`access-control-allow-origin: *`). Browser-fetched public-bucket assets
 * (live2d models etc.) must persist/echo THIS form.
 *
 * Region/namespace are derived from the evidence URL itself (both OCI host
 * shapes carry them), so this works without any env; when no OCI URL is
 * available it falls back to `OCI_S3_ENDPOINT`/`OCI_S3_BUCKET` env.
 */
export const ociS3CompatObjectBaseUrl = (
  ociUrl: string | null | undefined,
  bucketOverride?: string,
): string | null => {
  const raw = ociUrl?.trim();
  if (raw && /^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const compat =
        /^[^.]+\.compat\.objectstorage\.([^.]+)\.oci\.customer-oci\.com$/i.test(parsed.host);
      if (compat) {
        const bucket =
          bucketOverride?.trim() || parsed.pathname.match(/^\/([^/]+)\//)?.[1]?.trim();
        return bucket ? `https://${parsed.host}/${bucket}` : null;
      }
      const nativeRegion =
        parsed.host.match(/^objectstorage\.([^.]+)\.oraclecloud\.com$/i)?.[1];
      if (nativeRegion) {
        const ns = parsed.pathname.match(/^\/n\/([^/]+)\//)?.[1]?.trim();
        const bucket =
          bucketOverride?.trim() || parsed.pathname.match(/^\/b\/([^/]+)\//)?.[1]?.trim();
        if (ns && bucket) {
          return `https://${ns}.compat.objectstorage.${nativeRegion}.oci.customer-oci.com/${bucket}`;
        }
      }
    } catch {
      /* fall through to env fallback */
    }
  }
  const envHost = ociS3CompatEndpointHost();
  const envBucket = bucketOverride?.trim() || cliEnv().OCI_S3_BUCKET?.trim();
  return envHost && envBucket ? `${ociS3CompatEndpointScheme()}://${envHost}/${envBucket}` : null;
};

/** Stable (never-expiring) S3-compat-form OCI object URL, or null when not derivable. */
export const compatUrlForOciS3ObjectKey = (
  objectKey: string,
  ociUrl: string | null | undefined,
  bucketOverride?: string,
): string | null => {
  const base = ociS3CompatObjectBaseUrl(ociUrl, bucketOverride);
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!base || !key) return null;
  return `${base}/${key}`;
};

/** Hosts that serve OCI-stored courseware objects (native + S3-compat endpoint). */
export const ociS3StorageUrlHosts = (): Set<string> => {
  const hosts = new Set<string>();
  const native = ociS3NativeObjectBaseUrl();
  if (native) {
    const host = normalizeUrlHost(native);
    if (host) hosts.add(host);
  }
  const compat = ociS3CompatEndpointHost();
  if (compat) hosts.add(compat);
  return hosts;
};

/**
 * True when a URL points at OCI-stored courseware storage (any configured OCI host).
 * ★The host form check is env-independent (the same lesson as evidenceRank in courseware-asset-presign):
 * `objectstorage.<region>.oraclecloud.com` / `*.compat.objectstorage.*
 * .oci.customer-oci.com` are globally unique OCI hosts. The sandbox CLI deliberately carries no OCI_S3_* env,
 * so deriving purely from env would make persistence normalization miss OCI URLs on the main save path (settled when
 * bare-key persistence was unified on 2026-09-07).
 */
export const isOciS3StorageUrl = (value: string | null | undefined): boolean => {
  const raw = value?.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  const host = normalizeUrlHost(raw);
  if (!host) return false;
  if (/(^|\.)compat\.objectstorage\.[^.]+\.oci\.customer-oci\.com$/i.test(host)) return true;
  if (/(^|\.)objectstorage\.[^.]+\.oraclecloud\.com$/i.test(host)) return true;
  return ociS3StorageUrlHosts().has(host);
};

/** True when a full URL is on a courseware-managed host (path-only values are still normalized). */
export const isCoursewarePersistenceUrl = (value: string): boolean => {
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return true;
  try {
    return coursewarePersistenceUrlHosts().has(new URL(raw).host);
  } catch {
    return false;
  }
};
