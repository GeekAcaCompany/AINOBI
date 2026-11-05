// SPDX-License-Identifier: AGPL-3.0-only
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import { buildOssObjectUrl, resolveOssClientConfig, type OssClientConfig } from "../config/oss.ts";
import {
  deleteOciS3Object,
  deleteOciS3Objects,
  getOciS3ObjectToFile,
  isNotFound,
  isOciS3StorageEnabled,
  listOciS3ObjectPage,
  ociS3UrlExpiresSeconds,
  putOciS3ObjectFromFile,
  signOciS3ObjectReadUrl,
} from "./oci-s3-storage.ts";

export interface OssUploadResult {
  bucket: string;
  key: string;
  url: string;
  /** Local file size in bytes at upload time (for org storage accounting). */
  sizeBytes: number;
  etag?: string;
}

type AliOssClient = {
  putStream: (
    objectKey: string,
    stream: NodeJS.ReadableStream,
    options?: Record<string, unknown>,
  ) => Promise<{ etag?: string }>;
  put: (
    objectKey: string,
    localPath: string,
    options?: Record<string, unknown>,
  ) => Promise<{ etag?: string }>;
  get: (
    objectKey: string,
    localPath?: string,
  ) => Promise<{ content?: Buffer; res?: unknown }>;
  list: (query?: {
    prefix?: string;
    marker?: string;
    "max-keys"?: number;
  }) => Promise<{
    objects?: Array<{ name: string; size?: number }>;
    nextMarker?: string;
    isTruncated?: boolean;
  }>;
  delete: (objectKey: string) => Promise<unknown>;
  deleteMulti?: (
    objectKeys: string[],
    options?: { quiet?: boolean },
  ) => Promise<unknown>;
};

let cachedClient: { bucket: string; client: AliOssClient; internal: boolean } | undefined;
/**
 * Buckets where an intranet upload already failed with a network-class error
 * in this process. Once set, subsequent uploads for that bucket skip the
 * intranet attempt entirely instead of paying a full connect/DNS timeout on
 * every single render — the intranet route is very unlikely to start working
 * again mid-process once it has failed (misconfigured VPC/region, not a
 * transient blip), and FC instances are usually short-lived anyway.
 */
const internalUploadUnreachableBuckets = new Set<string>();

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

/**
 * Best-effort classification of "could not reach the host at all" vs. a real
 * OSS API error (bad credentials, bucket not found, quota, etc.) — the latter
 * would fail identically against the public endpoint, so retrying there would
 * just waste time. Errs toward treating ambiguous cases as network errors:
 * the fallback only fires once, so a false positive costs a single extra
 * request, while a false negative would surface a misleading error and skip
 * a real recovery path.
 */
export function isLikelyNetworkError(error: unknown): boolean {
  const err = error as { code?: unknown; name?: unknown; message?: unknown } | undefined;
  const code = typeof err?.code === "string" ? err.code : undefined;
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  if (err?.name === "RequestError") return true;
  const message = typeof err?.message === "string" ? err.message : "";
  return /getaddrinfo|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|network/i.test(message);
}

async function createOssClient(config: OssClientConfig): Promise<AliOssClient> {
  const OSS = (await import("ali-oss")).default as new (options: Record<string, unknown>) => AliOssClient;

  const options: Record<string, unknown> = {
    region: config.region,
    bucket: config.bucket,
    secure: config.secure,
    timeout: config.timeout,
  };

  if (config.endpoint) {
    options.endpoint = config.endpoint;
  } else if (config.internal) {
    // No explicit endpoint: let ali-oss build the region's intranet host
    // (oss-<region>-internal.aliyuncs.com). Free + faster from same-region FC.
    options.internal = true;
  }
  if (config.accessKeyId) {
    options.accessKeyId = config.accessKeyId;
  }
  if (config.accessKeySecret) {
    options.accessKeySecret = config.accessKeySecret;
  }
  if (config.stsToken) {
    options.stsToken = config.stsToken;
  }
  if (config.proxy) {
    options.proxy = config.proxy;
  }

  return new OSS(options);
}

async function getOssClient(bucket: string): Promise<{ config: OssClientConfig; client: AliOssClient }> {
  const config = resolveOssClientConfig(bucket);
  // Explicit endpoint bypasses the internal/public distinction entirely (operator's choice).
  if (config.internal && !config.endpoint && internalUploadUnreachableBuckets.has(bucket)) {
    config.internal = false;
  }

  if (cachedClient?.bucket === bucket && cachedClient.internal === config.internal) {
    return { config, client: cachedClient.client };
  }

  const client = await createOssClient(config);
  cachedClient = { bucket, client, internal: config.internal };
  return { config, client };
}

export function buildVideoRenderObjectKey(jobId: string, localPath: string): string {
  const filename = basename(localPath);
  return `renders/${jobId}/${filename}`;
}

export function buildVideoRenderCoverObjectKey(jobId: string): string {
  return `renders/${jobId}/cover.jpg`;
}

export function buildDistributedPlanOssPrefix(taskId: string): string {
  return `renders/${taskId}/plan`;
}

export function buildDistributedChunkObjectKey(taskId: string, chunkIndex: number): string {
  return `renders/${taskId}/chunks/${chunkIndex}.mp4`;
}

// ---------------------------------------------------------------------------
// OCI (STORAGE_BACKEND=oci_s3) dispatch
// ---------------------------------------------------------------------------

const OCI_CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain",
};

/** ali-oss guesses mime from the extension on `put(name, file)`; mirror that for S3 PutObject. */
function guessOciContentType(objectKey: string, fallback = "application/octet-stream"): string {
  const ext = objectKey.slice(objectKey.lastIndexOf(".")).toLowerCase();
  return OCI_CONTENT_TYPES[ext] ?? fallback;
}

/**
 * Browser/consumer-facing URL for an OCI-stored object: the bucket is private,
 * so this is a SigV4 presigned GET — default 7 days (the SigV4 maximum),
 * `OCI_S3_URL_EXPIRES` overrides. The object key stays recoverable from the
 * URL path (`/example-storage/renders/...`); never rewrite the host.
 */
export function ociUploadResultUrl(objectKey: string): string {
  return signOciS3ObjectReadUrl(objectKey, ociS3UrlExpiresSeconds());
}

type OciImpls = {
  putFromFile: typeof putOciS3ObjectFromFile;
  getToFile: typeof getOciS3ObjectToFile;
  listPage: typeof listOciS3ObjectPage;
  deleteObject: typeof deleteOciS3Object;
  deleteObjects: typeof deleteOciS3Objects;
};

const OCI_IMPL_DEFAULTS: OciImpls = {
  putFromFile: putOciS3ObjectFromFile,
  getToFile: getOciS3ObjectToFile,
  listPage: listOciS3ObjectPage,
  deleteObject: deleteOciS3Object,
  deleteObjects: deleteOciS3Objects,
};

let ociImpls: OciImpls = OCI_IMPL_DEFAULTS;

/** Test-only seam so backend-switch logic is covered without hitting the network. */
export function _setOciImplsForTests(overrides: Partial<OciImpls> | null): void {
  ociImpls = overrides ? { ...OCI_IMPL_DEFAULTS, ...overrides } : OCI_IMPL_DEFAULTS;
}

async function listLocalFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listLocalFilesRecursive(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function toPosixRelative(fromDir: string, filePath: string): string {
  return relative(fromDir, filePath).split(sep).join("/");
}

/**
 * Upload every file under `localDir` to `ossPrefix/...` (relative paths preserved).
 * Returns the number of objects written.
 */
export async function uploadDirectoryToOss(
  localDir: string,
  ossPrefix: string,
  bucket: string,
  onFileUploaded?: (uploaded: number, total: number) => void | Promise<void>,
): Promise<number> {
  const prefix = ossPrefix.replace(/^\/+|\/+$/g, "");
  const files = await listLocalFilesRecursive(localDir);
  if (files.length === 0) {
    return 0;
  }
  if (isOciS3StorageEnabled()) {
    // Same key layout, OCI bucket. Small plan files: one PutObject each.
    let uploadedOci = 0;
    for (const file of files) {
      const rel = toPosixRelative(localDir, file);
      await ociImpls.putFromFile(`${prefix}/${rel}`, file, guessOciContentType(rel));
      uploadedOci += 1;
      if (onFileUploaded) {
        await onFileUploaded(uploadedOci, files.length);
      }
    }
    return uploadedOci;
  }
  const { client } = await getOssClient(bucket);
  let uploaded = 0;
  for (const file of files) {
    const rel = toPosixRelative(localDir, file);
    const objectKey = `${prefix}/${rel}`;
    await client.put(objectKey, file);
    uploaded += 1;
    if (onFileUploaded) {
      await onFileUploaded(uploaded, files.length);
    }
  }
  return uploaded;
}

/**
 * Download every object under `ossPrefix/` into `localDir`, preserving relative paths.
 * Returns the number of files written.
 */
export async function downloadDirectoryFromOss(
  ossPrefix: string,
  localDir: string,
  bucket: string,
): Promise<number> {
  const prefix = ossPrefix.replace(/^\/+|\/+$/g, "");
  const listPrefix = `${prefix}/`;
  if (isOciS3StorageEnabled()) {
    await mkdir(localDir, { recursive: true });
    let downloadedOci = 0;
    let continuationToken: string | undefined;
    for (;;) {
      const page = await ociImpls.listPage({ prefix: listPrefix, maxKeys: 1000, continuationToken });
      for (const key of page.keys) {
        const rel = key.slice(listPrefix.length);
        if (!rel) {
          continue;
        }
        await ociImpls.getToFile(key, join(localDir, ...rel.split("/")));
        downloadedOci += 1;
      }
      if (!page.isTruncated || !page.continuationToken) {
        break;
      }
      continuationToken = page.continuationToken;
    }
    return downloadedOci;
  }
  const { client } = await getOssClient(bucket);
  await mkdir(localDir, { recursive: true });

  let marker: string | undefined;
  let downloaded = 0;
  for (;;) {
    const page = await client.list({
      prefix: listPrefix,
      marker,
      "max-keys": 1000,
    });
    for (const obj of page.objects ?? []) {
      if (!obj.name || obj.name.endsWith("/")) {
        continue;
      }
      const rel = obj.name.slice(listPrefix.length);
      if (!rel) {
        continue;
      }
      const localPath = join(localDir, ...rel.split("/"));
      await mkdir(dirname(localPath), { recursive: true });
      // ali-oss `get(name, filepath)` writes the object to disk.
      await client.get(obj.name, localPath);
      downloaded += 1;
    }
    if (!page.isTruncated) {
      break;
    }
    marker = page.nextMarker;
    if (!marker) {
      break;
    }
  }
  return downloaded;
}

/** Best-effort delete of every object under a prefix (planDir / chunks). */
export async function deleteOssPrefix(bucket: string, ossPrefix: string): Promise<number> {
  const prefix = ossPrefix.replace(/^\/+|\/+$/g, "");
  const listPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (isOciS3StorageEnabled()) {
    let deletedOci = 0;
    let continuationToken: string | undefined;
    for (;;) {
      const page = await ociImpls.listPage({ prefix: listPrefix, maxKeys: 1000, continuationToken });
      if (page.keys.length > 0) {
        deletedOci += await ociImpls.deleteObjects(page.keys);
      }
      if (!page.isTruncated || !page.continuationToken) {
        break;
      }
      continuationToken = page.continuationToken;
    }
    return deletedOci;
  }
  const { client } = await getOssClient(bucket);

  let marker: string | undefined;
  let deleted = 0;
  for (;;) {
    const page = await client.list({
      prefix: listPrefix,
      marker,
      "max-keys": 1000,
    });
    const keys = (page.objects ?? [])
      .map((o) => o.name)
      .filter((name): name is string => Boolean(name) && !name.endsWith("/"));
    if (keys.length > 0) {
      if (client.deleteMulti) {
        await client.deleteMulti(keys, { quiet: true });
        deleted += keys.length;
      } else {
        for (const key of keys) {
          await client.delete(key);
          deleted += 1;
        }
      }
    }
    if (!page.isTruncated) {
      break;
    }
    marker = page.nextMarker;
    if (!marker) {
      break;
    }
  }
  return deleted;
}

export async function downloadOssObjectToFile(
  bucket: string,
  objectKey: string,
  localPath: string,
): Promise<void> {
  if (isOciS3StorageEnabled()) {
    await ociImpls.getToFile(objectKey, localPath);
    return;
  }
  const { client } = await getOssClient(bucket);
  await mkdir(dirname(localPath), { recursive: true });
  await client.get(objectKey.replace(/^\/+/, ""), localPath);
}


async function putStreamOnce(
  client: AliOssClient,
  localPath: string,
  objectKey: string,
  mime: string,
): Promise<{ etag?: string }> {
  return client.putStream(objectKey, createReadStream(localPath), { mime });
}

/**
 * Uploads the rendered file to OSS. When the intranet endpoint is configured
 * (`internal: true`, no explicit `endpoint` override) and the upload fails
 * with what looks like a network-reachability error, transparently retries
 * once via the public endpoint rather than failing the whole render — losing
 * the traffic-cost/speed optimization for this (and, per-bucket, subsequent)
 * uploads is far preferable to losing the render output entirely.
 *
 * Any other error (bad credentials, bucket/object errors, disk I/O on
 * `localPath`, etc.) is NOT retried and fails fast — retrying those against a
 * different endpoint would not help and would only delay surfacing a real
 * misconfiguration.
 */
async function localFileSizeBytes(localPath: string): Promise<number> {
  const info = await stat(localPath);
  return info.size;
}

export async function uploadFileToOss(
  localPath: string,
  objectKey: string,
  bucket: string,
): Promise<OssUploadResult> {
  const sizeBytes = await localFileSizeBytes(localPath);
  if (isOciS3StorageEnabled()) {
    // Same key layout (renders/<jobId>/...), OCI bucket. PutObject streams the
    // file directly — no multipart and no intranet/public endpoint split (OCI
    // has a single endpoint; the ali-oss fallback machinery below is aliyun-only).
    await ociImpls.putFromFile(objectKey, localPath, "video/mp4");
    return {
      bucket,
      key: objectKey,
      url: ociUploadResultUrl(objectKey),
      sizeBytes,
    };
  }
  const { config, client } = await getOssClient(bucket);

  try {
    const result = await putStreamOnce(client, localPath, objectKey, "video/mp4");
    return {
      bucket,
      key: objectKey,
      url: buildOssObjectUrl(config, objectKey),
      sizeBytes,
      etag: result.etag,
    };
  } catch (error) {
    if (!config.internal || config.endpoint || !isLikelyNetworkError(error)) {
      throw error;
    }

    console.warn(
      `[oss-upload] intranet endpoint unreachable for bucket "${bucket}" ` +
        `(${error instanceof Error ? error.message : String(error)}); retrying via public endpoint.`,
    );
    internalUploadUnreachableBuckets.add(bucket);

    const fallbackConfig: OssClientConfig = { ...config, internal: false };
    const fallbackClient = await createOssClient(fallbackConfig);
    cachedClient = { bucket, client: fallbackClient, internal: false };

    const result = await putStreamOnce(fallbackClient, localPath, objectKey, "video/mp4");
    return {
      bucket,
      key: objectKey,
      url: buildOssObjectUrl(fallbackConfig, objectKey),
      sizeBytes,
      etag: result.etag,
    };
  }
}

export async function uploadImageToOss(
  localPath: string,
  objectKey: string,
  bucket: string,
  mime = "image/jpeg",
): Promise<OssUploadResult> {
  const sizeBytes = await localFileSizeBytes(localPath);
  if (isOciS3StorageEnabled()) {
    await ociImpls.putFromFile(objectKey, localPath, mime);
    return {
      bucket,
      key: objectKey,
      url: ociUploadResultUrl(objectKey),
      sizeBytes,
    };
  }
  const { config, client } = await getOssClient(bucket);

  try {
    const result = await putStreamOnce(client, localPath, objectKey, mime);
    return {
      bucket,
      key: objectKey,
      url: buildOssObjectUrl(config, objectKey),
      sizeBytes,
      etag: result.etag,
    };
  } catch (error) {
    if (!config.internal || config.endpoint || !isLikelyNetworkError(error)) {
      throw error;
    }

    console.warn(
      `[oss-upload] intranet endpoint unreachable for bucket "${bucket}" ` +
        `(${error instanceof Error ? error.message : String(error)}); retrying cover via public endpoint.`,
    );
    internalUploadUnreachableBuckets.add(bucket);

    const fallbackConfig: OssClientConfig = { ...config, internal: false };
    const fallbackClient = await createOssClient(fallbackConfig);
    cachedClient = { bucket, client: fallbackClient, internal: false };

    const result = await putStreamOnce(fallbackClient, localPath, objectKey, mime);
    return {
      bucket,
      key: objectKey,
      url: buildOssObjectUrl(fallbackConfig, objectKey),
      sizeBytes,
      etag: result.etag,
    };
  }
}

/** Best-effort OSS object removal (missing keys are ignored). */
export async function deleteOssObject(bucket: string, objectKey: string): Promise<void> {
  if (isOciS3StorageEnabled()) {
    try {
      await ociImpls.deleteObject(objectKey);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    return;
  }
  const { client } = await getOssClient(bucket);
  try {
    await client.delete(objectKey.replace(/^\/+/, ""));
  } catch (error) {
    const err = error as { code?: string; status?: number };
    if (err?.code === "NoSuchKey" || err?.status === 404) {
      return;
    }
    throw error;
  }
}
