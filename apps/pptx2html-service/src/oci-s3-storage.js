// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * OCI Object Storage (S3-compatible) backend for the storage write/read path
 * (oci-migration grayscale).
 *
 * Selected by `STORAGE_BACKEND=oci_s3` (default `aliyun_oss` keeps the legacy
 * ali-oss path untouched). Client shape mirrors the validated implementation in
 * ainobi-courseware-agent (`ainobi-courseware-cli/cli/oci-s3-storage.ts`):
 * bucket-in-path (forcePathStyle) against the S3-compat endpoint. The bucket
 * (`example-storage`) is private — object keys stay bare (e.g.
 * `raw/pptx/{id}.pptx`), and presigned reads are handled by courseware-agent.
 *
 * `@aws-sdk/client-s3` is required lazily so the default (aliyun_oss) path
 * never loads the SDK.
 */

const STORAGE_BACKEND_ENV = 'STORAGE_BACKEND';

const OCI_S3_CONFIG_FIELDS = ['endpoint', 'bucket', 'accessKeyId', 'secretKey', 'region'];

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/** `STORAGE_BACKEND=oci_s3` selects OCI; every other value keeps aliyun_oss. */
function resolveStorageBackend(env = process.env) {
  return String(env == null ? '' : env[STORAGE_BACKEND_ENV])
    .trim()
    .toLowerCase() === 'oci_s3' ? 'oci_s3' : 'aliyun_oss';
}

function assertOciS3Config(ociConfig) {
  const config = ociConfig || {};
  const missing = OCI_S3_CONFIG_FIELDS.filter((field) => !config[field]);
  if (missing.length) {
    throw createHttpError(`OCI S3 storage is not configured: missing ${missing.join(', ')}`, 500);
  }
  return config;
}

function isNotFoundError(error) {
  if (!error) {
    return false;
  }
  const status = error.$metadata && error.$metadata.httpStatusCode;
  return status === 404
    || error.name === 'NotFound'
    || error.name === 'NoSuchKey'
    || error.code === 'NotFound'
    || error.code === 'NoSuchKey';
}

/** SDK v3 S3 client: bucket-in-path (path-style) against the OCI S3-compat endpoint. */
function createDefaultS3Client(ociConfig) {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: ociConfig.region,
    endpoint: ociConfig.endpoint,
    credentials: {
      accessKeyId: ociConfig.accessKeyId,
      secretAccessKey: ociConfig.secretKey,
    },
    forcePathStyle: true,
  });
}

function etagOf(result) {
  return String((result && result.ETag) || '').replace(/^"|"$/g, '');
}

/**
 * OCI S3 object operations. Same call surface as the ali-oss internals used by
 * `createOssStorage`: `putObject` (multipart above the configured threshold,
 * with progress callbacks), `getObject` (404 mapped to the same error shape),
 * `objectExists`, `resetClient`.
 */
function createOciS3Storage(ociConfig, options = {}) {
  const createClient = options.createClient || createDefaultS3Client;
  const multipartThresholdBytes = ociConfig.multipartThresholdBytes || 0;
  let client;
  let clientConfig;

  async function getClient() {
    if (!client) {
      clientConfig = assertOciS3Config(ociConfig);
      client = await createClient(clientConfig);
    }
    return client;
  }

  function resetClient() {
    client = undefined;
    clientConfig = undefined;
  }

  async function putObject(objectKey, content, contentType, putOptions = {}) {
    const {
      PutObjectCommand,
      CreateMultipartUploadCommand,
      UploadPartCommand,
      CompleteMultipartUploadCommand,
      AbortMultipartUploadCommand,
    } = require('@aws-sdk/client-s3');
    const s3 = await getClient();
    const bucket = clientConfig.bucket;
    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content));
    const onProgress = typeof putOptions.onProgress === 'function' ? putOptions.onProgress : null;
    const multipart = size >= multipartThresholdBytes;

    if (onProgress) {
      onProgress({ objectKey, percentage: 0, size, multipart });
    }

    if (multipart) {
      // Same threshold/part-size policy as the ali-oss path; parts upload
      // sequentially (multipartParallel is accepted but not used here).
      const created = await s3.send(new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: contentType,
      }));
      const uploadId = created && created.UploadId;
      if (!uploadId) {
        throw createHttpError('OCI S3 CreateMultipartUpload returned empty UploadId', 500);
      }
      const partSize = ociConfig.multipartPartSizeBytes;
      const parts = [];
      try {
        for (let start = 0, partNumber = 1; start < size; start += partSize, partNumber += 1) {
          const chunk = content.subarray(start, Math.min(start + partSize, size));
          const uploaded = await s3.send(new UploadPartCommand({
            Bucket: bucket,
            Key: objectKey,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: chunk,
          }));
          parts.push({ partNumber, etag: etagOf(uploaded) });
          if (onProgress) {
            onProgress({
              objectKey,
              percentage: (start + chunk.length) / size,
              size,
              multipart: true,
              doneParts: parts.length,
            });
          }
        }
        await s3.send(new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }));
      } catch (error) {
        try {
          await s3.send(new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: objectKey,
            UploadId: uploadId,
          }));
        } catch (abortError) {
          // Best-effort cleanup; surface the original failure below.
        }
        throw error;
      }
    } else {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: content,
        ContentType: contentType,
      }));
    }

    if (onProgress) {
      onProgress({ objectKey, percentage: 1, size, multipart });
    }
    return objectKey;
  }

  async function getObject(objectKey) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = await getClient();
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: clientConfig.bucket,
        Key: objectKey,
      }));
      const body = result && result.Body;
      if (!body) {
        throw createHttpError(`OCI S3 object has empty body: ${objectKey}`, 500);
      }
      if (Buffer.isBuffer(body)) {
        return body;
      }
      if (typeof body.transformToByteArray === 'function') {
        return Buffer.from(await body.transformToByteArray());
      }
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      // Same message/status as the legacy ali-oss path so API responses and
      // caller-side handling stay identical.
      if (isNotFoundError(error)) {
        throw createHttpError(`OSS object not found: ${objectKey}`, 404);
      }
      throw error;
    }
  }

  async function objectExists(objectKey) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = await getClient();
    try {
      await s3.send(new HeadObjectCommand({
        Bucket: clientConfig.bucket,
        Key: objectKey,
      }));
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  return {
    putObject,
    getObject,
    objectExists,
    resetClient,
  };
}

module.exports = {
  STORAGE_BACKEND_ENV,
  OCI_S3_CONFIG_FIELDS,
  assertOciS3Config,
  createHttpError,
  createOciS3Storage,
  isNotFoundError,
  resolveStorageBackend,
};
