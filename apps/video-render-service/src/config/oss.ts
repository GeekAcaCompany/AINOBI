// SPDX-License-Identifier: AGPL-3.0-only
import { createRequire } from "node:module";

export interface OssClientConfig {
  region: string;
  endpoint?: string;
  bucket: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  stsToken?: string;
  secure: boolean;
  timeout: number;
  proxy?: string;
  publicBaseUrl?: string;
  /**
   * Route the OSS client through the region's intranet endpoint
   * (`oss-<region>-internal.aliyuncs.com`). Only reachable from Aliyun
   * ECS/FC in the same region; traffic is free and faster. Ignored when an
   * explicit `endpoint` is set (endpoint takes precedence in ali-oss).
   */
  internal: boolean;
}

function parseBoolean(raw: string | undefined): boolean {
  if (!raw?.trim()) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function parseTimeoutMs(raw: string | undefined, fallbackMs: number): number {
  if (!raw?.trim()) {
    return fallbackMs;
  }

  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith("ms")) {
    const value = Number(trimmed.slice(0, -2));
    return Number.isFinite(value) && value > 0 ? value : fallbackMs;
  }
  if (trimmed.endsWith("s")) {
    const value = Number(trimmed.slice(0, -1));
    return Number.isFinite(value) && value > 0 ? value * 1000 : fallbackMs;
  }

  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : fallbackMs;
}

export function resolveOssClientConfig(bucket: string): OssClientConfig {
  const region = process.env.OSS_REGION?.trim() || "ap-northeast-1";
  const endpoint = process.env.OSS_ENDPOINT?.trim() || undefined;
  const accessKeyId =
    process.env.OSS_ACCESS_KEY_ID?.trim() ||
    process.env.ALIYUN_ACCESS_KEY_ID?.trim() ||
    undefined;
  const accessKeySecret =
    process.env.OSS_ACCESS_KEY_SECRET?.trim() ||
    process.env.ALIYUN_ACCESS_KEY_SECRET?.trim() ||
    undefined;

  return {
    region,
    endpoint,
    bucket,
    accessKeyId,
    accessKeySecret,
    stsToken: process.env.OSS_STS_TOKEN?.trim() || undefined,
    secure: process.env.OSS_SECURE?.trim().toLowerCase() !== "false",
    timeout: parseTimeoutMs(process.env.OSS_TIMEOUT, 300_000),
    proxy: process.env.OSS_PROXY?.trim() || undefined,
    publicBaseUrl:
      process.env.AINOBI_VIDEO_RENDER_OSS_PUBLIC_BASE_URL?.trim() ||
      process.env.OSS_PUBLIC_BASE_URL?.trim() ||
      undefined,
    internal:
      parseBoolean(process.env.AINOBI_VIDEO_RENDER_OSS_INTERNAL) ||
      parseBoolean(process.env.OSS_INTERNAL),
  };
}

export function buildOssObjectUrl(config: OssClientConfig, objectKey: string): string {
  const normalizedKey = objectKey.replace(/^\/+/, "");
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/, "")}/${normalizedKey}`;
  }

  const endpointHost = (config.endpoint || `https://oss-${config.region}.aliyuncs.com`)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  return `https://${config.bucket}.${endpointHost}/${normalizedKey}`;
}

interface OssSignClient {
  signatureUrl: (
    name: string,
    options?: { expires?: number; method?: string },
  ) => string;
}

/** ali-oss client kept for read-URL signing; rebuilt only when its inputs change. */
let signedReadClient: { cacheKey: string; client: OssSignClient } | null = null;

/**
 * Presigned GET for an aliyun OSS object — private buckets (production storage
 * policy) 403 on plain object URLs, so read URLs must be signed at response
 * time, exactly like the OCI path. `signatureUrl` is local HMAC work (no
 * network), hence the sync signature. Returns undefined when no credentials
 * are configured so callers can fall back to the legacy plain-URL behavior
 * (public buckets).
 */
export function presignAliyunOssReadUrl(
  config: OssClientConfig,
  objectKey: string,
  expiresSeconds = 3600,
): string | undefined {
  if (!config.accessKeyId || !config.accessKeySecret) {
    return undefined;
  }
  const normalizedKey = objectKey.replace(/^\/+/, "");
  // Sign against the public endpoint — intranet-signed hosts are unreachable
  // from browsers even though the signature itself is valid.
  const signEndpoint =
    config.internal && !config.endpoint
      ? `https://oss-${config.region}.aliyuncs.com`
      : config.endpoint;
  const cacheKey = JSON.stringify([
    config.region,
    signEndpoint ?? null,
    config.bucket,
    config.accessKeyId,
    config.stsToken ?? null,
    config.secure,
  ]);
  if (!signedReadClient || signedReadClient.cacheKey !== cacheKey) {
    // ali-oss is CJS and external to the ESM bundle — `createRequire` is the
    // only way to resolve it synchronously from a sync presign path.
    const require = createRequire(import.meta.url);
    const OSS = require("ali-oss") as new (options: Record<string, unknown>) => OssSignClient;
    signedReadClient = {
      cacheKey,
      client: new OSS({
        region: signEndpoint ? undefined : `oss-${config.region}`,
        endpoint: signEndpoint,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        stsToken: config.stsToken,
        secure: config.secure,
        timeout: config.timeout,
      }),
    };
  }
  return signedReadClient.client.signatureUrl(normalizedKey, {
    method: "GET",
    expires: expiresSeconds,
  });
}
