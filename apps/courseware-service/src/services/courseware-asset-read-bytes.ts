// SPDX-License-Identifier: AGPL-3.0-only
import {
  readObjectBytes,
  type CoursewareStorageBackend,
} from "@ainobi/courseware-cli/cli/assets.ts";
import { isAwsS3ObjectKey } from "./courseware-asset-presign.ts";
import { readS3ObjectBytes } from "./aws-s3-presign.ts";

const DEFAULT_READ_BYTES_MAX = 20 * 1024 * 1024;

/** Read an OSS / S3 / OCI (S3-compatible) object as binary (for PDF/PPTX/images). */
export async function readCoursewareAssetBytes(
  objectKey: string,
  maxBytes = DEFAULT_READ_BYTES_MAX,
  options?: { backend?: CoursewareStorageBackend },
): Promise<Buffer> {
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) {
    throw new Error("Missing object key.");
  }
  if (isAwsS3ObjectKey(key)) {
    return readS3ObjectBytes(key, maxBytes);
  }
  return readObjectBytes(key, maxBytes, options);
}
