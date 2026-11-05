// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Render-task result URL policy.
 *
 * `render_task.result` persists object references only — `bucket` + `key`
 * (+ size/etag). Signed URLs must never reach the database: OCI presigned
 * GETs expire (default 7 days), so a stored signature goes stale and every
 * later read echoes a dead URL. The object key is the durable identifier;
 * HTTP responses and callbacks re-derive the URL from the key at read time
 * (OCI → fresh presigned GET; aliyun → fresh presigned GET against the private
 * bucket; plain public URL only as a credential-less fallback).
 */
import { buildOssObjectUrl, presignAliyunOssReadUrl, resolveOssClientConfig } from "../config/oss.ts";
import type {
  RenderTaskOssObjectPayload,
  RenderTaskResultPayload,
} from "../models/render-task-entity.ts";
import { isOciS3StorageEnabled, ociS3StorageUrlHosts, readOciS3Env } from "./oci-s3-storage.ts";
import { ociUploadResultUrl } from "./oss-upload.ts";

/** Drop `url` from `oss`/`cover` — the shape `markRenderTaskCompleted` persists. */
export function sanitizeRenderTaskResultForPersistence(
  result: RenderTaskResultPayload,
): RenderTaskResultPayload {
  return {
    ...result,
    ...(result.oss ? { oss: stripObjectUrl(result.oss) } : {}),
    ...(result.cover ? { cover: stripObjectUrl(result.cover) } : {}),
  };
}

function stripObjectUrl(obj: RenderTaskOssObjectPayload): RenderTaskOssObjectPayload {
  const { url: _url, ...rest } = obj;
  return rest;
}

/**
 * Response/callback shape: fresh `url` rebuilt from the persisted key so every
 * consumer gets a currently-valid signature (or a permanent aliyun URL) without
 * the DB ever holding one. Never mutates the entity's result object.
 *
 * Aliyun storage is presigned here too: the production storage policy is a
 * single *private* bucket, where plain object URLs 403. The legacy plain-URL
 * fallback only survives for rows read without signing credentials.
 */
export function presignRenderTaskResultForResponse(
  result: RenderTaskResultPayload | null,
): RenderTaskResultPayload | null {
  if (!result) {
    return result;
  }
  const next: RenderTaskResultPayload = { ...result };
  for (const field of ["oss", "cover"] as const) {
    const obj = next[field];
    if (!obj) {
      continue;
    }
    const url = objectReadUrlForResult(obj);
    if (url !== undefined) {
      next[field] = { ...obj, url };
    }
  }
  return next;
}

function objectReadUrlForResult(obj: RenderTaskOssObjectPayload): string | undefined {
  if (isOciS3StorageEnabled()) {
    // Legacy rows store a permanent aliyun URL — keep it (the object lives
    // there; re-signing against the OCI bucket would point at a nonexistent
    // object).
    if (obj.url && !isOciStorageUrl(obj.url)) {
      return obj.url;
    }
    try {
      return ociUploadResultUrl(obj.key);
    } catch {
      // OCI env incomplete — fall back to whatever the row carries.
    }
  } else {
    // Aliyun private bucket: presign from the persisted bucket+key. Rows may
    // also carry a plain (unsigned) URL — never hand it to a client.
    try {
      const signed = presignAliyunOssReadUrl(resolveOssClientConfig(obj.bucket), obj.key);
      if (signed) {
        return signed;
      }
    } catch {
      // No credentials / signing failure — fall through to legacy behavior.
    }
  }
  if (obj.url) {
    return obj.url;
  }
  try {
    return buildOssObjectUrl(resolveOssClientConfig(obj.bucket), obj.key);
  } catch {
    return undefined;
  }
}

/** Whether a stored URL points at an OCI host (native or S3-compat). */
function isOciStorageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    // A local store (`pnpm lite`) is told apart by its port.
    const host = (readOciS3Env()?.plainHttp ? parsed.host : parsed.hostname).toLowerCase();
    for (const ociHost of ociS3StorageUrlHosts()) {
      if (ociHost.toLowerCase() === host) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
