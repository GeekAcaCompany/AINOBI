// SPDX-License-Identifier: AGPL-3.0-only
declare module "ali-oss" {
  interface OssClientOptions {
    region?: string;
    endpoint?: string;
    bucket?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    stsToken?: string;
    secure?: boolean;
    timeout?: string;
    enableProxy?: boolean;
    proxy?: string;
  }

  interface PutOptions {
    headers?: Record<string, string>;
    mime?: string;
  }

  interface MultipartUploadOptions extends PutOptions {
    parallel?: number;
    partSize?: number;
  }

  interface MultipartInitResult {
    uploadId: string;
    name?: string;
    res?: { headers?: Record<string, string> };
  }

  interface UploadPartResult {
    etag?: string;
    res?: { headers?: Record<string, string> };
  }

  interface MultipartPartDescriptor {
    number: number;
    etag: string;
  }

  export default class OSS {
    constructor(options: OssClientOptions);
    head(objectKey: string): Promise<unknown>;
    put(objectKey: string, content: Buffer | string, options?: PutOptions): Promise<unknown>;
    multipartUpload(objectKey: string, content: Buffer | string, options?: MultipartUploadOptions): Promise<unknown>;
    initMultipartUpload(objectKey: string, options?: PutOptions): Promise<MultipartInitResult>;
    uploadPart(
      objectKey: string,
      uploadId: string,
      partNo: number,
      chunk: Buffer | NodeJS.ReadableStream,
      start: number,
      end: number,
      options?: PutOptions,
    ): Promise<UploadPartResult>;
    completeMultipartUpload(
      objectKey: string,
      uploadId: string,
      parts: MultipartPartDescriptor[],
      options?: PutOptions,
    ): Promise<unknown>;
    abortMultipartUpload(objectKey: string, uploadId: string, options?: PutOptions): Promise<unknown>;
    copy(sourceKey: string, targetKey: string, options?: PutOptions): Promise<unknown>;
    delete(objectKey: string, options?: PutOptions): Promise<unknown>;
    signatureUrl(objectKey: string, options?: { expires?: number; method?: string }): string;
  }
}
