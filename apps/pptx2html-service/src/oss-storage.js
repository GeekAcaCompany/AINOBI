// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const OSS = require('ali-oss');
const { createHash } = require('crypto');
const { createOciS3Storage, resolveStorageBackend } = require('./oci-s3-storage');

const PPTX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MD5_RE = /^[0-9a-f]{32}$/i;

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
  if (!UUID_RE.test(raw) && !MD5_RE.test(raw)) {
    throw createHttpError(`\`${fieldName}\` must be a UUID or MD5`, 400);
  }
  return raw.toLowerCase();
}

function md5Hex(content) {
  return createHash('md5').update(content).digest('hex');
}

function createPptxId(value, buffer) {
  if (value == null || value === '') {
    if (!Buffer.isBuffer(buffer)) {
      throw createHttpError('Missing PPTX buffer for MD5 `pptx_id`', 400);
    }
    return md5Hex(buffer);
  }
  return normalizeUuid(value, 'pptx_id');
}

function rawPptxObjectKey(pptxId) {
  return `raw/pptx/${pptxId}.pptx`;
}

function htmlArtifactObjectKey(pptxId, htmlId) {
  return `artifact/pptx/${pptxId}/html/${htmlId}.html`;
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

const DEFAULT_OSS_CALLBACK_BODY = 'bucket=${bucket}&object=${object}&size=${size}&etag=${etag}&mimeType=${mimeType}';

function resolveAliOssPutCallback(ossConfig) {
  const cbCfg = ossConfig.callback;
  if (!cbCfg || !cbCfg.url) {
    return null;
  }
  const callback = {
    url: cbCfg.url,
    body: cbCfg.body || DEFAULT_OSS_CALLBACK_BODY,
  };
  if (cbCfg.host) {
    callback.host = cbCfg.host;
  }
  if (cbCfg.contentType) {
    callback.contentType = cbCfg.contentType;
  }
  if (cbCfg.callbackSNI) {
    callback.callbackSNI = true;
  }
  if (cbCfg.customVar && Object.keys(cbCfg.customVar).length > 0) {
    callback.customValue = cbCfg.customVar;
  }
  return callback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOssNetworkError(error) {
  if (!error) {
    return false;
  }
  const status = error.status ?? error.statusCode;
  if (status === -1) {
    return true;
  }
  const code = error.code;
  if (
    code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || code === 'EPIPE'
    || code === 'ECONNABORTED'
    || code === 'ENETUNREACH'
    || code === 'EAI_AGAIN'
    || code === 'ECONNREFUSED'
  ) {
    return true;
  }
  const msg = String(error.message || '');
  // ali-oss multipartUpload wraps part failures as "Failed to upload some parts with error: ..."
  // without a status or code, so the transport cause is only visible in the message.
  if (/socket disconnected|socket hang up|TLS connection|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|Failed to upload some parts/i.test(msg)) {
    return true;
  }
  if (error.cause && isRetryableOssNetworkError(error.cause)) {
    return true;
  }
  return false;
}

function createOssStorage(config, options = {}) {
  let client;
  const ossPutCallback = resolveAliOssPutCallback(config.oss);
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
        // urllib respects HTTPS_PROXY / HTTP_PROXY / NO_PROXY when enableProxy is set
        enableProxy: true,
      });
    }
    return client;
  }

  function resetOssClient() {
    client = undefined;
  }

  async function withUploadRetry(run, contextLabel, resetClient = resetOssClient) {
    const maxRetries = config.oss.uploadMaxRetries ?? 0;
    const baseMs = config.oss.uploadRetryBaseMs;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        const retryable = isRetryableOssNetworkError(error);
        if (!retryable || attempt === maxRetries) {
          throw error;
        }
        resetClient();
        const delay = Math.min(30_000, baseMs * 2 ** attempt + Math.random() * baseMs);
        console.warn(
          `[oss upload] retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms (${contextLabel}): ${error.message}`
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async function putObject(objectKey, content, contentType, options = {}) {
    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content));
    const headers = {
      'Content-Type': contentType,
    };
    const uploadOptions = {
      headers,
      mime: contentType,
    };
    if (ossPutCallback) {
      uploadOptions.callback = ossPutCallback;
    }
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    if (onProgress) {
      onProgress({ objectKey, percentage: 0, size, multipart: size >= config.oss.multipartThresholdBytes });
    }

    if (size >= config.oss.multipartThresholdBytes) {
      await withUploadRetry(
        () =>
          getClient().multipartUpload(objectKey, content, {
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
          }),
        objectKey
      );
    } else {
      await withUploadRetry(() => getClient().put(objectKey, content, uploadOptions), objectKey);
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
  // (`raw/pptx/{id}.pptx`, `artifact/pptx/{id}/html/{htmlId}.html`) regardless
  // of where the bytes live — presigned reads are resolved by courseware-agent.
  function buildStorage(impl) {
    return {
      backend,
      createPptxId,
      htmlArtifactObjectKey,
      normalizeUuid,
      rawPptxObjectKey,
      async downloadRawPptx(pptxId) {
        return impl.getObject(rawPptxObjectKey(pptxId));
      },
      async uploadHtmlArtifact(pptxId, htmlId, html, uploadOptions) {
        const objectKey = htmlArtifactObjectKey(pptxId, htmlId);
        await impl.putObject(objectKey, Buffer.from(html, 'utf8'), HTML_CONTENT_TYPE, uploadOptions);
        return objectKey;
      },
      async uploadRawPptx(pptxId, buffer, uploadOptions) {
        const objectKey = rawPptxObjectKey(pptxId);
        if (await impl.objectExists(objectKey)) {
          return objectKey;
        }
        await impl.putObject(objectKey, buffer, PPTX_CONTENT_TYPE, uploadOptions);
        return objectKey;
      },
    };
  }

  if (ociStorage) {
    return buildStorage({
      async putObject(objectKey, content, contentType, uploadOptions) {
        await withUploadRetry(
          () => ociStorage.putObject(objectKey, content, contentType, uploadOptions),
          objectKey,
          ociStorage.resetClient
        );
        return objectKey;
      },
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
  createOssStorage,
  isRetryableOssNetworkError,
  createPptxId,
  htmlArtifactObjectKey,
  normalizeUuid,
  rawPptxObjectKey,
};
