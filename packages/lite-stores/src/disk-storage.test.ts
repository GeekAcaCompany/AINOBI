// SPDX-License-Identifier: AGPL-3.0-only
// Drives the server with the real AWS SDK and with the raw HTTP requests a browser makes.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDiskStorage, type DiskStorageServer } from './disk-storage.ts';

const BUCKET = 'test-bucket';
let dir: string;
let server: DiskStorageServer;
let s3: S3Client;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lite-storage-'));
  server = await startDiskStorage({ dir });
  s3 = new S3Client({
    region: 'local',
    endpoint: server.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'lite', secretAccessKey: 'lite' },
  });
});

afterAll(async () => {
  s3.destroy();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const body = async (key: string): Promise<string> => {
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return (await response.Body?.transformToString()) ?? '';
};

describe('objects', () => {
  it('stores an object as a plain file with its content type', async () => {
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: 'raw/pdf/a.txt', Body: 'hello', ContentType: 'text/plain' }),
    );
    expect(readFileSync(join(dir, BUCKET, 'raw', 'pdf', 'a.txt'), 'utf8')).toBe('hello');
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'raw/pdf/a.txt' }));
    expect(head.ContentType).toBe('text/plain');
    expect(head.ContentLength).toBe(5);
    expect(await body('raw/pdf/a.txt')).toBe('hello');
  });

  it('answers NoSuchKey for a missing object and for a key prefix', async () => {
    await expect(s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'missing' }))).rejects.toMatchObject({
      name: 'NoSuchKey',
    });
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'prefix/child', Body: 'x' }));
    await expect(s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'prefix' }))).rejects.toMatchObject({
      name: 'NoSuchKey',
    });
  });

  it('keeps binary bodies intact and overwrites', async () => {
    const bytes = randomBytes(256 * 1024);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'bin/data', Body: bytes }));
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'bin/data' }));
    expect(Buffer.compare(Buffer.from((await response.Body?.transformToByteArray()) as Uint8Array), bytes)).toBe(0);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'bin/data', Body: 'short' }));
    expect(await body('bin/data')).toBe('short');
  });

  it('round-trips keys a file system would refuse', async () => {
    const key = 'odd/日本語 file:with*chars?.png';
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'odd' }));
    expect(await body(key)).toBe('odd');
    const reserved = 'odd/CON.txt';
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: reserved, Body: 'reserved' }));
    expect(await body(reserved)).toBe('reserved');
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'odd/' }));
    expect(listed.Contents?.map((object) => object.Key).sort()).toEqual([reserved, key].sort());
  });

  it('cannot be walked out of the root', async () => {
    // %2F survives URL normalization on both ends, so the server sees the dots itself.
    const dotted = await fetch(`${server.endpoint}/${BUCKET}/a%2F..%2F..%2F..%2Fescaped`, { method: 'PUT', body: 'nope' });
    expect(dotted.status).toBe(400);
    expect(existsSync(join(dir, '..', 'escaped'))).toBe(false);
    const bucketDotted = await fetch(`${server.endpoint}/..%2Fescaped`, { method: 'PUT', body: 'nope' });
    expect(bucketDotted.status).toBe(400);
    // A backslash is only a character in a key, including where it is a separator.
    const backslash = await fetch(`${server.endpoint}/${BUCKET}/b%5C..%5C..%5C..%5Cescaped`, { method: 'PUT', body: 'kept' });
    expect(backslash.status).toBe(200);
    expect(existsSync(join(dir, '..', 'escaped'))).toBe(false);
    expect(await body('b\\..\\..\\..\\escaped')).toBe('kept');
  });

  it('copies with metadata and deletes idempotently', async () => {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'copy/src', Body: 'copied', ContentType: 'text/x-src' }));
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: 'copy/dst', CopySource: `${BUCKET}/copy/src` }));
    expect(await body('copy/dst')).toBe('copied');
    expect((await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'copy/dst' }))).ContentType).toBe('text/x-src');
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: 'copy/dst' }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: 'copy/dst' }));
    expect(existsSync(join(dir, BUCKET, 'copy', 'dst'))).toBe(false);
    expect(await body('copy/src')).toBe('copied');
  });

  it('accepts ACL changes as a no-op', async () => {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'acl/x', Body: 'x' }));
    await s3.send(new PutObjectAclCommand({ Bucket: BUCKET, Key: 'acl/x', ACL: 'public-read' }));
  });

  it('decodes aws-chunked bodies', async () => {
    const framed = '5;chunk-signature=abc\r\nhello\r\n6;chunk-signature=def\r\n world\r\n0;chunk-signature=ghi\r\n\r\n';
    const response = await fetch(`${server.endpoint}/${BUCKET}/chunked/x`, {
      method: 'PUT',
      headers: { 'x-amz-content-sha256': 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD' },
      body: framed,
    });
    expect(response.status).toBe(200);
    expect(await body('chunked/x')).toBe('hello world');
  });
});

describe('listing', () => {
  it('pages through keys in order under a prefix', async () => {
    for (const name of ['c', 'a', 'b/nested', 'd']) {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `list/${name}`, Body: 'x' }));
    }
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'listother', Body: 'x' }));
    const first = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'list/', MaxKeys: 2 }));
    expect(first.Contents?.map((object) => object.Key)).toEqual(['list/a', 'list/b/nested']);
    expect(first.IsTruncated).toBe(true);
    const second = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'list/', MaxKeys: 2, ContinuationToken: first.NextContinuationToken }),
    );
    expect(second.Contents?.map((object) => object.Key)).toEqual(['list/c', 'list/d']);
    expect(second.IsTruncated).toBe(false);
    expect(second.Contents?.[0]?.Size).toBe(1);
  });

  it('never lists bookkeeping files', async () => {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: '.lite' })).catch((error: Error) => error);
    expect(listed).toBeInstanceOf(Error);
  });
});

describe('multipart', () => {
  it('assembles parts in the listed order', async () => {
    const key = 'multipart/video.mp4';
    const { UploadId } = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: 'video/mp4' }),
    );
    const parts = await Promise.all(
      ['first-', 'second-', 'third'].map(async (Body, index) => {
        const PartNumber = index + 1;
        const { ETag } = await s3.send(
          new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId, PartNumber, Body }),
        );
        return { PartNumber, ETag };
      }),
    );
    const done = await s3.send(
      new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId, MultipartUpload: { Parts: parts } }),
    );
    expect(done.ETag).toMatch(/-3"$/);
    expect(await body(key)).toBe('first-second-third');
    expect((await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))).ContentType).toBe('video/mp4');
  });

  it('abort leaves no object behind', async () => {
    const key = 'multipart/aborted';
    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key }));
    await s3.send(new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId, PartNumber: 1, Body: 'x' }));
    await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId }));
    await expect(
      s3.send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: 'x' }] } })),
    ).rejects.toMatchObject({ name: 'NoSuchUpload' });
    await expect(s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))).rejects.toThrow();
  });
});

describe('what a browser does', () => {
  it('reads through a presigned URL with range and disposition', async () => {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'presigned/video', Body: '0123456789', ContentType: 'video/mp4' }));
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: 'presigned/video', ResponseContentDisposition: 'attachment; filename="v.mp4"' }),
      { expiresIn: 60 },
    );
    const whole = await fetch(url);
    expect(await whole.text()).toBe('0123456789');
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('content-disposition')).toBe('attachment; filename="v.mp4"');
    expect(whole.headers.get('access-control-allow-origin')).toBe('*');

    const part = await fetch(url, { headers: { range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('234');
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    const suffix = await fetch(url, { headers: { range: 'bytes=-3' } });
    expect(await suffix.text()).toBe('789');
    const beyond = await fetch(url, { headers: { range: 'bytes=99-' } });
    expect(beyond.status).toBe(416);
  });

  it('refuses an expired link', async () => {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'presigned/old', Body: 'x' }));
    const url = new URL(await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: 'presigned/old' }), { expiresIn: 60 }));
    url.searchParams.set('X-Amz-Date', '20200101T000000Z');
    const response = await fetch(url);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('expired');
  });

  it('accepts a presigned PUT', async () => {
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: 'presigned/put' }), { expiresIn: 60 });
    const response = await fetch(url, { method: 'PUT', body: 'uploaded', headers: { 'content-type': 'text/plain' } });
    expect(response.status).toBe(200);
    expect(await body('presigned/put')).toBe('uploaded');
  });

  const policyFor = (conditions: unknown[], expiration = '2999-01-01T00:00:00Z'): string =>
    Buffer.from(JSON.stringify({ expiration, conditions })).toString('base64');

  const postForm = (fields: Record<string, string>, file: Blob, filename = 'local.bin'): Promise<Response> => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append('file', file, filename);
    return fetch(`${server.endpoint}/${BUCKET}`, { method: 'POST', body: form });
  };

  it('accepts a presigned POST, taking the content type from the form field', async () => {
    const bytes = randomBytes(300 * 1024);
    const response = await postForm(
      {
        'Content-Type': 'image/png',
        key: 'post/image.png',
        policy: policyFor([{ 'Content-Type': 'image/png' }, { bucket: BUCKET }, { key: 'post/image.png' }]),
      },
      new Blob([bytes], { type: 'application/octet-stream' }),
    );
    expect(response.status).toBe(204);
    const stored = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'post/image.png' }));
    expect(stored.ContentType).toBe('image/png');
    expect(Buffer.compare(Buffer.from((await stored.Body?.transformToByteArray()) as Uint8Array), bytes)).toBe(0);
  });

  it('keeps a file whose bytes look like the boundary framing', async () => {
    const tricky = Buffer.from('line\r\n--notTheBoundary\r\n\r\nmore\r\n--');
    const response = await postForm({ key: 'post/tricky' }, new Blob([tricky]));
    expect(response.status).toBe(204);
    const stored = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'post/tricky' }));
    expect(Buffer.from((await stored.Body?.transformToByteArray()) as Uint8Array).equals(tricky)).toBe(true);
  });

  it('fills ${filename} and honours starts-with', async () => {
    const response = await postForm(
      { key: 'post/dir/${filename}', policy: policyFor([['starts-with', '$key', 'post/dir/']]) },
      new Blob(['named']),
      'named.txt',
    );
    expect(response.status).toBe(204);
    expect(await body('post/dir/named.txt')).toBe('named');
  });

  it('rejects uploads outside the policy and leaves nothing behind', async () => {
    const wrongKey = await postForm(
      { key: 'post/other', policy: policyFor([{ key: 'post/expected' }]) },
      new Blob(['x']),
    );
    expect(wrongKey.status).toBe(403);
    const expired = await postForm(
      { key: 'post/late', policy: policyFor([{ key: 'post/late' }], '2020-01-01T00:00:00Z') },
      new Blob(['x']),
    );
    expect(expired.status).toBe(403);
    expect(existsSync(join(dir, BUCKET, 'post', 'other'))).toBe(false);
    expect(existsSync(join(dir, BUCKET, 'post', 'late'))).toBe(false);
  });

  it('answers a CORS preflight', async () => {
    const response = await fetch(`${server.endpoint}/${BUCKET}/x`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
        'access-control-request-private-network': 'true',
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
  });
});

describe('persistence', () => {
  it('serves what an earlier server stored', async () => {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'persist/x', Body: 'kept', ContentType: 'text/kept' }));
    const again = await startDiskStorage({ dir });
    try {
      const response = await fetch(`${again.endpoint}/${BUCKET}/persist/x`);
      expect(await response.text()).toBe('kept');
      expect(response.headers.get('content-type')).toBe('text/kept');
    } finally {
      await again.close();
    }
  });
});
