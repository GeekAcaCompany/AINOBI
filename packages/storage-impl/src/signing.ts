// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Presigned URL builders for Aliyun OSS (V1) and S3-compatible storage (SigV4): pure functions with
 * no SDK dependency, so hosts that only sign (or load the SDKs lazily) can import them alone.
 * Every byte of the output is part of the production signing contract and locked by golden tests.
 */

import { createHash, createHmac } from "node:crypto";

import { pyJsonStringify, pyQuote } from "@ainobi/api-contracts/serialize.ts";

// ---------------------------------------------------------------------------
// OSS V1 presigning (pure functions, exported so golden unit tests lock them byte by byte)
// ---------------------------------------------------------------------------

/**
 * OSS V1 PUT upload presigning (shared by manual upload paths such as recording upload parameters; locked by golden tests):
 * - string_to_sign = "PUT\n\n{content_type}\n{expires}\n/{bucket}/{key}" (key in its raw form)
 * - the key in the URL path is percent-encoded as a whole ("/" → %2F, space → %20)
 * - when contentType is a string (including empty), a Content-Type header is always returned; null/undefined returns none
 */
export function buildOssV1PresignedPutUrl(params: {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  bucketName: string;
  objectKey: string;
  contentType?: string | null;
  expiresInSeconds: number;
  nowEpochSeconds: number;
}): { url: string; method: string; headers: Record<string, string> } {
  const endpointHost = params.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const expires = Math.floor(params.nowEpochSeconds) + params.expiresInSeconds;
  const contentType = params.contentType ?? "";
  const stringToSign =
    `PUT\n\n${contentType}\n${expires}\n/${params.bucketName}/${params.objectKey}`;
  const signature = createHmac("sha1", params.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");
  // Production format of PUT presigning: the whole key encoded (slashes not exempt)
  const encodedKey = pyQuote(params.objectKey);
  const url =
    `https://${params.bucketName}.${endpointHost}/${encodedKey}` +
    `?OSSAccessKeyId=${pyQuote(params.accessKeyId)}` +
    `&Expires=${expires}` +
    `&Signature=${pyQuote(signature)}`;
  const headers: Record<string, string> = {};
  if (params.contentType !== null && params.contentType !== undefined) {
    headers["Content-Type"] = params.contentType;
  }
  return { url, method: "PUT", headers };
}

/**
 * OSS V1 GET download presigning (locked by golden tests):
 * - canonical = "GET\n\n\n{expire_at}\n/{bucket}/{key}" (key in its raw form)
 * - the key and Signature parts in the URL path both use quote(safe="/") (slashes kept, spaces/Unicode encoded)
 * - response_content_disposition is consumed only on the S3 path; the OSS path neither signs nor outputs it
 */
export function buildOssV1PresignedGetUrl(params: {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  bucketName: string;
  objectKey: string;
  expiresAtEpochSeconds: number;
  /** URL scheme; "http" only for endpoints that do not serve TLS (the signature does not cover it). */
  protocol?: "https" | "http";
}): string {
  const endpointHost = params.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const expireAt = Math.floor(params.expiresAtEpochSeconds);
  const canonical = `GET\n\n\n${expireAt}\n/${params.bucketName}/${params.objectKey}`;
  const signature = createHmac("sha1", params.accessKeySecret)
    .update(canonical, "utf8")
    .digest("base64");
  const encodedKey = pyQuote(params.objectKey, "/");
  return (
    `${params.protocol ?? "https"}://${params.bucketName}.${endpointHost}/${encodedKey}` +
    `?OSSAccessKeyId=${params.accessKeyId}` +
    `&Expires=${expireAt}` +
    `&Signature=${pyQuote(signature, "/")}`
  );
}

// ---------------------------------------------------------------------------
// S3 SigV4 presigning (pure functions, exported so golden unit tests lock the production format byte by byte)
// ---------------------------------------------------------------------------

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** UTC %Y%m%dT%H%M%SZ (the SigV4 timestamp form) */
function formatAmzDate(now: Date): string {
  return `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}` +
    `T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;
}

/** UTC %Y%m%d (credential scope date) */
function formatAmzDateShort(now: Date): string {
  return `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`;
}

/** ISO8601 = '%Y-%m-%dT%H:%M:%SZ' (presigned POST policy expiration) */
function formatIso8601Z(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** SigV4 signing key chain (kDate → kRegion → kService → kSigning) */
function sigV4SigningKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

interface S3EndpointInfo {
  /** Request host (no port when none is given) */
  host: string;
  /** Whether path style is used (custom S3-compatible endpoints use path-style addressing) */
  pathStyle: boolean;
}

/** Endpoint resolution: with storageSettings.aws_s3_endpoint_url → path style; without → global endpoint virtual-host style */
function resolveS3Endpoint(endpointUrl: string, bucketName: string): S3EndpointInfo {
  if (endpointUrl) {
    const host = endpointUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return { host, pathStyle: true };
  }
  // Default global endpoint without a custom endpoint: {bucket}.s3.amazonaws.com
  return { host: `${bucketName}.s3.amazonaws.com`, pathStyle: false };
}

/** canonical URI (path style: /{bucket}/{key}; virtual: /{key}); key quote(safe="/~") */
function s3CanonicalUri(pathStyle: boolean, bucketName: string, objectKey: string): string {
  const encodedKey = pyQuote(objectKey, "/~");
  return pathStyle ? `/${bucketName}/${encodedKey}` : `/${encodedKey}`;
}

/**
 * S3 SigV4 GET presigning (byte-level contract with the production signing format, locked by golden unit tests):
 * - canonical query sorted by encoded key-value pairs; payload hash always UNSIGNED-PAYLOAD
 * - emit order = operation parameters (insertion order) → auth parameters (Algorithm/Credential/Date/
 *   Expires/SignedHeaders) → X-Amz-Signature last
 */
export function buildS3PresignedGetUrl(params: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpointUrl: string;
  bucketName: string;
  objectKey: string;
  expiresInSeconds: number;
  now: Date;
  responseContentDisposition?: string | null;
  /** A local store on a plain address (`pnpm lite`): the URL is http://. Nothing else sets this. */
  plainHttp?: boolean;
}): string {
  const endpoint = resolveS3Endpoint(params.endpointUrl, params.bucketName);
  const canonicalUri = s3CanonicalUri(endpoint.pathStyle, params.bucketName, params.objectKey);
  const amzDate = formatAmzDate(params.now);
  const dateShort = formatAmzDateShort(params.now);
  const scope = `${dateShort}/${params.region}/s3/aws4_request`;
  const credential = `${params.accessKeyId}/${scope}`;

  const hostHeader = endpoint.host;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  // canonical query: everything encoded, then sorted by (key, value)
  const queryPairs: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(params.expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  if (params.responseContentDisposition) {
    queryPairs.push(["response-content-disposition", params.responseContentDisposition]);
  }
  const canonicalQuery = queryPairs
    .map(([k, v]) => [pyQuote(k, "-_.~"), pyQuote(v, "-_.~")] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${hostHeader}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = sigV4SigningKey(params.secretAccessKey, dateShort, params.region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  // Emit order: operation parameters first (insertion order), auth parameters next, Signature last
  const emitParts: string[] = [];
  if (params.responseContentDisposition) {
    emitParts.push(`response-content-disposition=${pyQuote(params.responseContentDisposition, "-_.~")}`);
  }
  emitParts.push(
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${pyQuote(credential, "-_.~")}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${params.expiresInSeconds}`,
    `X-Amz-SignedHeaders=${signedHeaders}`,
  );
  emitParts.push(`X-Amz-Signature=${signature}`);

  return `${params.plainHttp ? "http" : "https"}://${endpoint.host}${canonicalUri}?${emitParts.join("&")}`;
}

/**
 * S3 SigV4 presigned POST (byte-level contract with the production signing format, locked by golden unit tests):
 * - policy conditions = user conditions → {"bucket"} → {"key"} (or starts-with for
 *   ${filename}) → x-amz-algorithm/credential/date (fixed append order)
 * - policy JSON in json.dumps default form (", "/": " separators + ensure_ascii) then b64
 * - x-amz-signature = HMAC of the encoded policy string with the SigV4 key chain
 * - returns {url, fields}, with a fixed field key order (user fields → key → x-amz-*)
 */
export function buildS3PresignedPostUrl(params: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpointUrl: string;
  bucketName: string;
  objectKey: string;
  fields: Record<string, string>;
  conditions: Array<Record<string, unknown> | Array<unknown>>;
  expiresInSeconds: number;
  now: Date;
  /** See buildS3PresignedGetUrl. */
  plainHttp?: boolean;
}): { url: string; fields: Record<string, string> } {
  const endpoint = resolveS3Endpoint(params.endpointUrl, params.bucketName);
  // URL serialized by CreateBucket: path style → {endpoint}/{bucket}; virtual → {bucket}.s3.amazonaws.com
  const url = endpoint.pathStyle
    ? `${params.plainHttp ? "http" : "https"}://${endpoint.host}/${params.bucketName}`
    : `https://${endpoint.host}`;

  const amzDate = formatAmzDate(params.now);
  const dateShort = formatAmzDateShort(params.now);
  const scope = `${dateShort}/${params.region}/s3/aws4_request`;
  const credential = `${params.accessKeyId}/${scope}`;

  const expiration = formatIso8601Z(
    new Date(params.now.getTime() + params.expiresInSeconds * 1000),
  );

  const conditions: Array<Record<string, unknown> | Array<unknown>> = [
    ...params.conditions,
    { bucket: params.bucketName },
    params.objectKey.endsWith("${filename}")
      ? ["starts-with", "$key", params.objectKey.slice(0, -"${filename}".length)]
      : { key: params.objectKey },
    { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
    { "x-amz-credential": credential },
    { "x-amz-date": amzDate },
  ];

  const policyJson = pyJsonStringify({ expiration, conditions });
  const policyB64 = Buffer.from(policyJson, "utf8").toString("base64");
  const signingKey = sigV4SigningKey(params.secretAccessKey, dateShort, params.region, "s3");
  const signature = createHmac("sha256", signingKey).update(policyB64, "utf8").digest("hex");

  const fields: Record<string, string> = { ...params.fields };
  fields["key"] = params.objectKey;
  fields["x-amz-algorithm"] = "AWS4-HMAC-SHA256";
  fields["x-amz-credential"] = credential;
  fields["x-amz-date"] = amzDate;
  fields["policy"] = policyB64;
  fields["x-amz-signature"] = signature;

  return { url, fields };
}
