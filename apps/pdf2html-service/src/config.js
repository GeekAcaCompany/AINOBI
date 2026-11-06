// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const os = require('os');
const path = require('path');
const { resolveStorageBackend } = require('./oci-s3-storage');

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
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
  return {
    rootDir: overrides.rootDir || path.resolve(__dirname, '..'),
    port: Number(overrides.port || numberEnv('PORT', 3000)),
    maxFileSizeMb: numberEnv('MAX_FILE_SIZE_MB', 100),
    workDir: overrides.workDir || process.env.WORK_DIR || path.join(os.tmpdir(), 'ainobi-pdf2html-service'),
    pdf2htmlEXPath: overrides.pdf2htmlEXPath || process.env.PDF2HTMLEX_PATH || 'pdf2htmlEX',
    pdfInfoPath: overrides.pdfInfoPath || process.env.PDFINFO_PATH || 'pdfinfo',
    conversionTimeoutMs: numberEnv('PDF2HTML_TIMEOUT_MS', 10 * 60 * 1000),
    pdf2html: {
      dataDir: process.env.PDF2HTMLEX_DATA_DIR || '',
      popplerDataDir: process.env.PDF2HTMLEX_POPPLER_DATA_DIR || '',
      zoom: process.env.PDF2HTMLEX_ZOOM || '1.5',
      embedCss: boolEnv('PDF2HTMLEX_EMBED_CSS', true),
      embedFont: boolEnv('PDF2HTMLEX_EMBED_FONT', true),
      embedImage: boolEnv('PDF2HTMLEX_EMBED_IMAGE', true),
      embedJavascript: boolEnv('PDF2HTMLEX_EMBED_JAVASCRIPT', true),
      embedOutline: boolEnv('PDF2HTMLEX_EMBED_OUTLINE', true),
      optimizeText: boolEnv('PDF2HTMLEX_OPTIMIZE_TEXT', true),
    },
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
      // Reuse the aliyun multipart-tuning knobs so behavior parity is one dial.
      multipartThresholdBytes: Math.max(100 * 1024, numberEnv('OSS_MULTIPART_THRESHOLD_MB', 1) * 1024 * 1024),
      multipartPartSizeBytes: Math.max(100 * 1024, numberEnv('OSS_MULTIPART_PART_SIZE_MB', 1) * 1024 * 1024),
      multipartParallel: Math.max(1, numberEnv('OSS_MULTIPART_PARALLEL', 3)),
    },
  };
}

module.exports = {
  createServiceConfig,
};
