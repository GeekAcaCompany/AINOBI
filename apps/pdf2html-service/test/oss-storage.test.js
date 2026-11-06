// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOssStorage } = require('../src/oss-storage');
const { resolveStorageBackend } = require('../src/oci-s3-storage');
const { createServiceConfig } = require('../src/config');

const OCI_S3_ENV = {
  OCI_S3_ENDPOINT: 'https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com',
  OCI_S3_BUCKET: 'example-storage',
  OCI_S3_ACCESS_KEY_ID: 'test-access-key',
  OCI_S3_SECRET_KEY: 'test-secret-key',
  OCI_S3_REGION: 'ap-tokyo-1',
};

/** Records commands instead of sending them; returns canned S3 responses. */
function createFakeS3Client({ headNotFound = false } = {}) {
  const commands = [];
  return {
    commands,
    async send(command) {
      commands.push(command);
      switch (command.constructor.name) {
        case 'PutObjectCommand':
          return { ETag: '"put-etag"' };
        case 'CreateMultipartUploadCommand':
          return { UploadId: 'upload-1' };
        case 'UploadPartCommand':
          return { ETag: `"part-${command.input.PartNumber}"` };
        case 'CompleteMultipartUploadCommand':
          return {};
        case 'HeadObjectCommand':
          if (headNotFound) {
            const error = new Error('not found');
            error.name = 'NotFound';
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
          return {};
        case 'GetObjectCommand':
          return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
        default:
          throw new Error(`unexpected command: ${command.constructor.name}`);
      }
    },
  };
}

function ociStorageConfig(overrides = {}) {
  return {
    storageBackend: 'oci_s3',
    oss: { multipartThresholdBytes: 1024, multipartPartSizeBytes: 1024, multipartParallel: 2 },
    ociS3: {
      endpoint: 'https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com',
      bucket: 'example-storage',
      accessKeyId: 'test-access-key',
      secretKey: 'test-secret-key',
      region: 'ap-tokyo-1',
      multipartThresholdBytes: 1024,
      multipartPartSizeBytes: 1024,
      multipartParallel: 2,
      ...overrides.ociS3,
    },
    ...overrides.rest,
  };
}

test('resolveStorageBackend defaults to aliyun_oss', () => {
  assert.equal(resolveStorageBackend({}), 'aliyun_oss');
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: 'aliyun_oss' }), 'aliyun_oss');
});

test('resolveStorageBackend selects oci_s3 only on STORAGE_BACKEND=oci_s3', () => {
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: 'oci_s3' }), 'oci_s3');
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: ' OCI_S3 ' }), 'oci_s3');
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: 's3' }), 'aliyun_oss');
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: 'oci' }), 'aliyun_oss');
});

test('createServiceConfig wires STORAGE_BACKEND / OCI_S3_* into the config', () => {
  const envKeys = ['STORAGE_BACKEND', ...Object.keys(OCI_S3_ENV)];
  const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) delete process.env[key];
    assert.equal(createServiceConfig().storageBackend, 'aliyun_oss');

    process.env.STORAGE_BACKEND = 'oci_s3';
    for (const [key, value] of Object.entries(OCI_S3_ENV)) process.env[key] = value;
    const config = createServiceConfig();
    assert.equal(config.storageBackend, 'oci_s3');
    assert.equal(config.ociS3.bucket, 'example-storage');
    assert.equal(config.ociS3.region, 'ap-tokyo-1');
    assert.ok(config.ociS3.endpoint.includes('compat.objectstorage'));
    assert.equal(config.ociS3.multipartThresholdBytes, config.oss.multipartThresholdBytes);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('bare object key helpers keep their structure', () => {
  const storage = createOssStorage(ociStorageConfig());
  assert.equal(storage.rawPdfObjectKey('abc-123'), 'raw/pdf/abc-123.pdf');
  assert.equal(storage.htmlArtifactObjectKey('abc-123', 'slide_1'), 'artifact/pdf/abc-123/html/slide_1.html');
  assert.equal(storage.backend, 'oci_s3');
});

test('oci_s3 uploadHtmlArtifact PUTs the original bare key and returns it', async () => {
  const fake = createFakeS3Client();
  const storage = createOssStorage(ociStorageConfig(), { ociCreateClient: async () => fake });
  const objectKey = await storage.uploadHtmlArtifact('pdf-1', 'slide_2', '<html>hi</html>');
  assert.equal(objectKey, 'artifact/pdf/pdf-1/html/slide_2.html');
  assert.deepEqual(fake.commands.map((command) => command.constructor.name), ['PutObjectCommand']);
  assert.equal(fake.commands[0].input.Bucket, 'example-storage');
  assert.equal(fake.commands[0].input.Key, 'artifact/pdf/pdf-1/html/slide_2.html');
  assert.equal(fake.commands[0].input.ContentType, 'text/html; charset=utf-8');
});

test('oci_s3 uploadRawPdf uses multipart above the threshold and keeps the bare key', async () => {
  const fake = createFakeS3Client({ headNotFound: true });
  const storage = createOssStorage(ociStorageConfig(), { ociCreateClient: async () => fake });
  const buffer = Buffer.alloc(1024 * 2 + 512, 9); // 3 parts at 1KiB part size
  const progress = [];
  const objectKey = await storage.uploadRawPdf('pdf-2', buffer, {
    onProgress: (event) => progress.push(event),
  });
  assert.equal(objectKey, 'raw/pdf/pdf-2.pdf');
  assert.deepEqual(
    fake.commands.map((command) => command.constructor.name),
    [
      'HeadObjectCommand',
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
    ]
  );
  assert.equal(fake.commands[1].input.Bucket, 'example-storage');
  assert.equal(fake.commands[1].input.Key, 'raw/pdf/pdf-2.pdf');
  const complete = fake.commands[5].input;
  assert.deepEqual(
    complete.MultipartUpload.Parts.map((part) => part.PartNumber),
    [1, 2, 3]
  );
  assert.equal(progress[progress.length - 1].percentage, 1);
});

test('oci_s3 uploadRawPdf skips the upload when the object already exists', async () => {
  const fake = createFakeS3Client(); // HeadObjectCommand resolves → object exists
  const storage = createOssStorage(ociStorageConfig(), { ociCreateClient: async () => fake });
  const objectKey = await storage.uploadRawPdf('pdf-3', Buffer.from('pdf'));
  assert.equal(objectKey, 'raw/pdf/pdf-3.pdf');
  assert.deepEqual(fake.commands.map((command) => command.constructor.name), ['HeadObjectCommand']);
});

test('oci_s3 downloadRawPdf returns the object buffer', async () => {
  const fake = createFakeS3Client();
  const storage = createOssStorage(ociStorageConfig(), { ociCreateClient: async () => fake });
  const buffer = await storage.downloadRawPdf('pdf-4');
  assert.ok(Buffer.isBuffer(buffer));
  assert.deepEqual([...buffer], [1, 2, 3]);
  assert.equal(fake.commands[0].input.Key, 'raw/pdf/pdf-4.pdf');
});

test('oci_s3 with missing OCI env fails with a config error listing the missing vars', async () => {
  const storage = createOssStorage({ storageBackend: 'oci_s3', oss: {}, ociS3: { bucket: 'example-storage' } });
  await assert.rejects(
    () => storage.uploadHtmlArtifact('pdf-5', 'slide_1', '<html/>'),
    /OCI S3 storage is not configured: missing endpoint, accessKeyId, secretKey, region/
  );
});

test('default backend (aliyun_oss) keeps requiring the legacy OSS config', async () => {
  const storage = createOssStorage({ oss: {} });
  assert.equal(storage.backend, 'aliyun_oss');
  await assert.rejects(
    () => storage.uploadHtmlArtifact('pdf-6', 'slide_1', '<html/>'),
    /OSS is not configured: missing bucket, accessKeyId, accessKeySecret/
  );
});

test('createPdfId stays the md5 of the buffer (bare-key input unchanged)', () => {
  const storage = createOssStorage(ociStorageConfig());
  const pdfId = storage.createPdfId(Buffer.from('hello pdf'));
  assert.match(pdfId, /^[0-9a-f]{32}$/);
  assert.equal(storage.rawPdfObjectKey(pdfId), `raw/pdf/${pdfId}.pdf`);
});
