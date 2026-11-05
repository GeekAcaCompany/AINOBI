// SPDX-License-Identifier: AGPL-3.0-only
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const clampPresignExpires = (seconds: number): number => {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 1800;
  return Math.min(Math.max(s, 60), 60 * 60 * 24 * 7);
};

let cachedClient: S3Client | null = null;

function getS3Client(): S3Client {
  if (cachedClient) return cachedClient;
  const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY?.trim();
  const region = process.env.AWS_S3_REGION_NAME?.trim();
  if (!accessKeyId || !secretAccessKey || !region) {
    throw new Error(
      "AWS S3 is not configured (AWS_S3_ACCESS_KEY_ID, AWS_S3_SECRET_ACCESS_KEY, AWS_S3_REGION_NAME).",
    );
  }
  // Optional S3-compatible endpoint override (e.g. OCI Object Storage:
  // https://{namespace}.compat.objectstorage.{region}.oci.customer-oci.com).
  // Empty = native AWS S3. forcePathStyle keeps bucket-in-path addressing,
  // which every S3-compat implementation supports.
  const endpoint = process.env.AWS_S3_ENDPOINT?.trim();
  cachedClient = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  return cachedClient;
}

/**
 * Generate a presigned GET URL for an S3 object (`@aws-sdk/s3-request-presigner`).
 * `objectKey` is the object key in the bucket (e.g. `courseware_assets/...`), without a leading `/`.
 */
export async function signS3ObjectReadUrl(objectKey: string, expiresSeconds: number): Promise<string> {
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error("AWS S3 is not configured (AWS_S3_BUCKET_NAME).");
  }
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) {
    throw new Error("Missing object key for S3 signed URL.");
  }
  const client = getS3Client();
  const exp = clampPresignExpires(expiresSeconds);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: exp });
}

const DEFAULT_READ_TEXT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Read a small text object from S3 (server-side; avoids browser CORS on presigned URLs).
 */
export async function readS3ObjectBytes(
  objectKey: string,
  maxBytes = DEFAULT_READ_TEXT_MAX_BYTES,
): Promise<Buffer> {
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error("AWS S3 is not configured (AWS_S3_BUCKET_NAME).");
  }
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) {
    throw new Error("Missing object key for S3 read.");
  }
  const client = getS3Client();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;
  if (!body) {
    throw new Error("Empty S3 object body.");
  }
  const bytes = await body.transformToByteArray();
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Object too large (${bytes.byteLength} bytes, max ${maxBytes}).`);
  }
  return Buffer.from(bytes);
}

export async function readS3ObjectText(
  objectKey: string,
  maxBytes = DEFAULT_READ_TEXT_MAX_BYTES,
): Promise<string> {
  const bytes = await readS3ObjectBytes(objectKey, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function copyS3Object(
  sourceObjectKey: string,
  targetObjectKey: string,
): Promise<void> {
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error("AWS S3 is not configured (AWS_S3_BUCKET_NAME).");
  }
  const sourceKey = sourceObjectKey.trim().replace(/^\/+/, "");
  const targetKey = targetObjectKey.trim().replace(/^\/+/, "");
  if (!sourceKey || !targetKey) {
    throw new Error("sourceObjectKey and targetObjectKey are required");
  }
  const client = getS3Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      CopySource: `${bucket}/${sourceKey}`,
    }),
  );
}

export async function deleteS3Object(objectKey: string): Promise<void> {
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error("AWS S3 is not configured (AWS_S3_BUCKET_NAME).");
  }
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) {
    return;
  }
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}
