// SPDX-License-Identifier: AGPL-3.0-only
// Object storage capability port. The interface mirrors the platform backend's
// CloudStorage abstraction (the surface the courseware, interaction, pdf2html,
// and pptx2html services all consume today). Two aspects are contractual and
// must not drift: presigned URL formats (byte-level, locked by golden tests in
// the backend) and the error discipline — implementations catch SDK/network
// errors, log them, and return false/null/[] instead of throwing.

import { createProviderRegistry, PortNotConfiguredError, type ProviderRegistry } from '@ainobi/port-kit';

/**
 * Kinds of the built-in implementations (@ainobi/storage-impl). The registry accepts any string, so a third party
 * registers its own kind without extending this list.
 */
export const StorageProviderKind = {
  ALIYUN_OSS: 'aliyun_oss',
  OCI_S3: 'oci_s3',
} as const;
export type StorageProviderKind = (typeof StorageProviderKind)[keyof typeof StorageProviderKind];

export interface StoredObject {
  key: string;
  size?: number;
  last_modified?: string;
  [key: string]: unknown;
}

/**
 * The storage client contract. All presign methods take an expiry in seconds;
 * `inBucket` variants target a bucket other than the configured default.
 */

export interface StorageProvider {
  getPresignedUrlForUpload(key: string, expires: number, contentType?: string): Promise<string>;
  getPresignedUrlForUploadInBucket(
    bucket: string,
    key: string,
    expires: number,
    contentType?: string,
  ): Promise<string>;
  getPresignedUrlForDownload(key: string, expires: number): Promise<string>;

  uploadFile(key: string, content: Buffer, contentType?: string): Promise<boolean>;
  uploadFileInBucket(
    bucket: string,
    key: string,
    content: Buffer,
    contentType?: string,
  ): Promise<boolean>;
  downloadFile(key: string): Promise<Buffer | null>;

  deleteFile(key: string): Promise<boolean>;
  deleteFileFromBucket(bucket: string, key: string): Promise<boolean>;

  listObjects(prefix: string): Promise<StoredObject[]>;

  copyObject(sourceKey: string, targetKey: string): Promise<boolean>;
  setPublicAccess(key: string, isPublic: boolean): Promise<boolean>;
}

/** Thrown by the default provider and by registry misses. */
export { PROVIDER_NOT_CONFIGURED } from '@ainobi/port-kit';
export { PortNotConfiguredError };
export type { ProviderRegistry };

/** This port's not-configured error; `instanceof PortNotConfiguredError` catches every port's. */
export class ProviderNotConfiguredError extends PortNotConfiguredError {
  constructor(kind: string) {
    super('Storage provider', kind);
  }
}

/** The throwing default. */
export class UnconfiguredStorageProvider implements StorageProvider {
  constructor(private readonly kind: string) {}
  async getPresignedUrlForUpload(): Promise<string> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async getPresignedUrlForUploadInBucket(): Promise<string> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async getPresignedUrlForDownload(): Promise<string> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async uploadFile(): Promise<boolean> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async uploadFileInBucket(): Promise<boolean> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async downloadFile(): Promise<Buffer | null> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async deleteFile(): Promise<boolean> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async deleteFileFromBucket(): Promise<boolean> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async listObjects(): Promise<StoredObject[]> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async copyObject(): Promise<boolean> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async setPublicAccess(): Promise<boolean> {
    throw new ProviderNotConfiguredError(this.kind);
  }
}

/**
 * Creates a provider registry owned by the caller — for hosts that keep several configurations
 * in one process, or that avoid module-level state. Unregistered kinds resolve to the throwing
 * default.
 */
export function createStorageProviderRegistry(): ProviderRegistry<StorageProvider> {
  return createProviderRegistry<StorageProvider>((kind) => new UnconfiguredStorageProvider(kind));
}

/** The process-wide default registry behind the functions below. */
const defaultRegistry = createStorageProviderRegistry();

/** Register an implementation for a kind at the composition root. */
export function registerStorageProvider(kind: string, provider: StorageProvider): void {
  defaultRegistry.register(kind, provider);
}

/** Test hook: drop one kind (or the whole registry). */
export function unregisterStorageProvider(kind?: string): void {
  defaultRegistry.unregister(kind);
}

/** Resolve a provider; an unregistered kind yields the throwing default. */
export function getStorageProvider(kind: string): StorageProvider {
  return defaultRegistry.get(kind);
}
