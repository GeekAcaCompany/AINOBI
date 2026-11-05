// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unified cloud storage interface: one client abstraction over Aliyun OSS (ali-oss) and S3-compatible object storage (@aws-sdk/client-s3),
 * dispatched by storageSettings.cloud_storage_provider (aliyun_oss by default).
 *
 * Every presigned URL is hand-written (not the SDK's own signing) — keeping a byte-level contract with the established production signing format of the object storage,
 * locked by golden tests (cloud_storage.test.ts, byte-for-byte assertions with a fixed clock):
 * - OSS GET: V1 signature, canonical "GET\n\n\n{expire_at}\n/{bucket}/{key}",
 *   key and Signature parts encoded with quote(safe="/") (slashes kept)
 * - OSS PUT: V1 signature, string_to_sign "PUT\n\n{content_type}\n{expires}\n/{bucket}/{key}",
 *   key and Signature parts in the URL path encoded with quote(safe="") (slashes escaped)
 * - S3 GET/POST: SigV4, canonical query sorted by encoded key-value, payload always
 *   UNSIGNED-PAYLOAD, policy JSON in json.dumps default form (", "/": " separators +
 *   ensure_ascii) then base64
 *
 * Platform differences (deliberate trade-offs):
 * - the upload interface takes a Buffer directly; Content-Type is derived from the object name suffix (a mimetypes.guess_type
 *   equivalent table + suffix_map/encodings_map folding semantics)
 * - the SDK layer wraps network errors into ordinary Errors too — everything is caught, logged per the contract and returned as
 *   false/null/[], never thrown to the caller
 * - SDK clients (ali-oss/S3Client) are created lazily and cached per process by "full config" (the pure signing
 *   paths never touch the SDK) */

import { pyQuote } from "@ainobi/api-contracts/serialize.ts";
import {
  buildOssV1PresignedGetUrl,
  buildOssV1PresignedPutUrl,
  buildS3PresignedGetUrl,
  buildS3PresignedPostUrl,
} from "./signing.ts";
import { MIMETYPES_TABLE } from "./mimetypes_table.ts";

import OSS from "ali-oss";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Deployment settings. The host calls configureCloudStorage once at startup; nothing
 * is read from the environment. Field names are the lower-cased backend env names.
 */
export interface CloudStorageSettings {
  aliyun_oss_access_key_id: string;
  aliyun_oss_access_key_secret: string;
  aliyun_oss_bucket: string;
  aliyun_oss_endpoint: string;
  aliyun_oss_url_expires: number;
  aws_s3_access_key_id: string;
  aws_s3_bucket_name: string;
  aws_s3_endpoint_url: string;
  /** The endpoint is a local store on a plain http:// address (`pnpm lite`). Off everywhere else. */
  aws_s3_local_endpoint: boolean;
  aws_s3_region_name: string;
  aws_s3_secret_access_key: string;
  aws_s3_url_expires: number;
  cloud_storage_key_prefix: string;
  /** "aliyun_oss" or "aws_s3" (any S3-compatible endpoint, e.g. OCI). */
  cloud_storage_provider: string;
  video_bucket_name: string;
  video_storage_key_prefix: string;
}

export const DEFAULT_CLOUD_STORAGE_SETTINGS: Readonly<CloudStorageSettings> = {
  aliyun_oss_access_key_id: "",
  aliyun_oss_access_key_secret: "",
  aliyun_oss_bucket: "",
  aliyun_oss_endpoint: "",
  aliyun_oss_url_expires: 3600,
  aws_s3_access_key_id: "",
  aws_s3_bucket_name: "",
  aws_s3_endpoint_url: "",
  aws_s3_local_endpoint: false,
  aws_s3_region_name: "",
  aws_s3_secret_access_key: "",
  aws_s3_url_expires: 3600,
  cloud_storage_key_prefix: "",
  cloud_storage_provider: "aliyun_oss",
  video_bucket_name: "",
  video_storage_key_prefix: "",
};

let storageSettings: CloudStorageSettings = { ...DEFAULT_CLOUD_STORAGE_SETTINGS };

/** Only an endpoint explicitly marked local takes the plain-http forms. */
function isLocalEndpoint(endpointUrl: string): boolean {
  return storageSettings.aws_s3_local_endpoint && /^http:\/\//i.test(endpointUrl);
}

/** Set the deployment settings (unset fields take the defaults). Call before any client or presign use. */
export function configureCloudStorage(settings: Partial<CloudStorageSettings>): void {
  storageSettings = { ...DEFAULT_CLOUD_STORAGE_SETTINGS, ...settings };
}

/** The settings in effect. */
export function getCloudStorageSettings(): Readonly<CloudStorageSettings> {
  return storageSettings;
}

// ---------------------------------------------------------------------------
// Object key normalization (parseS3BucketKey / stripPhysicalKeyPrefix / normalizeS3ObjectKey)
// ---------------------------------------------------------------------------

interface ParsedUrl {
  netloc: string;
  path: string;
}

/** Minimal subset of urllib.parse.urlparse (only what the netloc/path decisions need) */
function parseUrl(value: string): ParsedUrl {
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(value);
  if (!schemeMatch) {
    return { netloc: "", path: "" };
  }
  return { netloc: schemeMatch[2], path: schemeMatch[3] };
}

/** Equivalent of urllib.parse.unquote (%XX decoding, once) */
function unquote(value: string): string {
  return value.replace(/%(?:[0-9a-fA-F]{2})+/g, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
}

/** Equivalent of str.split(sep, maxsplit) (JS split's limit truncates instead of keeping the remainder) */
function splitMax(value: string, separator: string, maxsplit: number): string[] {
  const parts: string[] = [];
  let rest = value;
  while (parts.length < maxsplit) {
    const index = rest.indexOf(separator);
    if (index < 0) {
      break;
    }
    parts.push(rest.slice(0, index));
    rest = rest.slice(index + separator.length);
  }
  parts.push(rest);
  return parts;
}

/**
 * Extract (bucket, key) from an S3/OSS/OCI URL or a bare key.
 * The returned bucket is always the configured bucket name (null for Aliyun OSS virtual-host style).
 * Covers every endpoint form: AWS virtual-host/path style, OCI S3-compatible/native, Aliyun OSS.
 */
export function parseS3BucketKey(
  urlOrKey: string,
): [string | null, string | null] {
  if (!urlOrKey) {
    return [storageSettings.aws_s3_bucket_name, null];
  }

  const parsed = parseUrl(urlOrKey);
  if (!parsed.netloc) {
    // Bare key: strip the leading "/" so signed URLs don't get a double slash
    const key = urlOrKey.replace(/^\/+/, "") || null;
    return [storageSettings.aws_s3_bucket_name, key];
  }

  // Virtual-host style: bucket.s3.region.amazonaws.com/key
  if (parsed.netloc.includes(".s3.") && parsed.netloc.includes("amazonaws.com")) {
    const key = parsed.path.replace(/^\/+/, "") || null;
    return [storageSettings.aws_s3_bucket_name, key];
  }

  // Path style: s3.region.amazonaws.com/bucket/key
  if (parsed.netloc.startsWith("s3.") && parsed.netloc.includes("amazonaws.com")) {
    const parts = splitMax(parsed.path.replace(/^\/+/, ""), "/", 1);
    if (parts.length === 2) {
      return [storageSettings.aws_s3_bucket_name, parts[1] || null];
    }
  }

  // OCI S3-compat virtual-host style: bucket.vhcompat.objectstorage.../key
  if (parsed.netloc.startsWith("vhcompat.") || parsed.netloc.includes(".vhcompat.")) {
    const key = parsed.path.replace(/^\/+/, "") || null;
    return [storageSettings.aws_s3_bucket_name, key];
  }

  // OCI S3-compat path style: {namespace}.compat.objectstorage.../bucket/key
  if (parsed.netloc.includes(".compat.objectstorage.")) {
    const parts = splitMax(parsed.path.replace(/^\/+/, ""), "/", 1);
    if (parts.length === 2) {
      return [storageSettings.aws_s3_bucket_name, parts[1] || null];
    }
    return [storageSettings.aws_s3_bucket_name, null];
  }

  // OCI native URL (PAR or stable form): .../p/{par}/n/{ns}/b/{bucket}/o/{key...}
  if (parsed.netloc.startsWith("objectstorage.") && parsed.netloc.includes("oraclecloud.com")) {
    const path = parsed.path.replace(/^\/+/, "").split("/");
    if (path.length >= 2 && (path[0] === "p" || path[0] === "n") && path.includes("o")) {
      const key = path.slice(path.indexOf("o") + 1).join("/") || null;
      return [storageSettings.aws_s3_bucket_name, key];
    }
    return [storageSettings.aws_s3_bucket_name, null];
  }

  // The local store (path style), which is none of the known hosts above
  if (
    isLocalEndpoint(storageSettings.aws_s3_endpoint_url) &&
    parsed.netloc === storageSettings.aws_s3_endpoint_url.replace(/^https?:\/\//i, "").replace(/\/+$/, "")
  ) {
    const parts = splitMax(parsed.path.replace(/^\/+/, ""), "/", 1);
    return [storageSettings.aws_s3_bucket_name, parts.length === 2 ? unquote(parts[1]) || null : null];
  }

  // Aliyun OSS: re-extract the key from a signed URL (V1 PUT presigning percent-encodes the whole key; decoding once always restores it)
  if (parsed.netloc.endsWith(".aliyuncs.com")) {
    const key = unquote(parsed.path).replace(/^\/+/, "") || null;
    return [null, key];
  }

  return [storageSettings.aws_s3_bucket_name, null];
}

/** Fold the storage client's physical migration prefix (empty prefix = native S3 / a no-op in production) */
export function stripPhysicalKeyPrefix(key: string): string {
  const prefix = (storageSettings.cloud_storage_key_prefix || "").replace(/^\/+|\/+$/g, "");
  const stripped = key.replace(/^\/+/, "");
  if (!prefix) {
    return stripped;
  }
  if (stripped === prefix) {
    return "";
  }
  if (stripped.startsWith(`${prefix}/`)) {
    return stripped.slice(prefix.length + 1);
  }
  return stripped;
}

/** URL/key → logical object key (normalized before persisting; null/empty passes through as-is) */
export function normalizeS3ObjectKey(
  urlOrKey: string | null | undefined,
): string | null {
  if (!urlOrKey) {
    return urlOrKey ?? null;
  }

  const parsed = parseUrl(urlOrKey);
  if (parsed.netloc && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(urlOrKey)) {
    const [, key] = parseS3BucketKey(urlOrKey);
    if (key) {
      return stripPhysicalKeyPrefix(key);
    }
  }

  // Bare key: strip the leading "/" (avoids double-slash signed URLs)
  return stripPhysicalKeyPrefix(urlOrKey) || urlOrKey;
}

// ---------------------------------------------------------------------------
// Logical key → physical key mapping (mapVideoBucket / translateS3Key; used only by the AWS S3 client)
// ---------------------------------------------------------------------------

/** Recording logical bucket → S3-compatible physical (bucket, key) (prefix rewrite by storageSettings.video_storage_key_prefix) */
function mapVideoBucket(bucketName: string, key: string): [string, string] {
  const vp = (storageSettings.video_storage_key_prefix || "").replace(/^\/+|\/+$/g, "");
  if (vp && storageSettings.video_bucket_name && bucketName === storageSettings.video_bucket_name) {
    const physical = storageSettings.aws_s3_bucket_name;
    let mappedKey = (key || "").replace(/^\/+/, "");
    if (!mappedKey.startsWith(`${vp}/`)) {
      mappedKey = `${vp}/${mappedKey}`;
    }
    return [physical, mappedKey];
  }
  return [bucketName, key];
}

/**
 * Logical key → physical key inside the mirrored migration tree (storageSettings.cloud_storage_key_prefix appended idempotently).
 * Unknown buckets (legacy AWS targets) pass through as-is; the leading "/" must be stripped before the prefix is appended.
 */
function translateS3Key(bucket: string, key: string): string {
  const rawKey = key || "";
  let prefix = "";
  if (bucket === storageSettings.aws_s3_bucket_name) {
    prefix = (storageSettings.cloud_storage_key_prefix || "").replace(/^\/+|\/+$/g, "");
  }
  if (!prefix) {
    return rawKey;
  }
  const stripped = rawKey.replace(/^\/+/, "");
  if (stripped.startsWith(`${prefix}/`)) {
    return stripped;
  }
  return `${prefix}/${stripped}`;
}

// ---------------------------------------------------------------------------
// Equivalents of urllib.quote / mimetypes.guess_type (for presigning and upload Content-Type derivation)
// ---------------------------------------------------------------------------


/** mimetypes.suffix_map: folding of compression wrapper extensions (case-insensitive) */
const MIMETYPES_SUFFIX_MAP: Record<string, string> = {
  ".svgz": ".svg.gz",
  ".tgz": ".tar.gz",
  ".taz": ".tar.gz",
  ".tz": ".tar.gz",
  ".tbz2": ".tar.bz2",
  ".txz": ".tar.xz",
};

/** mimetypes.encodings_map: encoding suffixes (case-sensitive; on a hit, strip one layer to get the inner extension) */
const MIMETYPES_ENCODINGS_MAP: ReadonlySet<string> = new Set([".gz", ".Z", ".bz2", ".xz", ".br"]);

/** Last-extension split of posixpath.splitext (a file name with only a leading dot has no extension → "") */
function splitExt(name: string): [string, string] {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = name.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return [name, ""];
  }
  return [name.slice(0, name.length - (base.length - dot)), base.slice(dot)];
}

/**
 * Equivalent of mimetypes.guess_type(file_path), returning the content type (encoding info does not
 * take part in the upload header — the encoding half only affects the inner extension folding):
 * - URL scheme form (an `xx:` prefix) guesses from the path part
 * - suffix_map folding (.tgz → .tar.gz chain, case-insensitive)
 * - an encodings_map hit (case-sensitive) strips one layer and guesses the inner one (.gz with no inner → null)
 * - the extension is lowercased for the lookup; unknown extensions (.inx/.moc3/.pptist etc.) → null (no Content-Type)
 */
export function guessContentType(name: string): string | null {
  let url = name;
  // urlparse: when the scheme starts with a letter and is longer than 1, take the path part
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(url);
  if (schemeMatch && schemeMatch[1].length > 1) {
    url = schemeMatch[2];
  }
  let [base, ext] = splitExt(url);
  let extLower = ext.toLowerCase();
  while (Object.prototype.hasOwnProperty.call(MIMETYPES_SUFFIX_MAP, extLower)) {
    [base, ext] = splitExt(base + MIMETYPES_SUFFIX_MAP[extLower]);
    extLower = ext.toLowerCase();
  }
  if (MIMETYPES_ENCODINGS_MAP.has(ext)) {
    [, ext] = splitExt(base);
  }
  return MIMETYPES_TABLE[ext.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Client interface (CloudStorageClient)
// ---------------------------------------------------------------------------

/** Upload presign result: PUT form for AliyunOSS, presigned POST form for AWSS3 */
export type PresignedUploadResult =
  | { url: string; method: string; headers: Record<string, string> }
  | { url: string; fields: Record<string, string> };

export interface CloudStorageClient {
  /** Upload presigning (default bucket) — AliyunOSS {url,method,headers}; AWSS3 {url,fields}; null on failure */
  getPresignedUrlForUpload(objectName: string, fileType: string): Promise<PresignedUploadResult | null>;
  /** Upload presigning (given bucket) — null on failure */
  getPresignedUrlForUploadInBucket(
    objectName: string,
    fileType: string,
    bucketName: string,
  ): Promise<PresignedUploadResult | null>;
  /** Download presigned GET URL (null on failure; response_content_disposition used only by AWSS3) */
  getPresignedUrlForDownload(options: {
    objectName: string;
    expiresIn?: number | null;
    bucketName?: string | null;
    responseContentDisposition?: string | null;
  }): Promise<string | null>;
  /** Upload object bytes (Content-Type derived from the object name suffix; false on failure) */
  uploadFile(objectName: string, content: Buffer): Promise<boolean>;
  /** Download object content (null on failure) */
  downloadFile(objectName: string): Promise<Buffer | null>;
  /** Delete an object (the provider reports failure as false, never throwing to the caller) */
  deleteFile(objectName: string): Promise<boolean>;
  /** Delete an object in a given (external/recording) bucket */
  deleteFileFromBucket(objectName: string, bucketName: string): Promise<boolean>;
  /** List by prefix (returns **logical** keys; [] on failure) */
  listObjects(prefix: string): Promise<string[]>;
  /** Copy an object within a bucket (physical copy of knowledge files when cloning a course; false on failure) */
  copyObject(sourceKey: string, destKey: string): Promise<boolean>;
  /** Object ACL → public-read (a no-op true on OCI S3-compatible endpoints) */
  setPublicAccess(objectName: string): Promise<boolean>;
  /** Object ACL in a given bucket → public-read */
  setPublicAccessInBucket(objectName: string, bucketName: string): Promise<boolean>;
  /** Public (unsigned) object URL */
  getObjectUrl(objectName: string): Promise<string>;
  /** Upload to a given (recording) bucket */
  uploadFileToBucket(objectName: string, content: Buffer, bucketName: string): Promise<boolean>;
  /** Public (unsigned) object URL in a given bucket */
  getObjectUrlFromBucket(objectName: string, bucketName: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// AliyunOSS client (ali-oss)
// ---------------------------------------------------------------------------

export interface AliyunOssClientOptions {
  accessKeyId?: string;
  accessKeySecret?: string;
  endpoint?: string;
  bucketName?: string;
  urlExpires?: number;
}

export class AliyunOssStorageClient implements CloudStorageClient {
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;
  private readonly endpoint: string;
  private readonly bucketName: string;
  private readonly urlExpires: number;

  /**
   * options is only a test injection seam (defaults to the configureCloudStorage config); production calls
   * getCloudStorageClient(), which uses the config throughout.
   */
  constructor(options: AliyunOssClientOptions = {}) {
    this.accessKeyId = options.accessKeyId ?? storageSettings.aliyun_oss_access_key_id;
    this.accessKeySecret = options.accessKeySecret ?? storageSettings.aliyun_oss_access_key_secret;
    this.endpoint = options.endpoint ?? storageSettings.aliyun_oss_endpoint;
    this.bucketName = options.bucketName ?? storageSettings.aliyun_oss_bucket;
    this.urlExpires = options.urlExpires ?? storageSettings.aliyun_oss_url_expires;
  }

  /**
   * The ali-oss client is cached by "full config" (endpoint + credentials + bucket): instances share and reuse connections,
   * but instances with different config (test injection seam / multiple buckets and credentials) never share a client.
   */
  private static clients = new Map<string, OSS>();

  private client(bucketName: string = this.bucketName): OSS {
    const cacheKey = `${this.accessKeyId}|${this.accessKeySecret}|${this.endpoint}|${bucketName}`;
    const cached = AliyunOssStorageClient.clients.get(cacheKey);
    if (cached) {
      return cached;
    }
    const client = new OSS({
      accessKeyId: this.accessKeyId,
      accessKeySecret: this.accessKeySecret,
      endpoint: this.endpoint,
      bucket: bucketName,
    });
    AliyunOssStorageClient.clients.set(cacheKey, client);
    return client;
  }

  async getPresignedUrlForUpload(
    objectName: string,
    fileType: string,
  ): Promise<PresignedUploadResult | null> {
    // Pure string construction never throws — no try/except needed
    return buildOssV1PresignedPutUrl({
      accessKeyId: this.accessKeyId,
      accessKeySecret: this.accessKeySecret,
      endpoint: this.endpoint,
      bucketName: this.bucketName,
      objectKey: objectName,
      contentType: fileType,
      expiresInSeconds: this.urlExpires,
      nowEpochSeconds: Date.now() / 1000,
    });
  }

  async getPresignedUrlForUploadInBucket(
    objectName: string,
    fileType: string,
    bucketName: string,
  ): Promise<PresignedUploadResult | null> {
    try {
      return buildOssV1PresignedPutUrl({
        accessKeyId: this.accessKeyId,
        accessKeySecret: this.accessKeySecret,
        endpoint: this.endpoint,
        bucketName,
        objectKey: objectName,
        contentType: fileType,
        expiresInSeconds: this.urlExpires,
        nowEpochSeconds: Date.now() / 1000,
      });
    } catch (error) {
      console.warn(`Error generating presigned URL for OSS upload in bucket ${bucketName}: ${error}`);
      return null;
    }
  }

  async getPresignedUrlForDownload(options: {
    objectName: string;
    expiresIn?: number | null;
    bucketName?: string | null;
    responseContentDisposition?: string | null;
  }): Promise<string | null> {
    // bucket/expires default semantics; response_content_disposition does not take part in signing
    const bucketName = options.bucketName || this.bucketName;
    const expires = options.expiresIn || this.urlExpires;
    const expireAt = Math.floor(Date.now() / 1000) + expires;
    return buildOssV1PresignedGetUrl({
      accessKeyId: this.accessKeyId,
      accessKeySecret: this.accessKeySecret,
      endpoint: this.endpoint,
      bucketName,
      objectKey: options.objectName,
      expiresAtEpochSeconds: expireAt,
    });
  }

  async uploadFile(objectName: string, content: Buffer): Promise<boolean> {
    try {
      const contentType = guessContentType(objectName);
      const headers = contentType ? { "Content-Type": contentType } : undefined;
      await this.client().put(objectName, content, headers ? { headers } : undefined);
      return true;
    } catch (error) {
      console.warn(`Error uploading to Aliyun OSS: ${error}`);
      return false;
    }
  }

  async downloadFile(objectName: string): Promise<Buffer | null> {
    try {
      const result = await this.client().get(objectName);
      return result.content;
    } catch (error) {
      console.warn(`Error downloading from Aliyun OSS: ${error}`);
      return null;
    }
  }

  async deleteFile(objectName: string): Promise<boolean> {
    try {
      await this.client().delete(objectName);
      return true;
    } catch (error) {
      console.warn(`Error deleting from Aliyun OSS: ${error}`);
      return false;
    }
  }

  async deleteFileFromBucket(objectName: string, bucketName: string): Promise<boolean> {
    try {
      await this.client(bucketName).delete(objectName);
      return true;
    } catch (error) {
      console.warn(`Error deleting from Aliyun OSS bucket ${bucketName}: ${error}`);
      return false;
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    try {
      // listV2 pages until exhausted (max-keys 100)
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await this.client().listV2(
          continuationToken
            ? { prefix, "max-keys": 100, "continuation-token": continuationToken }
            : { prefix, "max-keys": 100 },
        );
        for (const obj of result.objects ?? []) {
          keys.push(obj.name);
        }
        continuationToken = result.isTruncated ? result.nextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    } catch (error) {
      console.warn(`Error listing objects from Aliyun OSS: ${error}`);
      return [];
    }
  }

  async copyObject(sourceKey: string, destKey: string): Promise<boolean> {
    try {
      // Same-bucket copy
      await this.client().copy(destKey, sourceKey);
      return true;
    } catch (error) {
      console.warn(`Error copying object in Aliyun OSS: ${error}`);
      return false;
    }
  }

  async setPublicAccess(objectName: string): Promise<boolean> {
    try {
      await this.client().putACL(objectName, "public-read");
      console.log(`Successfully set public access for Aliyun OSS object ${objectName}`);
      return true;
    } catch (error) {
      console.warn(`Error setting public access for Aliyun OSS object ${objectName}: ${error}`);
      return false;
    }
  }

  async setPublicAccessInBucket(objectName: string, bucketName: string): Promise<boolean> {
    try {
      await this.client(bucketName).putACL(objectName, "public-read");
      console.log(
        `Successfully set public access for Aliyun OSS object ${objectName} in bucket ${bucketName}`,
      );
      return true;
    } catch (error) {
      console.warn(
        `Error setting public access for Aliyun OSS object ${objectName} in bucket ${bucketName}: ${error}`,
      );
      return false;
    }
  }

  async getObjectUrl(objectName: string): Promise<string> {
    // Public URL: object_name is not encoded
    const endpoint = this.endpoint.replace(/^https?:\/\//, "");
    return `https://${this.bucketName}.${endpoint}/${objectName}`;
  }

  async uploadFileToBucket(objectName: string, content: Buffer, bucketName: string): Promise<boolean> {
    try {
      await this.client(bucketName).put(objectName, content);
      return true;
    } catch (error) {
      console.warn(`Error uploading to Aliyun OSS bucket ${bucketName}: ${error}`);
      return false;
    }
  }

  async getObjectUrlFromBucket(objectName: string, bucketName: string): Promise<string> {
    const endpoint = this.endpoint.replace(/^https?:\/\//, "");
    return `https://${bucketName}.${endpoint}/${objectName}`;
  }
}

// ---------------------------------------------------------------------------
// AWS S3 client (@aws-sdk/client-s3; presigning is hand-written SigV4)
// ---------------------------------------------------------------------------

interface PresignContext {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpointUrl: string;
  bucketName: string;
  urlExpires: number;
}

/**
 * S3 client constructed lazily and memoized per process (bucketed by the full "endpoint|region|credentials" config;
 * the SDK client holds a connection pool, reused stably, and different configs never share one).
 */
const s3ClientsByEndpoint = new Map<string, S3Client>();

export function getS3SdkClient(clientOptions: {
  endpointUrl: string;
  regionName: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  const cacheKey = `${clientOptions.endpointUrl}|${clientOptions.regionName}|${clientOptions.accessKeyId}`;
  const cached = s3ClientsByEndpoint.get(cacheKey);
  if (cached) {
    return cached;
  }
  const options: ConstructorParameters<typeof S3Client>[0] = {
    region: clientOptions.regionName,
    credentials: {
      accessKeyId: clientOptions.accessKeyId,
      secretAccessKey: clientOptions.secretAccessKey,
    },
  };
  const endpointUrl = clientOptions.endpointUrl;
  if (endpointUrl) {
    // S3-compatible endpoint (OCI Object Storage): path-style addressing; integrity headers
    // (checksum) are refused by non-AWS implementations — relaxed with WHEN_REQUIRED.
    options.endpoint = endpointUrl;
    options.forcePathStyle = true;
    options.requestChecksumCalculation = "WHEN_REQUIRED";
    options.responseChecksumValidation = "WHEN_REQUIRED";
  }
  const client = new S3Client(options);
  s3ClientsByEndpoint.set(cacheKey, client);
  return client;
}

export interface AwsS3ClientOptions {
  accessKeyId?: string;
  secretAccessKey?: string;
  regionName?: string;
  endpointUrl?: string;
  bucketName?: string;
  urlExpires?: number;
}

export class AwsS3StorageClient implements CloudStorageClient {
  private readonly bucketName: string;
  private readonly regionName: string;
  private readonly urlExpires: number;
  private readonly endpointUrl: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  /**
   * options is only a test injection seam (defaults to the configureCloudStorage config); production calls
   * getCloudStorageClient(), which uses the config throughout.
   */
  constructor(options: AwsS3ClientOptions = {}) {
    this.accessKeyId = options.accessKeyId ?? storageSettings.aws_s3_access_key_id;
    this.secretAccessKey = options.secretAccessKey ?? storageSettings.aws_s3_secret_access_key;
    this.regionName = options.regionName ?? storageSettings.aws_s3_region_name;
    this.endpointUrl = options.endpointUrl ?? storageSettings.aws_s3_endpoint_url;
    this.bucketName = options.bucketName ?? storageSettings.aws_s3_bucket_name;
    this.urlExpires = options.urlExpires ?? storageSettings.aws_s3_url_expires;
  }

  private presignContext(): PresignContext {
    return {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.regionName,
      endpointUrl: this.endpointUrl,
      bucketName: this.bucketName,
      urlExpires: this.urlExpires,
    };
  }

  async getPresignedUrlForUpload(
    objectName: string,
    fileType: string,
  ): Promise<PresignedUploadResult | null> {
    try {
      const ctx = this.presignContext();
      return buildS3PresignedPostUrl({
        accessKeyId: ctx.accessKeyId,
        secretAccessKey: ctx.secretAccessKey,
        region: ctx.region,
        endpointUrl: ctx.endpointUrl,
        plainHttp: isLocalEndpoint(ctx.endpointUrl),
        bucketName: ctx.bucketName,
        objectKey: translateS3Key(ctx.bucketName, objectName),
        fields: { "Content-Type": fileType },
        conditions: [{ "Content-Type": fileType }],
        expiresInSeconds: ctx.urlExpires,
        now: new Date(),
      });
    } catch (error) {
      console.warn(`Error generating presigned URL for S3 upload: ${error}`);
      return null;
    }
  }

  async getPresignedUrlForUploadInBucket(
    objectName: string,
    fileType: string,
    bucketName: string,
  ): Promise<PresignedUploadResult | null> {
    try {
      const ctx = this.presignContext();
      // A given bucket uses the key directly (no translate)
      return buildS3PresignedPostUrl({
        accessKeyId: ctx.accessKeyId,
        secretAccessKey: ctx.secretAccessKey,
        region: ctx.region,
        endpointUrl: ctx.endpointUrl,
        plainHttp: isLocalEndpoint(ctx.endpointUrl),
        bucketName,
        objectKey: objectName,
        fields: { "Content-Type": fileType },
        conditions: [{ "Content-Type": fileType }],
        expiresInSeconds: ctx.urlExpires,
        now: new Date(),
      });
    } catch (error) {
      console.warn(`Error generating presigned URL for S3 upload in bucket ${bucketName}: ${error}`);
      return null;
    }
  }

  async getPresignedUrlForDownload(options: {
    objectName: string;
    expiresIn?: number | null;
    bucketName?: string | null;
    responseContentDisposition?: string | null;
  }): Promise<string | null> {
    try {
      const ctx = this.presignContext();
      const expires = options.expiresIn || ctx.urlExpires;
      let [bucketName, objectName] = [options.bucketName || ctx.bucketName, options.objectName];
      [bucketName, objectName] = mapVideoBucket(bucketName, objectName);
      return buildS3PresignedGetUrl({
        accessKeyId: ctx.accessKeyId,
        secretAccessKey: ctx.secretAccessKey,
        region: ctx.region,
        endpointUrl: ctx.endpointUrl,
        plainHttp: isLocalEndpoint(ctx.endpointUrl),
        bucketName,
        objectKey: translateS3Key(bucketName, objectName),
        expiresInSeconds: expires,
        now: new Date(),
        responseContentDisposition: options.responseContentDisposition,
      });
    } catch (error) {
      console.warn(`Error generating presigned URL for S3 download: ${error}`);
      return null;
    }
  }

  async uploadFile(objectName: string, content: Buffer): Promise<boolean> {
    try {
      const contentType = guessContentType(objectName);
      await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: translateS3Key(this.bucketName, objectName),
          Body: content,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );
      return true;
    } catch (error) {
      console.warn(`Error uploading to S3: ${error}`);
      return false;
    }
  }

  async downloadFile(objectName: string): Promise<Buffer | null> {
    try {
      const response = await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: translateS3Key(this.bucketName, objectName),
        }),
      );
      const bytes = await response.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      console.warn(`Error downloading from S3: ${error}`);
      return null;
    }
  }

  async deleteFile(objectName: string): Promise<boolean> {
    try {
      await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: translateS3Key(this.bucketName, objectName),
        }),
      );
      return true;
    } catch (error) {
      console.warn(`Error deleting from S3: ${error}`);
      return false;
    }
  }

  async deleteFileFromBucket(objectName: string, bucketName: string): Promise<boolean> {
    try {
      const [mappedBucket, mappedKey] = mapVideoBucket(bucketName, objectName);
      await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(new DeleteObjectCommand({ Bucket: mappedBucket, Key: mappedKey }));
      return true;
    } catch (error) {
      console.warn(`Error deleting from S3 bucket ${bucketName}: ${error}`);
      return false;
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    try {
      // Pages until exhausted; returns **logical** keys (physical mirror prefix folded — the lesson of the 2026-09-06 teacher model 404)
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
          new ListObjectsV2Command({
            Bucket: this.bucketName,
            Prefix: translateS3Key(this.bucketName, prefix),
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          }),
        );
        for (const obj of page.Contents ?? []) {
          if (obj.Key !== undefined) {
            keys.push(stripPhysicalKeyPrefix(obj.Key));
          }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    } catch (error) {
      console.warn(`Error listing objects from S3: ${error}`);
      return [];
    }
  }

  async copyObject(sourceKey: string, destKey: string): Promise<boolean> {
    try {
      const src = translateS3Key(this.bucketName, sourceKey);
      const dst = translateS3Key(this.bucketName, destKey);
      // The CopySource header is pre-encoded with quote(safe="/~") (@aws-sdk expects the caller to encode it)
      const copySource = `${this.bucketName}/${pyQuote(src, "/~")}`;
      await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
        new CopyObjectCommand({
          CopySource: copySource,
          Bucket: this.bucketName,
          Key: dst,
        }),
      );
      return true;
    } catch (error) {
      console.warn(`Error copying object in S3: ${error}`);
      return false;
    }
  }

  async setPublicAccess(objectName: string): Promise<boolean> {
    if (this.endpointUrl) {
      // OCI Object Storage has no object-level ACLs; visibility is per bucket — treated as a no-op
      console.log(
        `set_public_access skipped on S3-compatible endpoint (bucket-level visibility for ${this.bucketName})`,
      );
      return true;
    }
    try {
      await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
        new PutObjectAclCommand({
          Bucket: this.bucketName,
          Key: translateS3Key(this.bucketName, objectName),
          ACL: "public-read",
        }),
      );
      return true;
    } catch (error) {
      console.warn(`Error setting public access for S3 object ${objectName}: ${error}`);
      return false;
    }
  }

  async setPublicAccessInBucket(objectName: string, bucketName: string): Promise<boolean> {
    try {
      await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
        new PutObjectAclCommand({
          Bucket: bucketName,
          Key: objectName,
          ACL: "public-read",
        }),
      );
      return true;
    } catch (error) {
      console.warn(
        `Error setting public access for S3 object ${objectName} in bucket ${bucketName}: ${error}`,
      );
      return false;
    }
  }

  async getObjectUrl(objectName: string): Promise<string> {
    const key = translateS3Key(this.bucketName, objectName);
    const endpointUrl = this.endpointUrl;
    if (isLocalEndpoint(endpointUrl)) {
      // A local store on a plain address has no bucket subdomains
      return `${endpointUrl.replace(/\/+$/, "")}/${this.bucketName}/${key}`;
    }
    if (endpointUrl) {
      const host = endpointUrl.replace(/^https?:\/\//, "");
      return `https://${this.bucketName}.${host}/${key}`;
    }
    return `https://${this.bucketName}.s3.${this.regionName}.amazonaws.com/${key}`;
  }

  async uploadFileToBucket(objectName: string, content: Buffer, bucketName: string): Promise<boolean> {
    try {
      const [mappedBucket, mappedKey] = mapVideoBucket(bucketName, objectName);
      await getS3SdkClient({ endpointUrl: this.endpointUrl, regionName: this.regionName, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }).send(
        new PutObjectCommand({ Bucket: mappedBucket, Key: mappedKey, Body: content }),
      );
      return true;
    } catch (error) {
      console.warn(`Error uploading to S3 bucket ${bucketName}: ${error}`);
      return false;
    }
  }

  async getObjectUrlFromBucket(objectName: string, bucketName: string): Promise<string> {
    if (isLocalEndpoint(this.endpointUrl)) {
      return `${this.endpointUrl.replace(/\/+$/, "")}/${bucketName}/${objectName}`;
    }
    // Fixed amazonaws.com form (the public URL of the recording logical bucket without a custom endpoint)
    return `https://${bucketName}.s3.${this.regionName}.amazonaws.com/${objectName}`;
  }
}

// ---------------------------------------------------------------------------
// Dispatch (get_cloud_storage_client) and presign_s3_url
// ---------------------------------------------------------------------------

/**
 * Dispatch by storageSettings.cloud_storage_provider; throws when nothing matches (→ 500).
 * The provider default aliyun_oss is guaranteed by DEFAULT_CLOUD_STORAGE_SETTINGS.
 */
export function getCloudStorageClient(): CloudStorageClient {
  const provider = storageSettings.cloud_storage_provider;
  if (provider === "aliyun_oss") {
    return new AliyunOssStorageClient();
  } else if (provider === "aws_s3") {
    return new AwsS3StorageClient();
  }
  throw new Error(`Unsupported cloud storage provider: ${provider}`);
}

/**
 * URL / bare key → this provider's presigned download GET URL.
 * - empty → the original value (null passes through)
 * - a provider client this repo doesn't support → the original value
 * - a full URL whose key can't be parsed (unknown host) → the original value
 * - a bare key is signed against the active provider's default bucket (bucketName omitted → the client's default bucket)
 * - signing fails (null) → degrades to returning the original value
 *
 * The second argument accepts both a positional parameter and an object parameter:
 * presignS3Url(url, 3600, bucket?, disposition?) ≡
 * presignS3Url(url, { expiresIn, bucketName, contentDisposition })
 */
export async function presignS3Url(
  urlOrKey: string | null | undefined,
  expiresInOrOptions?:
    | number
    | null
    | {
        expiresIn?: number | null;
        bucketName?: string | null;
        contentDisposition?: string | null;
      },
  positionalBucketName?: string | null,
  positionalContentDisposition?: string | null,
): Promise<string | null> {
  if (!urlOrKey) {
    return urlOrKey ?? null;
  }
  let options: {
    expiresIn?: number | null;
    bucketName?: string | null;
    contentDisposition?: string | null;
  };
  if (typeof expiresInOrOptions === "object" && expiresInOrOptions !== null) {
    options = expiresInOrOptions;
  } else {
    const expiresIn = typeof expiresInOrOptions === "number" ? expiresInOrOptions : null;
    options = {
      expiresIn,
      bucketName: positionalBucketName ?? null,
      contentDisposition: positionalContentDisposition ?? null,
    };
  }

  const client = getCloudStorageClient();
  // [oss-storage] AliyunOSS supports download signing too (single-bucket, sign-every-resource architecture)
  if (
    !(client instanceof AliyunOssStorageClient) &&
    !(client instanceof AwsS3StorageClient)
  ) {
    return urlOrKey;
  }

  const [bucket, key] = parseS3BucketKey(urlOrKey);
  const parsed = parseUrl(urlOrKey);
  const isUrl = Boolean(parsed.netloc);
  if (isUrl && !key) {
    return urlOrKey;
  }
  // Always strip the leading "/" — otherwise legacy DB values and URL paths with "//" produce double-slash signed URLs
  const objectKey = (key ?? urlOrKey).replace(/^\/+/, "");

  // Only a URL host carries real bucket ownership; for a bare key, settings.aws_s3_bucket_name (a legacy name from the AWS
  // era) must not be passed to AliyunOSS — sign against the active provider's default bucket (bucketName=null)
  const bucketName = options.bucketName || (isUrl ? bucket : null);

  const presigned = await client.getPresignedUrlForDownload({
    objectName: objectKey,
    expiresIn: options.expiresIn ?? null,
    bucketName,
    responseContentDisposition: options.contentDisposition ?? null,
  });
  return presigned || urlOrKey;
}

/** Avatar field presigning (where the per-service presignAvatarUrl copies converged) */
export const presignAvatarUrl = presignS3Url;

// ---------------------------------------------------------------------------
// Persistence-safe URLs (stripPresignQuery / persistSafeObjectUrl / deepPersistObjectUrls)
// ---------------------------------------------------------------------------

const PRESIGN_QUERY_PARAM_MARKERS = [
  "signature=",
  "x-amz-",
  "expires=",
  "ossaccesskeyid=",
] as const;

/** Strip the presign query (only when signature parameters are present) */
export function stripPresignQuery(url: string): string {
  if (!url || !url.includes("://") || !url.includes("?")) {
    return url;
  }
  const query = url.split("?", 2)[1]!.toLowerCase();
  if (PRESIGN_QUERY_PARAM_MARKERS.some((marker) => query.includes(marker))) {
    return url.split("?", 2)[0]!;
  }
  return url;
}

function isOciObjectUrl(value: string): boolean {
  try {
    const host = (new URL(value).hostname || "").toLowerCase();
    return (
      host.endsWith(".oci.customer-oci.com") ||
      (host.startsWith("objectstorage.") && host.endsWith(".oraclecloud.com"))
    );
  } catch {
    return false;
  }
}

/** Persistence-safe form: signature stripped + OCI URLs folded to bare keys (public permanent URLs as-is) */
export function persistSafeObjectUrl(value: string): string {
  const stripped = stripPresignQuery(value);
  if (isOciObjectUrl(stripped)) {
    const [, key] = parseS3BucketKey(stripped);
    if (key) {
      return key;
    }
  }
  return stripped;
}

/** Deep-walk stripping (cleans payloads echoed back by clients before persisting) */
export function deepPersistObjectUrls(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return persistSafeObjectUrl(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepPersistObjectUrls);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepPersistObjectUrls(item);
    }
    return result;
  }
  return value;
}
