// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OCI Object Storage (S3-compatible) client for the courseware write path.
 *
 * Style-aligned with `src/services/aws-s3-presign.ts` (host side), but lives in
 * the CLI package because `cli/assets.ts` — the single storage gateway shared by
 * the host services and the CLI — dispatches to it when
 * `STORAGE_BACKEND=oci_s3` (default `aliyun_oss` keeps the legacy ali-oss path).
 *
 * The `@aws-sdk/client-s3` import is dynamic so the default (aliyun_oss) path
 * never loads the SDK, and the standalone CLI keeps working without it.
 *
 * Endpoint/bucket facts (prod):
 * - endpoint: https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com
 * - bucket:   example-storage (private, NoPublicAccess)
 *
 * Because the bucket is private there is no anonymous object URL. "Public"
 * object URLs are therefore SigV4 presigned GETs (default 7 days = 604800s,
 * the SigV4 maximum). Presigned URLs are host-bound, so they must be fetched
 * on the exact host they were signed for (no OSS-style host rewriting).
 */
import { buildS3PresignedGetUrl, buildS3PresignedPostUrl } from "@ainobi/storage-impl/signing.ts";
import { cliEnv } from "./env.ts";

export type CoursewareStorageBackend = "aliyun_oss" | "oci_s3";

export const OCI_S3_STORAGE_BACKEND_ENV = "STORAGE_BACKEND";
export const OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES = 60 * 60 * 24 * 7; // 604800s = SigV4 max (7 days)

/** `STORAGE_BACKEND=oci_s3` selects OCI; every other value keeps aliyun_oss. */
export function resolveOciS3StorageBackend(
  env: Record<string, string | undefined> = cliEnv(),
): CoursewareStorageBackend {
  return String(env[OCI_S3_STORAGE_BACKEND_ENV] ?? "")
    .trim()
    .toLowerCase() === "oci_s3"
    ? "oci_s3"
    : "aliyun_oss";
}

export function isOciS3StorageEnabled(
  env: Record<string, string | undefined> = cliEnv(),
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
  env: Record<string, string | undefined> = cliEnv(),
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
  const namespace =
    env.OCI_S3_NAMESPACE?.trim() || host.split(".")[0] || "";
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

export function assertOciS3Env(env: Record<string, string | undefined> = cliEnv()): OciS3EndpointInfo {
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
 * NOT anonymously fetchable on a private bucket — persistence/DB storage uses
 * this shape because it is stable and parseable back to the object key, while
 * browsers always receive fresh presigned GETs instead.
 */
export function ociS3NativeObjectBaseUrl(
  env: Record<string, string | undefined> = cliEnv(),
): string | null {
  const config = readOciS3Env(env);
  if (!config || !config.namespace) return null;
  return `https://objectstorage.${config.region}.oraclecloud.com/n/${config.namespace}/b/${config.bucket}/o`;
}

export function publicUrlForOciS3ObjectKey(
  objectKey: string,
  env: Record<string, string | undefined> = cliEnv(),
): string | null {
  const base = ociS3NativeObjectBaseUrl(env);
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!base || !key) return null;
  return `${base}/${key}`;
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
    // the safest common denominator (mirrors aws-s3-presign.ts).
    forcePathStyle: true,
    // OCI's S3 layer rejects `aws-chunked` transfer encoding ("NotImplemented:
    // AWS chunked encoding not supported"), which SDK v3 emits by default for
    // streamed/buffered bodies when it adds flexible checksums. Only checksum
    // when the request requires it (mirrors the verified shape in
    // ainobi-video-render-service).
    requestChecksumCalculation: "WHEN_REQUIRED",
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

export async function putOciS3ObjectBuffer(
  objectKey: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<void> {
  const key = objectKey.trim().replace(/^\/+/, "");
  const { client, config } = await getS3Client();
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Streamed upload from disk (avoids buffering large files). */
export async function putOciS3ObjectFromFile(
  objectKey: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const { createReadStream } = await import("node:fs");
  const key = objectKey.trim().replace(/^\/+/, "");
  const { client, config } = await getS3Client();
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    }),
  );
}

export async function ociS3ObjectExists(objectKey: string): Promise<boolean> {
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) return false;
  const { client, config } = await getS3Client();
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Server-side copy inside the bucket. Returns false when the source object
 * does not exist in OCI (legacy object still on aliyun) so callers can fall
 * back to the legacy path during the grayscale migration.
 */
export async function copyOciS3Object(sourceObjectKey: string, targetObjectKey: string): Promise<boolean> {
  const sourceKey = sourceObjectKey.trim().replace(/^\/+/, "");
  const targetKey = targetObjectKey.trim().replace(/^\/+/, "");
  if (!sourceKey || !targetKey) return false;
  const { client, config } = await getS3Client();
  const { CopyObjectCommand } = await import("@aws-sdk/client-s3");
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: targetKey,
        CopySource: `${config.bucket}/${sourceKey}`,
      }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function deleteOciS3Object(objectKey: string): Promise<void> {
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) return;
  const { client, config } = await getS3Client();
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

export async function getOciS3ObjectBytes(objectKey: string, maxBytes?: number): Promise<Buffer> {
  const key = objectKey.trim().replace(/^\/+/, "");
  const { client, config } = await getS3Client();
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const response = (await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))) as {
    Body?: { transformToByteArray(): Promise<Uint8Array> };
  };
  const body = response?.Body;
  if (!body) {
    throw new Error("Empty OCI S3 object body.");
  }
  const bytes = await body.transformToByteArray();
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
    throw new Error(`Object too large (${bytes.byteLength} bytes, max ${maxBytes}).`);
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Multipart (staging assembly for chunked uploads)
// ---------------------------------------------------------------------------

export async function beginOciS3MultipartUpload(
  objectKey: string,
  contentType: string,
): Promise<{ uploadId: string }> {
  const key = objectKey.trim().replace(/^\/+/, "");
  const { client, config } = await getS3Client();
  const { CreateMultipartUploadCommand } = await import("@aws-sdk/client-s3");
  const result = (await client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
    }),
  )) as { UploadId?: string };
  const uploadId = result?.UploadId?.trim() ?? "";
  if (!uploadId) {
    throw new Error("OCI S3 CreateMultipartUpload returned empty UploadId.");
  }
  return { uploadId };
}

export async function uploadOciS3MultipartPart(args: {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  chunk: Buffer;
}): Promise<{ etag: string }> {
  const key = args.objectKey.trim().replace(/^\/+/, "");
  const { client, config } = await getS3Client();
  const { UploadPartCommand } = await import("@aws-sdk/client-s3");
  const result = (await client.send(
    new UploadPartCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: args.uploadId,
      PartNumber: args.partNumber,
      Body: args.chunk,
    }),
  )) as { ETag?: string };
  const etag = (result?.ETag ?? "").replace(/^"|"$/g, "");
  if (!etag) {
    throw new Error("OCI S3 UploadPart returned empty ETag.");
  }
  return { etag };
}

export async function completeOciS3MultipartUpload(args: {
  objectKey: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}): Promise<void> {
  const key = args.objectKey.trim().replace(/^\/+/, "");
  const sorted = [...args.parts].sort((a, b) => a.partNumber - b.partNumber);
  const { client, config } = await getS3Client();
  const { CompleteMultipartUploadCommand } = await import("@aws-sdk/client-s3");
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: args.uploadId,
      MultipartUpload: {
        Parts: sorted.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    }),
  );
}

export async function abortOciS3MultipartUpload(objectKey: string, uploadId: string): Promise<void> {
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key || !uploadId) return;
  const { client, config } = await getS3Client();
  const { AbortMultipartUploadCommand } = await import("@aws-sdk/client-s3");
  await client.send(
    new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId }),
  );
}

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
 * Signed headers are `host` only (the shape boto3 generates and the same shape
 * the backend already validated against this OCI endpoint). Payload is
 * UNSIGNED-PAYLOAD. Signing is synchronous and deterministic for a given
 * (key, expiry, now) so it can be used from sync URL builders.
 */
export function signOciS3ObjectReadUrl(
  objectKey: string,
  expiresSeconds?: number,
  options?: { now?: Date; env?: Record<string, string | undefined>; bucket?: string },
): string {
  const config = assertOciS3Env(options?.env);
  // Bucket override: presign against the bucket the INPUT URL itself points at
  // (native `/b/<bucket>/o/` or compat `/<bucket>/` forms) — narration mp3s live
  // in the public bucket while courseware assets live in the private one.
  const bucket = options?.bucket?.trim() || config.bucket;
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
    bucketName: bucket,
    objectKey: key,
    expiresInSeconds: clampPresignExpires(expiresSeconds ?? OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES),
    now: options?.now ?? new Date(),
  });
}

// ---------------------------------------------------------------------------
// Presigned POST (browser direct-upload shape; policy signed with SigV4)
// ---------------------------------------------------------------------------

export interface OciS3PresignedPost {
  url: string;
  fields: Record<string, string>;
}

/**
 * S3-compatible presigned POST (`generate_presigned_post` equivalent) for
 * browser direct uploads. Conditions are intentionally minimal (key + bucket +
 * content-length-range) — callers pass their own key and size range.
 */
export async function createOciS3PresignedPost(args: {
  objectKey: string;
  expiresSeconds?: number;
  contentLengthRange?: { min: number; max: number };
  contentType?: string;
  now?: Date;
}): Promise<OciS3PresignedPost> {
  const config = assertOciS3Env();
  const key = args.objectKey.trim().replace(/^\/+/, "");
  if (!key) {
    throw new Error("Missing object key for OCI S3 presigned POST.");
  }
  const conditions: Array<Record<string, unknown> | Array<unknown>> = [];
  const fields: Record<string, string> = {};
  if (args.contentType) {
    conditions.push({ "Content-Type": args.contentType });
    fields["Content-Type"] = args.contentType;
  }
  if (args.contentLengthRange) {
    conditions.push(["content-length-range", args.contentLengthRange.min, args.contentLengthRange.max]);
  }
  return buildS3PresignedPostUrl({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretKey,
    region: config.region,
    endpointUrl: config.host,
    plainHttp: config.plainHttp,
    bucketName: config.bucket,
    objectKey: key,
    fields,
    conditions,
    expiresInSeconds: clampPresignExpires(args.expiresSeconds ?? OCI_S3_DEFAULT_PUBLIC_URL_EXPIRES),
    now: args.now ?? new Date(),
  });
}
