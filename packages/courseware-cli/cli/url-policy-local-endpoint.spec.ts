// SPDX-License-Identifier: AGPL-3.0-only
// The asset allowlist compares whole URLs, so its compat prefix must carry the endpoint's real scheme.
import { describe, expect, it } from 'vitest';
import { runWithCliEnv } from './env.ts';
import { coursewareAssetUrlPrefixes, isAllowedCoursewareAssetUrl, isOciS3StorageUrl, ociS3CompatObjectBaseUrl } from './url-policy.ts';

const env = (endpoint: string) => ({
  STORAGE_BACKEND: 'oci_s3',
  OCI_S3_ENDPOINT: endpoint,
  OCI_S3_BUCKET: 'bucket',
  OCI_S3_REGION: 'local',
  OCI_S3_NAMESPACE: 'local',
  OCI_S3_ACCESS_KEY_ID: 'key',
  OCI_S3_SECRET_KEY: 'secret',
  AINOBI_STORAGE_LOCAL_ENDPOINT: 'true',
});

describe('an http:// storage endpoint', () => {
  const local = env('http://127.0.0.1:56390');

  it('is allowed under its own scheme', () => {
    runWithCliEnv(local, () => {
      expect(coursewareAssetUrlPrefixes()).toContain('http://127.0.0.1:56390/bucket');
      expect(isAllowedCoursewareAssetUrl('http://127.0.0.1:56390/bucket/raw/a.png')).toBe(true);
      expect(isAllowedCoursewareAssetUrl('https://127.0.0.1:56390/bucket/raw/a.png')).toBe(false);
    });
  });

  it('is recognized as storage and yields a compat base with that scheme', () => {
    runWithCliEnv(local, () => {
      expect(isOciS3StorageUrl('http://127.0.0.1:56390/bucket/raw/a.png')).toBe(true);
      expect(isOciS3StorageUrl('http://127.0.0.1:9999/bucket/raw/a.png')).toBe(false);
      expect(ociS3CompatObjectBaseUrl(null)).toBe('http://127.0.0.1:56390/bucket');
    });
  });
});

describe('an https:// or bare storage endpoint', () => {
  it('stays https', () => {
    for (const endpoint of ['https://ns.compat.objectstorage.r.oci.customer-oci.com', 'ns.compat.objectstorage.r.oci.customer-oci.com']) {
      runWithCliEnv(env(endpoint), () => {
        expect(ociS3CompatObjectBaseUrl(null)).toBe('https://ns.compat.objectstorage.r.oci.customer-oci.com/bucket');
      });
    }
  });
});

describe('an http:// storage endpoint without the explicit opt-in', () => {
  it('stays https', () => {
    runWithCliEnv({ ...env('http://127.0.0.1:56390'), AINOBI_STORAGE_LOCAL_ENDPOINT: undefined }, () => {
      expect(ociS3CompatObjectBaseUrl(null)).toBe('https://127.0.0.1:56390/bucket');
    });
  });
});
