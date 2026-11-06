// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const path = require('path');
const { resolveStorageBackend } = require('./oci-s3-storage');

const RUNTIME_PATCH_VERSION = 'shape-fallback-v38';
const DEFAULT_PUPPETEER_ARGS = '--no-sandbox,--disable-setuid-sandbox';

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function csvEnv(name, fallback) {
  return String(process.env[name] || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') {
    return fallback;
  }
  return !/^(0|false|no)$/i.test(String(value));
}

function normalizeEndpoint(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

function createServiceConfig(overrides = {}) {
  const port = Number(overrides.port || numberEnv('PORT', 3000));
  const rootDir = overrides.rootDir || path.resolve(__dirname, '..');
  return {
    rootDir,
    port,
    corsOrigins: csvEnv('CORS_ORIGIN', ''),
    maxFileSizeMb: numberEnv('MAX_FILE_SIZE_MB', 100),
    poolSize: Math.max(1, numberEnv('PPTX_POOL_SIZE', 2)),
    // Slide HTML artifacts uploaded at once; each may open OSS_MULTIPART_PARALLEL sockets of its own.
    artifactUploadConcurrency: Math.max(1, numberEnv('OSS_ARTIFACT_UPLOAD_CONCURRENCY', 4)),
    runtimeReadyTimeoutMs: numberEnv('RUNTIME_READY_TIMEOUT_MS', 30000),
    runtimePatchVersion: RUNTIME_PATCH_VERSION,
    runtimePath: '/runtime/converter.html',
    runtimeUrl: overrides.runtimeUrl || `http://127.0.0.1:${port}/runtime/converter.html`,
    oss: {
      region: overrides.ossRegion || process.env.OSS_REGION || '',
      endpoint: normalizeEndpoint(overrides.ossEndpoint || process.env.OSS_ENDPOINT),
      bucket: overrides.ossBucket || process.env.OSS_BUCKET || '',
      accessKeyId: overrides.ossAccessKeyId || process.env.ALIYUN_ACCESS_KEY_ID || '',
      accessKeySecret: overrides.ossAccessKeySecret || process.env.ALIYUN_ACCESS_KEY_SECRET || '',
      stsToken: overrides.ossStsToken || process.env.OSS_STS_TOKEN || '',
      secure: boolEnv('OSS_SECURE', true),
      timeout: overrides.ossTimeout || process.env.OSS_TIMEOUT || '300s',
      multipartThresholdBytes: Math.max(100 * 1024, numberEnv('OSS_MULTIPART_THRESHOLD_MB', 1) * 1024 * 1024),
      multipartPartSizeBytes: Math.max(100 * 1024, numberEnv('OSS_MULTIPART_PART_SIZE_MB', 1) * 1024 * 1024),
      multipartParallel: Math.max(1, numberEnv('OSS_MULTIPART_PARALLEL', 3)),
      uploadMaxRetries: Math.max(0, numberEnv('OSS_UPLOAD_MAX_RETRIES', 4)),
      uploadRetryBaseMs: Math.max(50, numberEnv('OSS_UPLOAD_RETRY_BASE_MS', 500)),
    },
    // Object-storage backend switch (oci-migration grayscale): `aliyun_oss` is
    // the default and keeps the legacy ali-oss path; `oci_s3` writes/reads the
    // same bare object keys in the private OCI bucket `example-storage`.
    storageBackend: overrides.storageBackend || resolveStorageBackend(),
    ociS3: {
      // NB: keep the scheme here. The AWS SDK v3 endpoint MUST include it
      // (`new URL('host-without-scheme')` throws ERR_INVALID_URL); only the
      // legacy ali-oss client wants the bare-host form, so OSS above keeps
      // normalizeEndpoint's scheme-stripping.
      endpoint: String(overrides.ociS3Endpoint || process.env.OCI_S3_ENDPOINT || '')
        .trim()
        .replace(/\/+$/, ''),
      bucket: overrides.ociS3Bucket || process.env.OCI_S3_BUCKET || '',
      accessKeyId: overrides.ociS3AccessKeyId || process.env.OCI_S3_ACCESS_KEY_ID || '',
      secretKey: overrides.ociS3SecretKey || process.env.OCI_S3_SECRET_KEY || '',
      region: overrides.ociS3Region || process.env.OCI_S3_REGION || '',
      // Reuse the aliyun upload-tuning knobs so behavior parity is one dial.
      multipartThresholdBytes: Math.max(100 * 1024, numberEnv('OSS_MULTIPART_THRESHOLD_MB', 1) * 1024 * 1024),
      multipartPartSizeBytes: Math.max(100 * 1024, numberEnv('OSS_MULTIPART_PART_SIZE_MB', 1) * 1024 * 1024),
      multipartParallel: Math.max(1, numberEnv('OSS_MULTIPART_PARALLEL', 3)),
      uploadMaxRetries: Math.max(0, numberEnv('OSS_UPLOAD_MAX_RETRIES', 4)),
      uploadRetryBaseMs: Math.max(50, numberEnv('OSS_UPLOAD_RETRY_BASE_MS', 500)),
    },
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: csvEnv('PUPPETEER_ARGS', DEFAULT_PUPPETEER_ARGS),
    },
  };
}

module.exports = {
  RUNTIME_PATCH_VERSION,
  createServiceConfig,
};
