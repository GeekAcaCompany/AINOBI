// SPDX-License-Identifier: AGPL-3.0-only
// An S3-compatible endpoint configured as http:// (a local store on a plain address). The https forms
// are locked byte for byte by provider.test.ts; these tests pin that only an explicit http:// changes.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AwsS3StorageClient,
  configureCloudStorage,
  normalizeS3ObjectKey,
  parseS3BucketKey,
} from './provider.ts';
import { buildS3PresignedGetUrl, buildS3PresignedPostUrl } from './signing.ts';

const LOCAL = 'http://127.0.0.1:56390';
const signing = {
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  region: 'local',
  bucketName: 'bucket',
  objectKey: 'raw/a.png',
  expiresInSeconds: 60,
  now: new Date('2026-01-01T00:00:00Z'),
};

afterEach(() => {
  configureCloudStorage({});
});

describe('presigning', () => {
  it('keeps http for an http:// endpoint, with the host as the signed host', () => {
    const url = buildS3PresignedGetUrl({ ...signing, endpointUrl: LOCAL, plainHttp: true });
    expect(url.startsWith(`${LOCAL}/bucket/raw/a.png?`)).toBe(true);
    const post = buildS3PresignedPostUrl({ ...signing, endpointUrl: LOCAL, plainHttp: true, fields: {}, conditions: [] });
    expect(post.url).toBe(`${LOCAL}/bucket`);
  });

  it('signs the same for http and https: the scheme is not part of a signature', () => {
    const signature = (url: string): string | null => new URL(url).searchParams.get('X-Amz-Signature');
    expect(signature(buildS3PresignedGetUrl({ ...signing, endpointUrl: LOCAL, plainHttp: true }))).toBe(
      signature(buildS3PresignedGetUrl({ ...signing, endpointUrl: 'https://127.0.0.1:56390' })),
    );
  });

  it('stays https for an https:// endpoint and for a bare host', () => {
    for (const endpointUrl of ['https://store.example.com', 'store.example.com']) {
      expect(buildS3PresignedGetUrl({ ...signing, endpointUrl }).startsWith('https://store.example.com/bucket/')).toBe(true);
      expect(buildS3PresignedPostUrl({ ...signing, endpointUrl, fields: {}, conditions: [] }).url).toBe(
        'https://store.example.com/bucket',
      );
    }
  });
});

describe('object URLs on the configured endpoint', () => {
  const configure = (endpoint: string): void =>
    configureCloudStorage({ cloud_storage_provider: 'aws_s3', aws_s3_endpoint_url: endpoint, aws_s3_bucket_name: 'bucket', aws_s3_local_endpoint: true });

  it('builds path-style URLs on an http:// endpoint', async () => {
    configure(LOCAL);
    const client = new AwsS3StorageClient();
    expect(await client.getObjectUrl('raw/a.png')).toBe(`${LOCAL}/bucket/raw/a.png`);
    expect(await client.getObjectUrlFromBucket('raw/a.png', 'other')).toBe(`${LOCAL}/other/raw/a.png`);
  });

  it('keeps virtual-host URLs on an https:// endpoint', async () => {
    configure('https://store.example.com');
    expect(await new AwsS3StorageClient().getObjectUrl('raw/a.png')).toBe('https://bucket.store.example.com/raw/a.png');
  });

  it('reads the key back out of a URL on the endpoint', () => {
    configure(LOCAL);
    expect(parseS3BucketKey(`${LOCAL}/bucket/raw/a%20b.png?X-Amz-Signature=x`)).toEqual(['bucket', 'raw/a b.png']);
    expect(normalizeS3ObjectKey(`${LOCAL}/bucket/raw/a.png`)).toBe('raw/a.png');
  });

  it('does not treat other hosts as the endpoint', () => {
    configure(LOCAL);
    expect(parseS3BucketKey('http://127.0.0.1:9999/bucket/raw/a.png')).toEqual(['bucket', null]);
    configure('');
    expect(parseS3BucketKey('http://127.0.0.1:56390/bucket/raw/a.png')).toEqual(['bucket', null]);
  });
});

describe('without the explicit opt-in', () => {
  it('an http:// endpoint keeps every https form', async () => {
    configureCloudStorage({ cloud_storage_provider: 'aws_s3', aws_s3_endpoint_url: LOCAL, aws_s3_bucket_name: 'bucket' });
    expect(buildS3PresignedGetUrl({ ...signing, endpointUrl: LOCAL }).startsWith('https://127.0.0.1:56390/bucket/')).toBe(true);
    expect(buildS3PresignedPostUrl({ ...signing, endpointUrl: LOCAL, fields: {}, conditions: [] }).url).toBe('https://127.0.0.1:56390/bucket');
    const client = new AwsS3StorageClient();
    expect(await client.getObjectUrl('raw/a.png')).toBe('https://bucket.127.0.0.1:56390/raw/a.png');
    expect(parseS3BucketKey(`${LOCAL}/bucket/raw/a.png`)).toEqual(['bucket', null]);
    expect(normalizeS3ObjectKey(`${LOCAL}/bucket/raw/a.png`)).toBe(`${LOCAL}/bucket/raw/a.png`);
  });

  it('an https:// endpoint with the opt-in on keeps every https form too', async () => {
    configureCloudStorage({ cloud_storage_provider: 'aws_s3', aws_s3_endpoint_url: 'https://store.example.com', aws_s3_bucket_name: 'bucket', aws_s3_local_endpoint: true });
    expect(await new AwsS3StorageClient().getObjectUrl('raw/a.png')).toBe('https://bucket.store.example.com/raw/a.png');
    expect(parseS3BucketKey('https://store.example.com/bucket/raw/a.png')).toEqual(['bucket', null]);
  });
});
