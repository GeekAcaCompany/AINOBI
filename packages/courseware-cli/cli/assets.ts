// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { buildOssV1PresignedGetUrl } from "@ainobi/storage-impl/signing.ts";
import { normalizeAssetExtension } from "./asset-extension.ts";
import { AinobiCliError } from "./errors.ts";
import {
  type CoursewareStorageBackend,
  deleteOciS3Object,
  copyOciS3Object,
  ociS3ObjectExists,
  putOciS3ObjectBuffer,
  putOciS3ObjectFromFile,
  getOciS3ObjectBytes,
  beginOciS3MultipartUpload,
  uploadOciS3MultipartPart,
  completeOciS3MultipartUpload,
  abortOciS3MultipartUpload,
  resetOciS3Client,
  signOciS3ObjectReadUrl,
  OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES,
} from "./oci-s3-storage.ts";
import { isAssetHostFlush } from "./runtime.ts";
import { cliEnv } from "./env.ts";
import {
  coursewareAssetBaseUrl,
  coursewareHtmlAssetBaseUrl,
  DEFAULT_COURSEWARE_OSS_INTERNAL_HOST,
  htmlAssetCdnOrigin,
  isOciS3StorageUrl,
  ossVirtualHostedAccessBaseUrl,
  resolveCoursewareStorageBackend,
} from "./url-policy.ts";

export { SUPPORTED_COURSEWARE_ASSET_EXTENSIONS, normalizeAssetExtension } from "./asset-extension.ts";
export type { CoursewareStorageBackend } from "./oci-s3-storage.ts";

interface OssClient {
  head(objectKey: string): Promise<unknown>;
  get(objectKey: string, options?: Record<string, unknown>): Promise<{ content: Buffer | Uint8Array | string }>;
  put(objectKey: string, content: Buffer | string, options?: Record<string, unknown>): Promise<unknown>;
  multipartUpload(objectKey: string, content: Buffer | string, options?: Record<string, unknown>): Promise<unknown>;
  initMultipartUpload(objectKey: string, options?: Record<string, unknown>): Promise<{ uploadId: string; res?: { headers?: Record<string, string> } }>;
  uploadPart(
    objectKey: string,
    uploadId: string,
    partNo: number,
    chunk: Buffer,
    start: number,
    end: number,
    options?: Record<string, unknown>,
  ): Promise<{ etag?: string; res?: { headers?: Record<string, string> } }>;
  completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: Array<{ number: number; etag: string }>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  abortMultipartUpload(objectKey: string, uploadId: string, options?: Record<string, unknown>): Promise<unknown>;
  copy(sourceKey: string, targetKey: string, options?: Record<string, unknown>): Promise<unknown>;
  delete(objectKey: string, options?: Record<string, unknown>): Promise<unknown>;
  signatureUrl(objectKey: string, options?: { expires?: number; method?: string }): string;
}

export type OssMultipartPartRecord = {
  partNumber: number;
  etag: string;
};

type OssConstructor = new (options: Record<string, unknown>) => OssClient;

export interface UploadedAsset {
  file_id: string;
  file_name: string;
  extension: string;
  bytes: number;
  content_type: string;
  object_key: string;
  object_path: string;
  url: string;
  existed: boolean;
}

export interface ConvertedDocumentAsset extends UploadedAsset {
  artifact_src: string;
  slide_count: number;
  conversion: Record<string, unknown>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".tiff": "image/tiff",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".webm": "video/webm",
};

export const SUPPORTED_QUIZ_ANSWER_RECORDING_EXTENSIONS = new Set([
  ".webm",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
]);

export const SUPPORTED_COURSEWARE_COVER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export const normalizeCoursewareCoverExtension = (pathOrExt: string): string => {
  const raw = pathOrExt.startsWith(".") ? pathOrExt : extname(pathOrExt);
  const extension = raw.toLowerCase() === ".jpeg" ? ".jpg" : raw.toLowerCase();
  if (!SUPPORTED_COURSEWARE_COVER_EXTENSIONS.has(extension)) {
    throw new AinobiCliError(
      "UNSUPPORTED",
      `Unsupported courseware cover extension "${extension || "(none)"}".`,
      {
        hint: `Supported: ${Array.from(SUPPORTED_COURSEWARE_COVER_EXTENSIONS).join(", ")}`,
      },
    );
  }
  return extension === ".jpeg" ? ".jpg" : extension;
};

/** OSS object key of the courseware cover (kept apart from the asset library's `raw/*`). */
export const coursewareCoverObjectKey = (
  orgId: string,
  coursewareId: string,
  contentMd5: string,
  extension: string,
): string => {
  const normalized = normalizeCoursewareCoverExtension(extension);
  const safeOrg = orgId.trim().toLowerCase();
  const safeCourseware = coursewareId.trim().toLowerCase();
  const safeMd5 = contentMd5.trim().toLowerCase();
  return `courseware_covers/${safeOrg}/${safeCourseware}/${safeMd5}${normalized}`;
};

export const normalizeQuizAnswerRecordingExtension = (pathOrExt: string): string => {
  const raw = pathOrExt.startsWith(".") ? pathOrExt : extname(pathOrExt);
  const extension = raw.toLowerCase();
  if (!SUPPORTED_QUIZ_ANSWER_RECORDING_EXTENSIONS.has(extension)) {
    throw new AinobiCliError(
      "UNSUPPORTED",
      `Unsupported quiz answer recording extension "${extension || "(none)"}".`,
      {
        hint: `Supported: ${Array.from(SUPPORTED_QUIZ_ANSWER_RECORDING_EXTENSIONS).join(", ")}`,
      },
    );
  }
  return extension;
};

const numberEnv = (name: string, fallback: number): number => {
  const value = Number(cliEnv()[name]);
  return Number.isFinite(value) ? value : fallback;
};

const boolEnv = (name: string, fallback: boolean): boolean => {
  const value = cliEnv()[name];
  if (value == null || value === "") return fallback;
  return !/^(0|false|no)$/i.test(String(value));
};

const normalizeEndpoint = (value: string): string =>
  value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

const md5 = (content: Buffer): string => createHash("md5").update(content).digest("hex");

export const assetObjectKey = (fileId: string, extension: string): string => {
  const normalized = normalizeAssetExtension(extension);
  return `raw/${normalized.slice(1)}/${fileId}${normalized}`;
};

const objectPath = (objectKey: string): string => `/${objectKey}`;

const isHtmlObjectKey = (objectKey: string, extension?: string): boolean =>
  extension === ".html" ||
  objectKey.startsWith("raw/html/") ||
  objectKey.startsWith("artifact/");

const signedAliyunReadUrlForObjectKey = (objectKey: string): string | null => {
  // example-storage (the active aliyun bucket since the 2026-09 storage
  // migration) is PRIVATE: the legacy unsigned public-base form 404s for
  // objects stored there. Sign against the active bucket (OSS V1 query
  // signature, 7d — mirrors the SDK's signatureUrl). Returns null when the
  // creds are not configured so callers can fall back to the public form.
  // Trimmed like ossVirtualHostedAccessBaseUrl(), whose host is sliced below.
  const bucket = cliEnv().OSS_BUCKET?.trim() || "";
  const accessKeyId = cliEnv().ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = cliEnv().ALIYUN_ACCESS_KEY_SECRET;
  if (!bucket || !accessKeyId || !accessKeySecret) return null;
  // Host/scheme come from ossVirtualHostedAccessBaseUrl: it honors OSS_SECURE
  // (an HTTP-only endpoint must not be emitted as https — browsers fail the
  // TLS handshake before OSS validates the signature) and accepts OSS_REGION
  // as well as OSS_ENDPOINT — region-only configs used to bail to the
  // unsigned fallback here, which the private bucket then 403s (Codex P1).
  const accessBase = ossVirtualHostedAccessBaseUrl();
  if (!accessBase) return null;
  // The V1 signature covers /{bucket}/{key} — not the host — so when the
  // configured endpoint is the VPC-internal one (production/test setups),
  // emit the public host: end-user browsers cannot reach -internal hosts.
  const parsed = new URL(accessBase);
  const host = parsed.host.replace("-internal.", ".");
  return buildOssV1PresignedGetUrl({
    accessKeyId,
    accessKeySecret,
    endpoint: host.slice(bucket.length + 1), // the access base is {bucket}.{endpoint}
    bucketName: bucket,
    objectKey,
    expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    protocol: parsed.protocol === "http:" ? "http" : "https",
  });
};

export const publicUrlForObjectKey = (
  objectKey: string,
  extension?: string,
  options?: { backend?: CoursewareStorageBackend },
): string => {
  const backend = options?.backend ?? activeStorageBackend();
  if (backend === "oci_s3") {
    // Private bucket: no anonymous URL exists. Browsers get a presigned GET
    // (7d by default; re-presigned at scene load via batch_presign_urls).
    // The HTML CDN (coursewareHtmlAssetBaseUrl) only fronts the aliyun bucket,
    // so OCI html/artifact objects use presigned URLs too.
    return signOciS3ReadUrl(objectKey);
  }
  // The active aliyun bucket is PRIVATE (example-storage) — serve a signed
  // read URL; only fall back to the legacy unsigned public form when the
  // signing creds are absent. html/artifact keys go through the configured
  // custom domain so browsers render (not download) slide HTML.
  const signed = signedAliyunReadUrlForObjectKey(objectKey);
  if (signed) return withHtmlCdnHost(signed, objectKey, extension);
  return unsignedPublicUrlForObjectKey(objectKey, extension);
};

/**
 * Durable reference for DB rows / scene JSON: the **bare object key**.
 *
 * Policy: time-limited URLs never reach durable stores, and URL forms (aliyun
 * public URLs, OCI native URLs) are legacy shapes that carry no advantage over
 * the key — every read outlet derives the URL (aliyun public base / OCI
 * presigned GET) from the key at response time via {@link publicUrlForObjectKey}.
 * Legacy rows still holding URL forms keep working: key extraction anchors on
 * the known storage prefixes (`normalizeObjectKeyFromInput` /
 * `extractSignableFilePathFromUrl` handle both).
 */
export const persistenceUrlForObjectKey = (
  objectKey: string,
  _extension?: string,
  _options?: { backend?: CoursewareStorageBackend },
): string => objectKey.trim().replace(/^\/+/, "");

/**
 * Swap a browser-facing aliyun object URL onto the configured HTML custom domain
 * (`COURSEWARE_HTML_ASSET_BASE_URL`, e.g. `https://courseware.geekaca.cn`).
 *
 * Why: OSS force-attaches `Content-Disposition: attachment` to `text/html`
 * served from the default `*.aliyuncs.com` domain, so pptx→html slides turn
 * into downloads inside iframes. A domain bound to the bucket (OSS console
 * CNAME binding) drops that behaviour. Safe because the OSS V1 signature
 * covers `/{bucket}/{key}` — never the host — and only when the domain is
 * actually bound to the active bucket (operator-configured, see
 * {@link htmlAssetCdnOrigin}).
 *
 * The override is deliberately opt-in and NOT defaulted to
 * `courseware.example.com`: that legacy origin fronts the retired Tokyo public
 * bucket — auto-rewriting private-bucket objects onto it would emit unsigned
 * URLs that 403. Deployments serving inline slide HTML must configure
 * COURSEWARE_HTML_ASSET_BASE_URL (test env: courseware.geekaca.cn via the OOS
 * courseware param); production is oci_s3 and never reaches this path. With
 * the env unset the fallback is the direct signed bucket URL — same as every
 * non-html object (Codex round 6 P1 resolved as "configure the override in
 * every deployment", since preserving the legacy default would regress).
 */
const withHtmlCdnHost = (url: string, objectKey: string, extension?: string): string => {
  const origin = htmlAssetCdnOrigin();
  if (!origin || !isHtmlObjectKey(objectKey, extension)) return url;
  try {
    const parsed = new URL(url);
    const target = new URL(origin);
    parsed.protocol = target.protocol;
    parsed.host = target.host;
    return parsed.toString();
  } catch {
    return url;
  }
};

const unsignedPublicUrlForObjectKey = (objectKey: string, extension?: string): string => {
  const publicBaseUrl = isHtmlObjectKey(objectKey, extension)
    ? coursewareHtmlAssetBaseUrl()
    : coursewareAssetBaseUrl();
  if (publicBaseUrl) return `${publicBaseUrl}/${objectKey}`;

  const bucket = cliEnv().OSS_BUCKET || "";
  const endpoint = normalizeEndpoint(cliEnv().OSS_ENDPOINT || "");
  if (!bucket || !endpoint) return objectPath(objectKey);
  const scheme = boolEnv("OSS_SECURE", true) ? "https" : "http";
  return `${scheme}://${bucket}.${endpoint}/${objectKey}`;
};

/** Active object-storage backend for courseware writes (`STORAGE_BACKEND`, default aliyun_oss). */
export const activeStorageBackend = (): CoursewareStorageBackend => resolveCoursewareStorageBackend();

const useOciS3 = (): boolean => activeStorageBackend() === "oci_s3";

/**
 * Storage backend that owns an existing object reference: the URL host family
 * wins (transition-safe — legacy aliyun URLs keep resolving against aliyun),
 * bare object keys follow the active backend.
 */
export const storageBackendForStoredObjectUrl = (
  value: string | null | undefined,
): CoursewareStorageBackend => {
  if (isOciS3StorageUrl(value)) return "oci_s3";
  if (value && /^https?:\/\//i.test(value.trim())) {
    const host = (() => {
      try {
        return new URL(value.trim()).host;
      } catch {
        return "";
      }
    })();
    const aliyunHosts = new Set<string>([DEFAULT_COURSEWARE_OSS_INTERNAL_HOST]);
    for (const base of [coursewareAssetBaseUrl(), coursewareHtmlAssetBaseUrl()]) {
      try {
        aliyunHosts.add(new URL(base).host);
      } catch {
        /* ignore */
      }
    }
    const accessBase = ossVirtualHostedAccessBaseUrl();
    if (accessBase) {
      try {
        aliyunHosts.add(new URL(accessBase).host);
      } catch {
        /* ignore */
      }
    }
    if (host && aliyunHosts.has(host)) return "aliyun_oss";
  }
  return activeStorageBackend();
};

const defaultPublicUrlExpiresSeconds = (): number => {
  const value = Number(cliEnv().OCI_S3_URL_EXPIRES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES;
};

/** Sync SigV4 presigned GET against the OCI S3-compat endpoint (private bucket read path). */
export const signOciS3ReadUrl = (
  objectKey: string,
  expiresSeconds?: number,
  bucket?: string,
): string =>
  signOciS3ObjectReadUrl(objectKey, expiresSeconds ?? defaultPublicUrlExpiresSeconds(), {
    bucket,
  });

/**
 * If a presigned URL uses the public `OSS_PUBLIC_BASE_URL` host, replace it with the `OSS_ENDPOINT` virtual-host domain,
 * so agents/hosts inside the VPC can fetch it (production/test often set OSS_ENDPOINT to the internal address).
 * OSS V1 signatures do not sign the host, so the URL stays valid after changing only protocol/host.
 */
export const rewriteSignedUrlForServerAccess = (signedUrl: string): string => {
  try {
    const signed = new URL(signedUrl);
    const accessBase = ossVirtualHostedAccessBaseUrl();
    if (!accessBase) return signedUrl;

    const publicHost = new URL(coursewareAssetBaseUrl()).host;
    const access = new URL(accessBase);
    if (signed.host === publicHost && signed.host !== access.host) {
      signed.protocol = access.protocol;
      signed.host = access.host;
      return signed.toString();
    }
    return signedUrl;
  } catch {
    return signedUrl;
  }
};

export type OssPresignNetwork = "public" | "internal";

/**
 * `oss-<region>.aliyuncs.com` → `oss-<region>-internal.aliyuncs.com`. No-op for
 * already-internal hosts or custom (non-aliyuncs.com) domains, where the
 * region-based intranet host cannot be derived generically.
 */
const toInternalOssEndpointHost = (host: string): string => {
  if (host.includes("-internal.aliyuncs.com")) return host;
  if (!host.endsWith(".aliyuncs.com")) return host;
  return host.replace(/\.aliyuncs\.com$/, "-internal.aliyuncs.com");
};

/**
 * Force a signed OSS URL onto the region's intranet host, regardless of the
 * process-wide `OSS_ENDPOINT`. Only reachable from Aliyun ECS/FC in the same
 * region as the bucket — this must only be requested by callers that are
 * certain to run there (e.g. the FC-hosted headless courseware renderer),
 * never forwarded to a real end-user browser. OSS V1 signatures
 * (`signatureUrl`) do not cover the host, so swapping it post-signing keeps
 * the signature valid.
 */
export const rewriteSignedUrlToInternalOssHost = (signedUrl: string): string => {
  try {
    const url = new URL(signedUrl);
    url.host = toInternalOssEndpointHost(url.host);
    return url.toString();
  } catch {
    return signedUrl;
  }
};

const assertOssEnv = (): void => {
  const missing = ["OSS_BUCKET", "ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET"].filter(
    (name) => !cliEnv()[name],
  );
  if (!cliEnv().OSS_REGION && !cliEnv().OSS_ENDPOINT) {
    missing.push("OSS_REGION or OSS_ENDPOINT");
  }
  if (missing.length > 0) {
    throw new AinobiCliError("USAGE", `OSS is not configured: missing ${missing.join(", ")}.`);
  }
};

/** OSS SDK reads OSS_PROXY only; fall back to HTTP(S)_PROXY like MiniMax TTS (sandbox egress injects those). */
export const resolveOssProxyUrl = (): string | undefined => {
  const candidates = [
    cliEnv().OSS_PROXY,
    cliEnv().OSS_PROXY_URL,
    cliEnv().HTTPS_PROXY,
    cliEnv().https_proxy,
    cliEnv().HTTP_PROXY,
    cliEnv().http_proxy,
  ];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
};

const ossProxy = (): string | undefined => resolveOssProxyUrl();

const isOpaqueOssNetworkError = (error: unknown): boolean => {
  const err = error as { name?: string; message?: string; status?: unknown };
  return err.name === "UnknownError" && err.status === undefined && /status:\s*undefined/i.test(err.message ?? "");
};

const ossUploadMaxRetries = (): number => Math.max(0, numberEnv("OSS_UPLOAD_MAX_RETRIES", 5));

const ossRetryDelayMs = (attempt: number): number => {
  const base = numberEnv("OSS_UPLOAD_RETRY_BASE_MS", 500);
  const cap = numberEnv("OSS_UPLOAD_RETRY_MAX_MS", 8000);
  const exp = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.25));
  return exp + jitter;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableOssNetworkError = (error: unknown): boolean => {
  if (isOpaqueOssNetworkError(error)) return true;
  const err = error as { code?: string; message?: string; status?: unknown; statusCode?: unknown };
  if (err.status === -1 || err.statusCode === -1) return true;
  const message = String(err.message ?? error ?? "").toLowerCase();
  const retryablePatterns = [
    "socket disconnected",
    "tls connection",
    "network socket",
    "socket hang up",
    "econnreset",
    "etimedout",
    "econnrefused",
    "enotfound",
    "eai_again",
    "connect timeout",
    "request timeout",
    "aborted",
  ];
  if (retryablePatterns.some((pattern) => message.includes(pattern))) return true;
  const code = String(err.code ?? "").toUpperCase();
  return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_CONNECT_TIMEOUT"].includes(
    code,
  );
};

const describeOssNetworkContext = (): string => {
  const proxy = ossProxy();
  return proxy
    ? `OSS request failed before receiving a response. Check OSS_PROXY/OSS_PROXY_URL (${proxy}) and OSS endpoint connectivity.`
    : "OSS request failed before receiving a response. Check OSS endpoint connectivity, DNS, and whether OSS_PROXY/OSS_PROXY_URL is required.";
};

const wrapOssError = (error: unknown): never => {
  if (error instanceof AinobiCliError) throw error;
  if (isOpaqueOssNetworkError(error)) {
    throw new AinobiCliError("INTERNAL", describeOssNetworkContext(), {
      hint: "Set OSS_PROXY=http://host:port if OSS must be reached through an HTTP/HTTPS/SOCKS proxy.",
    });
  }
  throw error;
};

let client: OssClient | null = null;

const resetOssClient = (): void => {
  client = null;
  resetOciS3Client();
};

const withOssRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
  const maxRetries = ossUploadMaxRetries();
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof AinobiCliError) throw error;
      if (attempt >= maxRetries || !isRetryableOssNetworkError(error)) break;
      resetOssClient();
      await sleep(ossRetryDelayMs(attempt));
    }
  }
  return wrapOssError(lastError);
};

const getClient = async (): Promise<OssClient> => {
  if (!client) {
    assertOssEnv();
    const { default: OSS } = await import("ali-oss") as { default: OssConstructor };
    const proxy = ossProxy();
    const env = cliEnv();
    client = new OSS({
      region: env.OSS_REGION || undefined,
      endpoint: env.OSS_ENDPOINT ? normalizeEndpoint(env.OSS_ENDPOINT) : undefined,
      bucket: cliEnv().OSS_BUCKET,
      accessKeyId: cliEnv().ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: cliEnv().ALIYUN_ACCESS_KEY_SECRET,
      secure: boolEnv("OSS_SECURE", true),
      timeout: cliEnv().OSS_TIMEOUT || "300s",
      enableProxy: proxy !== undefined,
      proxy,
    });
  }
  return client;
};

const multipartThresholdBytes = (): number =>
  Math.max(100 * 1024, numberEnv("OSS_MULTIPART_THRESHOLD_MB", 1) * 1024 * 1024);

const multipartPartSizeBytes = (): number =>
  Math.max(100 * 1024, numberEnv("OSS_MULTIPART_PART_SIZE_MB", 1) * 1024 * 1024);

const multipartParallel = (): number => Math.max(1, numberEnv("OSS_MULTIPART_PARALLEL", 3));

export const objectExists = async (objectKey: string): Promise<boolean> => {
  if (useOciS3()) {
    try {
      return await withOssRetry(() => ociS3ObjectExists(objectKey));
    } catch (error) {
      return wrapOssError(error);
    }
  }
  try {
    await withOssRetry(async () => {
      await (await getClient()).head(objectKey);
    });
    return true;
  } catch (error) {
    const err = error as { status?: number; statusCode?: number; code?: string };
    if (err.status === 404 || err.statusCode === 404 || err.code === "NoSuchKey") return false;
    return wrapOssError(error);
  }
};

export const uploadBufferAsset = async (
  content: Buffer,
  extension: string,
  fileName = "",
): Promise<UploadedAsset> => {
  const normalized = normalizeAssetExtension(extension);
  const fileId = md5(content);
  const objectKey = assetObjectKey(fileId, normalized);
  const existed = await objectExists(objectKey);
  const contentType = CONTENT_TYPES[normalized] ?? "application/octet-stream";

  if (!existed) {
    await withOssRetry(async () => {
      if (useOciS3()) {
        // S3 PutObject accepts large bodies directly; OSS multipart chunking
        // is an ali-oss transport detail, not a storage requirement.
        await putOciS3ObjectBuffer(objectKey, content, contentType);
        return;
      }
      const options = {
        headers: { "Content-Type": contentType },
        mime: contentType,
      };
      const oss = await getClient();
      if (content.length >= multipartThresholdBytes()) {
        await oss.multipartUpload(objectKey, content, {
          ...options,
          parallel: multipartParallel(),
          partSize: multipartPartSizeBytes(),
        });
      } else {
        await oss.put(objectKey, content, options);
      }
    });
  }

  return {
    file_id: fileId,
    file_name: fileName,
    extension: normalized,
    bytes: content.length,
    content_type: contentType,
    object_key: objectKey,
    object_path: objectPath(objectKey),
    url: publicUrlForObjectKey(objectKey, normalized),
    existed,
  };
};

/**
 * Upload a file already on disk to OSS with the same rules as {@link uploadBufferAsset} (ali-oss streams the path instead of reading the whole file into memory).
 * `md5Hex32` must match the file content (usually the digest computed while streaming it to disk).
 */
export const uploadLocalFileAsset = async (
  absoluteFilePath: string,
  md5Hex32: string,
  extension: string,
  fileName = "",
): Promise<UploadedAsset> => {
  const normalized = normalizeAssetExtension(extension);
  const fileId = md5Hex32.trim().toLowerCase();
  if (fileId.length !== 32 || !/^[0-9a-f]{32}$/.test(fileId)) {
    throw new AinobiCliError("INTERNAL", "Invalid MD5 digest for asset upload.");
  }
  const { size } = await stat(absoluteFilePath);
  const objectKey = assetObjectKey(fileId, normalized);
  const existed = await objectExists(objectKey);
  const contentType = CONTENT_TYPES[normalized] ?? "application/octet-stream";

  if (!existed) {
    await withOssRetry(async () => {
      if (useOciS3()) {
        await putOciS3ObjectFromFile(objectKey, absoluteFilePath, contentType);
        return;
      }
      const options = {
        headers: { "Content-Type": contentType },
        mime: contentType,
      };
      const oss = await getClient();
      if (size >= multipartThresholdBytes()) {
        await oss.multipartUpload(objectKey, absoluteFilePath, {
          ...options,
          parallel: multipartParallel(),
          partSize: multipartPartSizeBytes(),
        });
      } else {
        await oss.put(objectKey, absoluteFilePath, options);
      }
    });
  }

  return {
    file_id: fileId,
    file_name: fileName,
    extension: normalized,
    bytes: size,
    content_type: contentType,
    object_key: objectKey,
    object_path: objectPath(objectKey),
    url: publicUrlForObjectKey(objectKey, normalized),
    existed,
  };
};

export const stagingChunkUploadObjectKey = (uploadId: string, extension: string): string => {
  const normalized = normalizeAssetExtension(extension);
  return `temp/chunk-upload/${uploadId}${normalized}`;
};

const normalizeOssEtag = (raw: string | undefined): string => {
  const etag = raw?.trim() ?? "";
  if (!etag) throw new AinobiCliError("INTERNAL", "OSS uploadPart returned empty ETag.");
  return etag.replace(/^"|"$/g, "");
};

export const initOssMultipartUpload = async (
  objectKey: string,
  contentType: string,
): Promise<{ uploadId: string }> => {
  const result = await withOssRetry(async () => {
    if (useOciS3()) {
      return beginOciS3MultipartUpload(objectKey, contentType);
    }
    const oss = await getClient();
    return oss.initMultipartUpload(objectKey, {
      headers: { "Content-Type": contentType },
      mime: contentType,
    });
  });
  const uploadId = result.uploadId?.trim();
  if (!uploadId) {
    throw new AinobiCliError("INTERNAL", "OSS initMultipartUpload returned empty uploadId.");
  }
  return { uploadId };
};

export const uploadOssMultipartPartBuffer = async (args: {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  chunk: Buffer;
  contentType: string;
}): Promise<OssMultipartPartRecord> => {
  const result = await withOssRetry<{ etag?: string; res?: { headers?: Record<string, string> } }>(
    async () => {
      if (useOciS3()) {
        return uploadOciS3MultipartPart({
          objectKey: args.objectKey,
          uploadId: args.uploadId,
          partNumber: args.partNumber,
          chunk: args.chunk,
        });
      }
      const oss = await getClient();
      return oss.uploadPart(
        args.objectKey,
        args.uploadId,
        args.partNumber,
        args.chunk,
        0,
        args.chunk.length,
        {
          headers: { "Content-Type": args.contentType },
          mime: args.contentType,
        },
      );
    },
  );
  const etag =
    normalizeOssEtag(result.etag) ||
    normalizeOssEtag(result.res?.headers?.etag) ||
    normalizeOssEtag(result.res?.headers?.ETag);
  return { partNumber: args.partNumber, etag };
};

export const completeOssMultipartUploadParts = async (args: {
  objectKey: string;
  uploadId: string;
  parts: OssMultipartPartRecord[];
  contentType: string;
}): Promise<void> => {
  const sorted = [...args.parts].sort((a, b) => a.partNumber - b.partNumber);
  await withOssRetry(async () => {
    if (useOciS3()) {
      return completeOciS3MultipartUpload({
        objectKey: args.objectKey,
        uploadId: args.uploadId,
        parts: sorted,
      });
    }
    const oss = await getClient();
    await oss.completeMultipartUpload(
      args.objectKey,
      args.uploadId,
      sorted.map((p) => ({ number: p.partNumber, etag: p.etag })),
      {
        headers: { "Content-Type": args.contentType },
        mime: args.contentType,
      },
    );
  });
};

export const abortOssMultipartUploadSession = async (
  objectKey: string,
  uploadId: string,
): Promise<void> => {
  await withOssRetry(async () => {
    if (useOciS3()) {
      return abortOciS3MultipartUpload(objectKey, uploadId);
    }
    const oss = await getClient();
    await oss.abortMultipartUpload(objectKey, uploadId);
  }).catch(() => {});
};

export const putOssObjectBuffer = async (
  objectKey: string,
  chunk: Buffer,
  contentType: string,
): Promise<void> => {
  await withOssRetry(async () => {
    if (useOciS3()) {
      await putOciS3ObjectBuffer(objectKey, chunk, contentType);
      return;
    }
    const oss = await getClient();
    await oss.put(objectKey, chunk, {
      headers: { "Content-Type": contentType },
      mime: contentType,
    });
  });
};

/** ali-oss `copy(destKey, sourceKey)`: copy source to dest (within an aliyun bucket only). */
export const copyOssObject = async (destKey: string, sourceKey: string): Promise<void> => {
  await withOssRetry(async () => {
    const oss = await getClient();
    await oss.copy(destKey, sourceKey);
  });
};

/**
 * Backend-aware copy used by clone/promote flows. Under `oci_s3` the copy
 * first tries a server-side copy inside the OCI bucket; when the source only
 * exists in the legacy aliyun bucket (grayscale transition), it copies
 * aliyun→aliyun and reports `"aliyun_oss"` so the caller can persist a URL
 * that matches where the bytes actually live.
 */
export const copyStoredObject = async (
  destKey: string,
  sourceKey: string,
): Promise<CoursewareStorageBackend> => {
  if (useOciS3()) {
    // `copyOciS3Object` returns false when the source is missing in OCI.
    const copiedInOci = await withOssRetry(() => copyOciS3Object(sourceKey, destKey));
    if (copiedInOci) return "oci_s3";
    await copyOssObject(destKey, sourceKey);
    return "aliyun_oss";
  }
  await copyOssObject(destKey, sourceKey);
  return "aliyun_oss";
};

/**
 * Best-effort delete of an object across backends. Under `oci_s3` a key may
 * legitimately live in either bucket (grayscale), so both are attempted; the
 * legacy-only delete is tolerated to fail silently.
 */
export const deleteOssObject = async (objectKey: string): Promise<void> => {
  if (useOciS3()) {
    await withOssRetry(async () => {
      await deleteOciS3Object(objectKey);
    }).catch(() => {});
    await withOssRetry(async () => {
      const oss = await getClient();
      await oss.delete(objectKey);
    }).catch(() => {});
    return;
  }
  await withOssRetry(async () => {
    const oss = await getClient();
    await oss.delete(objectKey);
  }).catch(() => {});
};

export const buildUploadedAssetFromObjectKey = (
  fileId: string,
  extension: string,
  fileName: string,
  fileSize: number,
  contentType: string,
  existed: boolean,
  options?: { backend?: CoursewareStorageBackend },
): UploadedAsset => {
  const normalized = normalizeAssetExtension(extension);
  const objectKey = assetObjectKey(fileId, normalized);
  return {
    file_id: fileId,
    file_name: fileName,
    extension: normalized,
    bytes: fileSize,
    content_type: contentType,
    object_key: objectKey,
    object_path: objectPath(objectKey),
    url: publicUrlForObjectKey(objectKey, normalized, options),
    existed,
  };
};

/** OSS object key of quiz answer recordings (kept apart from the `courseware_assets` / `raw/*` asset library). */
export const quizAnswerRecordingObjectKey = (
  orgId: string,
  recordingId: string,
  extension: string,
): string => {
  const normalized = normalizeQuizAnswerRecordingExtension(extension);
  const safeOrg = orgId.trim().toLowerCase();
  const safeRecording = recordingId.trim().toLowerCase();
  return `quiz_answer_recordings/${safeOrg}/${safeRecording}${normalized}`;
};

export const promoteStagingToQuizAnswerRecording = async (args: {
  stagingKey: string;
  orgId: string;
  recordingId: string;
  extension: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}): Promise<{ object_key: string; url: string; content_type: string }> => {
  const normalized = normalizeQuizAnswerRecordingExtension(args.extension);
  const finalKey = quizAnswerRecordingObjectKey(args.orgId, args.recordingId, normalized);
  let backend: CoursewareStorageBackend | null = null;
  const finalExisted = await objectExists(finalKey);
  if (!finalExisted) {
    const stagingExists = await objectExists(args.stagingKey);
    if (!stagingExists) {
      throw new AinobiCliError(
        "USAGE",
        "Staging object missing (upload session may have expired). Please re-upload the file.",
      );
    }
    backend = await copyStoredObject(finalKey, args.stagingKey);
  }
  await deleteOssObject(args.stagingKey);
  return {
    object_key: finalKey,
    url: publicUrlForObjectKey(finalKey, normalized, {
      backend: backend ?? activeStorageBackend(),
    }),
    content_type: args.contentType,
  };
};

export const promoteStagingObjectToAsset = async (args: {
  stagingKey: string;
  contentMd5: string;
  extension: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}): Promise<UploadedAsset> => {
  const fileId = args.contentMd5.trim().toLowerCase();
  const normalized = normalizeAssetExtension(args.extension);
  const finalKey = assetObjectKey(fileId, normalized);
  let backend: CoursewareStorageBackend | null = null;
  const finalExisted = await objectExists(finalKey);
  if (!finalExisted) {
    const stagingExists = await objectExists(args.stagingKey);
    if (!stagingExists) {
      throw new AinobiCliError(
        "USAGE",
        "Staging object missing (upload session may have expired). Please re-upload the file.",
      );
    }
    backend = await copyStoredObject(finalKey, args.stagingKey);
  }
  await deleteOssObject(args.stagingKey);
  return buildUploadedAssetFromObjectKey(
    fileId,
    normalized,
    args.fileName,
    args.fileSize,
    args.contentType,
    finalExisted,
    { backend: backend ?? activeStorageBackend() },
  );
};

export const uploadFileAsset = async (filePath: string): Promise<UploadedAsset> => {
  if (isAssetHostFlush()) {
    const { uploadFileAssetViaHost } = await import("./courseware-asset-upload-via-host.ts");
    return uploadFileAssetViaHost(filePath);
  }
  const content = await readFile(filePath);
  return uploadBufferAsset(content, normalizeAssetExtension(filePath), basename(filePath));
};

/** Resolve a courseware library asset by `file_id` (host DB + signed read URL in agent runtime). */
export const getFileAsset = async (fileId: string): Promise<UploadedAsset> => {
  if (isAssetHostFlush()) {
    const { getFileAssetViaHost } = await import("./courseware-asset-upload-via-host.ts");
    return getFileAssetViaHost(fileId);
  }
  throw new AinobiCliError(
    "USAGE",
    "`ainobi asset get` requires the AINOBI agent host (`AINOBI_CLI_RUNTIME=agent`).",
    {
      hint:
        "Use this command when the editor @-mentions a library file (`file_id` in editor context). " +
        "For local files not yet uploaded, use `ainobi asset upload` instead.",
    },
  );
};

const clampPresignExpires = (seconds: number): number => {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 1800;
  return Math.min(Math.max(s, 60), 60 * 60 * 24 * 7);
};

/**
 * Generate a temporary GET URL for an OSS object (ali-oss `signatureUrl`).
 * `objectKey` is the storage object key (same as `file_path` in the DB), without a leading `/`.
 * `options.network === "internal"`: additionally swaps the host for the region's internal domain (reachable only from
 * Aliyun ECS/FC in the same region; the caller must be sure it runs there and must never forward such a URL to
 * a real end user's browser).
 */
export const signObjectReadUrl = async (
  objectKey: string,
  expiresSeconds: number,
  options?: {
    network?: OssPresignNetwork;
    backend?: CoursewareStorageBackend;
    bucket?: string;
  },
): Promise<string> => {
  const raw = objectKey.trim().replace(/^\/+/, "");
  if (!raw) {
    throw new AinobiCliError("USAGE", "Missing object key for signed URL.");
  }
  if ((options?.backend ?? activeStorageBackend()) === "oci_s3") {
    // SigV4 signatures are host-bound: presign against the OCI S3-compat
    // endpoint and never rewrite the host (unlike OSS V1). The bucket can be
    // overridden to match the bucket the INPUT URL itself points at
    // (narration mp3s → public bucket, courseware assets → private bucket).
    return signOciS3ReadUrl(raw, expiresSeconds, options?.bucket);
  }
  try {
    const client = await getClient();
    const exp = clampPresignExpires(expiresSeconds);
    const signed = client.signatureUrl(raw, { expires: exp, method: "GET" });
    const serverAccessUrl = rewriteSignedUrlForServerAccess(signed);
    if (options?.network === "internal") {
      return rewriteSignedUrlToInternalOssHost(serverAccessUrl);
    }
    // html/artifact keys render via the configured custom domain (no OSS
    // forced attachment); internal URLs above must stay server-side.
    return withHtmlCdnHost(serverAccessUrl, raw);
  } catch (error) {
    return wrapOssError(error);
  }
};

/**
 * Read a small text object from OSS via the SDK (`OSS_ENDPOINT`, typically VPC internal).
 * Prefer this over signed-URL fetch on the courseware host.
 */
export const readObjectBytes = async (
  objectKey: string,
  maxBytes = 2 * 1024 * 1024,
  options?: { backend?: CoursewareStorageBackend },
): Promise<Buffer> => {
  const raw = objectKey.trim().replace(/^\/+/, "");
  if (!raw) {
    throw new AinobiCliError("USAGE", "Missing object key for OSS read.");
  }
  return withOssRetry(async () => {
    if ((options?.backend ?? activeStorageBackend()) === "oci_s3") {
      return getOciS3ObjectBytes(raw, maxBytes);
    }
    const oss = await getClient();
    const result = await oss.get(raw);
    const content = result.content;
    let bytes: Uint8Array;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(content)) {
      bytes = content;
    } else if (content instanceof Uint8Array) {
      bytes = content;
    } else {
      const text = String(content ?? "");
      const encoded = new TextEncoder().encode(text);
      if (encoded.byteLength > maxBytes) {
        throw new AinobiCliError("USAGE", `Object too large (${encoded.byteLength} bytes, max ${maxBytes}).`);
      }
      return Buffer.from(encoded);
    }
    if (bytes.byteLength > maxBytes) {
      throw new AinobiCliError("USAGE", `Object too large (${bytes.byteLength} bytes, max ${maxBytes}).`);
    }
    return Buffer.from(bytes);
  });
};

export const readObjectText = async (
  objectKey: string,
  maxBytes = 2 * 1024 * 1024,
  options?: { backend?: CoursewareStorageBackend },
): Promise<string> => {
  const bytes = await readObjectBytes(objectKey, maxBytes, options);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
};

/** PDF/PPTX conversion happens in the AINOBI host's `/courseware/assets/upload`; the sandbox/CLI must not call pdf2html/pptx2html directly. */
export const convertDocumentAsset = async (filePath: string): Promise<ConvertedDocumentAsset> => {
  const uploadUrl = cliEnv().AINOBI_COURSEWARE_ASSET_UPLOAD_URL?.trim();
  if (!isAssetHostFlush() && !uploadUrl) {
    throw new AinobiCliError(
      "USAGE",
      "PDF/PPTX conversion runs on the AINOBI courseware host, not in the CLI process.",
      {
        hint:
          "Use the agent chat (host upload + convert), or set AINOBI_COURSEWARE_ASSET_UPLOAD_URL to the host upload endpoint.",
      },
    );
  }
  const { convertDocumentAssetViaHost } = await import("./courseware-asset-upload-via-host.ts");
  return convertDocumentAssetViaHost(filePath);
};
