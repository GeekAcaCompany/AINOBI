// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bucketFromOciUrl,
  evidenceRankForCoursewarePresign,
  isAgentDirectOssObjectKey,
  publicBucketEchoUrlForCoursewarePresign,
  publicEchoUrlForCoursewarePresign,
} from './courseware-asset-presign.ts';

test('public/ 前缀 key:gate 放行(agent-direct 扩展)', () => {
  assert.equal(isAgentDirectOssObjectKey('public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json'), true);
});

// Since 2026-09-09 example-public went fully private (NoPublicAccess), so public echo URLs always 404;
// every object was copied to example-storage and the signObjectReadUrl signing path took over —
// echo always returns null (a test reverting to the old behavior counts as breaking the go-private contract).
test('public/ 前缀 key:私有桶证据 → null(echo 契约已废,签名路径接管)', () => {
  assert.equal(
    publicBucketEchoUrlForCoursewarePresign(
      'public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json',
      'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json',
    ),
    null,
  );
});

test('public/ 前缀 key:compat 证据 → null(echo 契约已废,签名路径接管)', () => {
  assert.equal(
    publicBucketEchoUrlForCoursewarePresign(
      'public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json',
      'https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-public/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json?X-Amz-Signature=abc',
    ),
    null,
  );
});

test('public/ 前缀 key:非 OCI 证据 → null(不能构造,走其他路径)', () => {
  assert.equal(
    publicBucketEchoUrlForCoursewarePresign(
      'public/live2d_models/x.model3.json',
      'https://example.com/public/live2d_models/x.model3.json',
    ),
    null,
  );
  assert.equal(publicBucketEchoUrlForCoursewarePresign('raw/mp3/x.mp3', undefined), null);
});

test('evidenceRank: aliyun 公开 CDN URL = 0(最强证据)', () => {
  assert.equal(
    evidenceRankForCoursewarePresign(
      'https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/mp3/0a3352a0.mp3',
    ),
    0,
  );
});

test('evidenceRank: OCI 公开桶 native/compat URL = 1', () => {
  assert.equal(
    evidenceRankForCoursewarePresign(
      'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-public/o/raw/mp3/5d61ee0e.mp3',
    ),
    1,
  );
  assert.equal(
    evidenceRankForCoursewarePresign(
      'https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-public/raw/mp3/5d61ee0e.mp3',
    ),
    1,
  );
});

test('evidenceRank: OCI 私有桶 URL = 2,裸 key = 3', () => {
  assert.equal(
    evidenceRankForCoursewarePresign(
      'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/wav/5e05b728.wav',
    ),
    2,
  );
  assert.equal(evidenceRankForCoursewarePresign('raw/mp3/0a3352a0.mp3'), 3);
});

test('evidenceRank: 桶名尾部 public/ 不误判为公开桶证据之外的情况', () => {
  // example-public bucket + the poisoned double public/o/ prefix form: still evidence of the public bucket (rank 1)
  assert.equal(
    evidenceRankForCoursewarePresign(
      'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-public/o/public/o/raw/mp3/x.mp3',
    ),
    1,
  );
});

// The aliyun access key is revoked and the bucket abandoned; every raw/ object is in example-storage, and the signing path takes over.
test('echo: aliyun 证据 → null(echo 契约已废)', () => {
  assert.equal(
    publicEchoUrlForCoursewarePresign(
      'raw/mp3/0a3352a0.mp3',
      'https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/mp3/0a3352a0.mp3',
    ),
    null,
  );
});

test('echo: OCI 公开桶证据 → null(echo 契约已废,签名路径接管)', () => {
  assert.equal(
    publicEchoUrlForCoursewarePresign(
      'raw/mp3/5d61ee0e.mp3',
      'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-public/o/raw/mp3/5d61ee0e.mp3',
    ),
    null,
  );
});

test('echo: 私有桶/裸 key/无证据 → null(走正常 presign)', () => {
  assert.equal(
    publicEchoUrlForCoursewarePresign(
      'raw/wav/5e05b728.wav',
      'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/wav/5e05b728.wav',
    ),
    null,
  );
  assert.equal(
    publicEchoUrlForCoursewarePresign('raw/wav/5e05b728.wav', 'raw/wav/5e05b728.wav'),
    null,
  );
  assert.equal(publicEchoUrlForCoursewarePresign('raw/wav/5e05b728.wav', undefined), null);
});

test('bucketFromOciUrl: native 与 compat 形态都取到桶名', () => {
  assert.equal(
    bucketFromOciUrl(
      'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-public/o/raw/mp3/x.mp3',
    ),
    'example-public',
  );
  assert.equal(
    bucketFromOciUrl(
      'https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/raw/wav/x.wav',
    ),
    'example-storage',
  );
});
