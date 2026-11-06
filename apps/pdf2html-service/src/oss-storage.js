// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const OSS = require('ali-oss');
const { createHash } = require('crypto');
const { createOciS3Storage, resolveStorageBackend } = require('./oci-s3-storage');

const PDF_CONTENT_TYPE = 'application/pdf';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const MD5_RE = /^[0-9a-f]{32}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw createHttpError(`Missing \`${fieldName}\``, 400);
  }
  if (!UUID_RE.test(raw)) {
    throw createHttpError(`\`${fieldName}\` must be a UUID`, 400);
  }
  return raw.toLowerCase();
}

function normalizePdfId(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw createHttpError(`Missing \`${fieldName}\``, 400);
  }
  if (!MD5_RE.test(raw) && !UUID_RE.test(raw)) {
    throw createHttpError(`\`${fieldName}\` must be an MD5 hash or UUID`, 400);
  }
  return raw.toLowerCase();
}

function createPdfId(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw createHttpError('Missing PDF buffer for `pdf_id` generation', 400);
  }
  return createHash('md5').update(buffer).digest('hex');
}

function rawPdfObjectKey(pdfId) {
  return `raw/pdf/${pdfId}.pdf`;
}

function htmlArtifactObjectKey(pdfId, htmlId) {
  return `artifact/pdf/${pdfId}/html/${htmlId}.html`;
}

function assertOssConfig(ossConfig) {
  const missing = ['bucket', 'accessKeyId', 'accessKeySecret'].filter((key) => !ossConfig[key]);
  if (!ossConfig.region && !ossConfig.endpoint) {
    missing.push('region or endpoint');
  }
  if (missing.length) {
    throw createHttpError(`OSS is not configured: missing ${missing.join(', ')}`, 500);
  }
}

function createOssStorage(config, options = {}) {
  let client;
  // Storage backend switch (oci-migration grayscale): default `aliyun_oss`
  // keeps the legacy ali-oss path; `oci_s3` writes the same bare keys to the
  // private OCI bucket (example-storage) via the S3-compatible endpoint.
  const backend = config.storageBackend || resolveStorageBackend();
  const ociStorage = backend === 'oci_s3'
    ? createOciS3Storage(config.ociS3, { createClient: options.ociCreateClient })
    : null;

  function getClient() {
    if (!client) {
      assertOssConfig(config.oss);
      client = new OSS({
        region: config.oss.region || undefined,
        endpoint: config.oss.endpoint || undefined,
        bucket: config.oss.bucket,
        accessKeyId: config.oss.accessKeyId,
        accessKeySecret: config.oss.accessKeySecret,
        stsToken: config.oss.stsToken || undefined,
        secure: config.oss.secure,
        timeout: config.oss.timeout,
      });
    }
    return client;
  }

  async function putObject(objectKey, content, contentType, options = {}) {
    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content));
    const uploadOptions = {
      headers: {
        'Content-Type': contentType,
      },
      mime: contentType,
    };
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    if (onProgress) {
      onProgress({ objectKey, percentage: 0, size, multipart: size >= config.oss.multipartThresholdBytes });
    }

    if (size >= config.oss.multipartThresholdBytes) {
      await getClient().multipartUpload(objectKey, content, {
        ...uploadOptions,
        parallel: config.oss.multipartParallel,
        partSize: config.oss.multipartPartSizeBytes,
        progress: (percentage, checkpoint) => {
          if (onProgress) {
            onProgress({
              objectKey,
              percentage,
              size,
              multipart: true,
              doneParts: checkpoint && checkpoint.doneParts ? checkpoint.doneParts.length : undefined,
            });
          }
        },
      });
    } else {
      await getClient().put(objectKey, content, uploadOptions);
    }

    if (onProgress) {
      onProgress({ objectKey, percentage: 1, size, multipart: size >= config.oss.multipartThresholdBytes });
    }
    return objectKey;
  }

  async function getObject(objectKey) {
    try {
      const result = await getClient().get(objectKey);
      return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
    } catch (error) {
      if (error && (error.status === 404 || error.statusCode === 404 || error.code === 'NoSuchKey')) {
        throw createHttpError(`OSS object not found: ${objectKey}`, 404);
      }
      throw error;
    }
  }

  async function objectExists(objectKey) {
    try {
      await getClient().head(objectKey);
      return true;
    } catch (error) {
      if (error && (error.status === 404 || error.statusCode === 404 || error.code === 'NoSuchKey')) {
        return false;
      }
      throw error;
    }
  }

  // Facade shared by both backends: callers always receive bare object keys
  // (`raw/pdf/{id}.pdf`, `artifact/pdf/{id}/html/{htmlId}.html`) regardless of
  // where the bytes live — presigned reads are resolved by courseware-agent.
  function buildStorage(impl) {
    return {
      backend,
      createPdfId,
      htmlArtifactObjectKey,
      normalizePdfId,
      normalizeUuid,
      rawPdfObjectKey,
      async downloadRawPdf(pdfId) {
        return impl.getObject(rawPdfObjectKey(pdfId));
      },
      async uploadHtmlArtifact(pdfId, htmlId, html, uploadOptions) {
        const objectKey = htmlArtifactObjectKey(pdfId, htmlId);
        await impl.putObject(objectKey, Buffer.from(html, 'utf8'), HTML_CONTENT_TYPE, uploadOptions);
        return objectKey;
      },
      async uploadRawPdf(pdfId, buffer, uploadOptions) {
        const objectKey = rawPdfObjectKey(pdfId);
        if (await impl.objectExists(objectKey)) {
          return objectKey;
        }
        await impl.putObject(objectKey, buffer, PDF_CONTENT_TYPE, uploadOptions);
        return objectKey;
      },
    };
  }

  if (ociStorage) {
    return buildStorage({
      putObject: ociStorage.putObject.bind(ociStorage),
      getObject: ociStorage.getObject.bind(ociStorage),
      objectExists: ociStorage.objectExists.bind(ociStorage),
    });
  }

  return buildStorage({
    putObject,
    getObject,
    objectExists,
  });
}

module.exports = {
  createHttpError,
  createOssStorage,
  createPdfId,
  htmlArtifactObjectKey,
  normalizePdfId,
  normalizeUuid,
  rawPdfObjectKey,
};
