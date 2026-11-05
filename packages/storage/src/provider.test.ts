// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  getStorageProvider,
  registerStorageProvider,
  unregisterStorageProvider,
  type StorageProvider,
} from './provider.ts';

afterEach(() => {
  unregisterStorageProvider();
});

describe('the registry', () => {
  it('returns the throwing default for an unregistered kind', async () => {
    const provider = getStorageProvider('oci_s3');
    await expect(provider.getPresignedUrlForDownload('k', 60)).rejects.toThrowError(
      /not configured/,
    );
    await expect(provider.uploadFile('k', Buffer.alloc(0))).rejects.toThrowError(
      /not configured/,
    );
    await expect(provider.listObjects('prefix/')).rejects.toThrowError(/not configured/);
  });

  it('round-trips a registered implementation', async () => {
    const fake: StorageProvider = {
      async getPresignedUrlForUpload(key) {
        return `https://signed/${key}?upload`;
      },
      async getPresignedUrlForUploadInBucket(bucket, key) {
        return `https://signed/${bucket}/${key}?upload`;
      },
      async getPresignedUrlForDownload(key) {
        return `https://signed/${key}?download`;
      },
      async uploadFile(key, content) {
        return content.length > 0 && key !== '';
      },
      async uploadFileInBucket(_bucket, key, content) {
        return content.length > 0 && key !== '';
      },
      async downloadFile() {
        return null;
      },
      async deleteFile() {
        return true;
      },
      async deleteFileFromBucket() {
        return true;
      },
      async listObjects(prefix) {
        return [{ key: `${prefix}a.bin`, size: 3 }];
      },
      async copyObject() {
        return true;
      },
      async setPublicAccess() {
        return true;
      },
    };
    registerStorageProvider('aliyun_oss', fake);
    expect(getStorageProvider('aliyun_oss')).toBe(fake);
    await expect(
      getStorageProvider('aliyun_oss').getPresignedUrlForDownload('x/y.mp3', 600),
    ).resolves.toBe('https://signed/x/y.mp3?download');
    await expect(getStorageProvider('aliyun_oss').listObjects('p/')).resolves.toEqual([
      { key: 'p/a.bin', size: 3 },
    ]);
  });

  it('keeps kinds isolated', () => {
    expect(getStorageProvider('aliyun_oss')).not.toBe(getStorageProvider('oci_s3'));
  });
});
