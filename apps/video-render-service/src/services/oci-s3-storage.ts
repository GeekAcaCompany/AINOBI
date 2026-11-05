// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OCI Object Storage (S3-compatible) client for the video-render write path.
 *
 * Style-aligned with courseware-agent `cli/oci-s3-storage.ts` (the validated
 * OCI shape): path-style (bucket-in-path) addressing and SigV4 query-presigned
 * GETs signed over the `host` header only with `UNSIGNED-PAYLOAD` — the exact
 * form boto3 generates and OCI's S3 compat layer accepts.
 *
 * Dispatch: `STORAGE_BACKEND=oci_s3` selects OCI; every other value keeps the
 * legacy ali-oss path (src/services/oss-upload.ts) untouched.
 *
 * The `@aws-sdk/client-s3` import stays dynamic so the default (aliyun_oss)
 * path never loads the SDK.
 *
 * Endpoint/bucket facts (prod):
 * - endpoint: https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com
 * - bucket:   example-storage (private, NoPublicAccess) — render artifacts keep
 *   their aliyun key structure (`renders/<jobId>/...`) but land in this bucket.
 *
 * Because the bucket is private there is no anonymous object URL. URLs returned
 * for render outputs are therefore SigV4 presigned GETs (default 7 days =
 * 604800s, the SigV4 maximum; `OCI_S3_URL_EXPIRES` overrides). Presigned URLs
 * are host-bound, so they must be fetched on the exact host they were signed
 * for (no OSS-style host rewriting, and no *-internal* variant exists).
 */
import { buildS3PresignedGetUrl } from "@ainobi/storage-impl/signing.ts";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";

export type VideoRenderStorageBackend = "aliyun_oss" | "oci_s3";

export const OCI_S3_STORAGE_BACKEND_ENV = "STORAGE_BACKEND";
/** 604800s = SigV4 maximum (7 days). */
export const OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES = 60 * 60 * 24 * 7;

/** `STORAGE_BACKEND=oci_s3` selects OCI; every other value keeps aliyun_oss. */
export function resolveOciS3StorageBackend(
  env: Record<string, string | undefined> = process.env,
): VideoRenderStorageBackend {
  return String(env[OCI_S3_STORAGE_BACKEND_ENV] ?? "")
    .trim()
    .toLowerCase() === "oci_s3"
    ? "oci_s3"
    : "aliyun_oss";
}

export function isOciS3StorageEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveOciS3StorageBackend(env) === "oci_s3";
}

const normalizeHost = (value: string): string =>
  value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

export interface OciS3EndpointInfo {
  endpoint: string;
  host: string;
  /** A local store on a plain http:// address (`pnpm lite`); absent everywhere else. */
  plainHttp?: true;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretKey: string;
  /** Tenancy namespace, derived from the compat endpoint host when not set. */
  namespace: string;
}

export function readOciS3Env(
  env: Record<string, string | undefined> = process.env,
): OciS3EndpointInfo | null {
  const endpoint = env.OCI_S3_ENDPOINT?.trim();
  const bucket = env.OCI_S3_BUCKET?.trim();
  const accessKeyId = env.OCI_S3_ACCESS_KEY_ID?.trim();
  const secretKey = env.OCI_S3_SECRET_KEY?.trim();
  const region = env.OCI_S3_REGION?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretKey || !region) {
    return null;
  }
  const host = normalizeHost(endpoint);
  const namespace = env.OCI_S3_NAMESPACE?.trim() || host.split(".")[0] || "";
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    host,
    bucket,
    region,
    accessKeyId,
    secretKey,
    namespace,
    ...(env.AINOBI_STORAGE_LOCAL_ENDPOINT?.trim().toLowerCase() === "true" && /^http:\/\//i.test(endpoint) ? { plainHttp: true as const } : {}),
  };
}

export function assertOciS3Env(
  env: Record<string, string | undefined> = process.env,
): OciS3EndpointInfo {
  const config = readOciS3Env(env);
  if (!config) {
    const missing = [
      "OCI_S3_ENDPOINT",
      "OCI_S3_BUCKET",
      "OCI_S3_ACCESS_KEY_ID",
      "OCI_S3_SECRET_KEY",
      "OCI_S3_REGION",
    ].filter((name) => !env[name]?.trim());
    throw new Error(`OCI S3 storage is not configured: missing ${missing.join(", ")}.`);
  }
  return config;
}

/**
 * Stable (never-expiring) native-form object URL:
 * `https://objectstorage.<region>.oraclecloud.com/n/<namespace>/b/<bucket>/o/<key>`.
 *
 * NOT anonymously fetchable on a private bucket — reference/persistence shape
 * only; consumers of render outputs always receive fresh presigned GETs.
 */
export function ociS3NativeObjectBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const config = readOciS3Env(env);
  if (!config || !config.namespace) return null;
  return `https://objectstorage.${config.region}.oraclecloud.com/n/${config.namespace}/b/${config.bucket}/o`;
}

export function publicUrlForOciS3ObjectKey(
  objectKey: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const base = ociS3NativeObjectBaseUrl(env);
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!base || !key) return null;
  return `${base}/${key}`;
}

/** Hosts that can serve OCI-stored objects (native host + S3-compat endpoint). */
export function ociS3StorageUrlHosts(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const hosts = new Set<string>();
  const config = readOciS3Env(env);
  if (config) {
    hosts.add(config.host);
    if (config.namespace) {
      hosts.add(`objectstorage.${config.region}.oraclecloud.com`);
    }
  }
  return hosts;
}

/** Presigned GET expiry: `OCI_S3_URL_EXPIRES` override, else 7 days (SigV4 max). */
export function ociS3UrlExpiresSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const value = Number(env.OCI_S3_URL_EXPIRES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES;
}

// ---------------------------------------------------------------------------
// S3 client (dynamic import keeps the SDK out of the default aliyun path)
// ---------------------------------------------------------------------------

type S3Sendable = { send(command: unknown): Promise<unknown> };

let cachedClientKey = "";
let cachedClient: S3Sendable | null = null;

export function resetOciS3Client(): void {
  cachedClient = null;
  cachedClientKey = "";
}

async function getS3Client(): Promise<{ client: S3Sendable; config: OciS3EndpointInfo }> {
  const config = assertOciS3Env();
  const cacheKey = `${config.endpoint}|${config.region}|${config.accessKeyId}|${config.secretKey}`;
  if (cachedClient && cachedClientKey === cacheKey) {
    return { client: cachedClient, config };
  }
  const mod = (await import("@aws-sdk/client-s3")) as {
    S3Client: new (options: Record<string, unknown>) => S3Sendable;
  };
  cachedClient = new mod.S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretKey },
    // OCI S3 compat supports virtual-host addressing, but bucket-in-path is
    // the safest common denominator (same as courseware-agent).
    forcePathStyle: true,
    // OCI's S3 layer rejects `aws-chunked` transfer encoding ("NotImplemented:
    // AWS chunked encoding not supported"), which SDK v3 emits by default for
    // streamed bodies when it adds flexible checksums. Only checksum when the
    // request requires it (verified live against this endpoint).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  cachedClientKey = cacheKey;
  return { client: cachedClient, config };
}

const isNotFound = (error: unknown): boolean => {
  const err = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err?.$metadata?.httpStatusCode === 404 ||
    err?.name === "NotFound" ||
    err?.name === "NoSuchKey" ||
    err?.code === "NotFound" ||
    err?.code === "NoSuchKey"
  );
};

// ---------------------------------------------------------------------------
// Object operations
// ---------------------------------------------------------------------------

/** Streamed upload from disk (avoids buffering render MP4s in memory). */
export async function putOciS3ObjectFromFile(
  objectKey: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const key = objectKey.trim().replace(/^\/+/, "");
  const { client, config } = await getS3Client();
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  // S3 requires a known content length for stream bodies — stat the file
  // instead of letting the SDK buffer the whole MP4 into memory.
  const { size } = await stat(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
      ContentLength: size,
    }),
  );
}

export async function getOciS3ObjectToFile(objectKey: string, localPath: string): Promise<void> {
  const key = objectKey.trim().replace(/^\/+/, "");
  const { client, config } = await getS3Client();
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const response = (await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  )) as { Body?: NodeJS.ReadableStream };
  const body = response?.Body;
  if (!body) {
    throw new Error("Empty OCI S3 object body.");
  }
  await mkdir(dirname(localPath), { recursive: true });
  await pipeline(body, createWriteStream(localPath));
}

/** One page of `ListObjectsV2` (caller loops on `isTruncated`/`continuationToken`). */
export async function listOciS3ObjectPage(args: {
  prefix: string;
  maxKeys?: number;
  continuationToken?: string;
}): Promise<{ keys: string[]; isTruncated: boolean; continuationToken?: string }> {
  const { client, config } = await getS3Client();
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const result = (await client.send(
    new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: args.prefix,
      MaxKeys: args.maxKeys ?? 1000,
      ...(args.continuationToken ? { ContinuationToken: args.continuationToken } : {}),
    }),
  )) as {
    Contents?: Array<{ Key?: string }>;
    IsTruncated?: boolean;
    NextContinuationToken?: string;
  };
  return {
    keys: (result?.Contents ?? [])
      .map((entry) => entry.Key ?? "")
      .filter((key) => key && !key.endsWith("/")),
    isTruncated: result?.IsTruncated === true,
    continuationToken: result?.NextContinuationToken,
  };
}

export async function deleteOciS3Object(objectKey: string): Promise<void> {
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) return;
  const { client, config } = await getS3Client();
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/**
 * Delete many keys, one `DeleteObject` per key (sequential). Missing keys are
 * tolerated.
 *
 * Deliberately NOT S3 `DeleteObjects` batch: OCI's compat layer requires an
 * integrity header (`Content-MD5` / `x-amz-checksum-*`) on multi-delete that
 * SDK v3 does not attach under `requestChecksumCalculation=WHEN_REQUIRED` (the
 * mode we need to avoid `aws-chunked` on streamed PUTs), and prefix cleanups
 * here are small (plan dirs / chunk sets), so per-key deletes are fine.
 */
export async function deleteOciS3Objects(objectKeys: string[]): Promise<number> {
  const keys = objectKeys.map((key) => key.trim().replace(/^\/+/, "")).filter(Boolean);
  if (keys.length === 0) return 0;
  const { client, config } = await getS3Client();
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  let deleted = 0;
  for (const key of keys) {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    deleted += 1;
  }
  return deleted;
}

export { isNotFound };

// ---------------------------------------------------------------------------
// SigV4 presigning (sync, no SDK: @ainobi/storage-impl's canonical signer)
// ---------------------------------------------------------------------------

const clampPresignExpires = (seconds: number): number => {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES;
  return Math.min(Math.max(s, 60), OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES);
};

/**
 * SigV4 query-string presigned GET URL for one object (bucket-in-path).
 *
 * Signed headers are `host` only (the shape boto3 generates and the shape
 * already validated against this OCI endpoint by courseware-agent). Payload is
 * UNSIGNED-PAYLOAD. Signing is synchronous and deterministic for a given
 * (key, expiry, now) so it can be used from sync URL builders.
 */
export function signOciS3ObjectReadUrl(
  objectKey: string,
  expiresSeconds?: number,
  options?: { now?: Date; env?: Record<string, string | undefined> },
): string {
  const config = assertOciS3Env(options?.env);
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) {
    throw new Error("Missing object key for OCI S3 signed URL.");
  }
  return buildS3PresignedGetUrl({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretKey,
    region: config.region,
    endpointUrl: config.host,
    plainHttp: config.plainHttp,
    bucketName: config.bucket,
    objectKey: key,
    expiresInSeconds: clampPresignExpires(expiresSeconds ?? OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES),
    now: options?.now ?? new Date(),
  });
}
