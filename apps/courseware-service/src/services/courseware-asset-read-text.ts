// SPDX-License-Identifier: AGPL-3.0-only
import {
  readObjectText,
  type CoursewareStorageBackend,
} from "@ainobi/courseware-cli/cli/assets.ts";
import { isAwsS3ObjectKey } from "./courseware-asset-presign.ts";
import { readS3ObjectText } from "./aws-s3-presign.ts";

const DEFAULT_READ_TEXT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Server-side read of a small HTML/text courseware asset.
 * OSS: ali-oss SDK via `OSS_ENDPOINT` (VPC internal when configured).
 * S3: `@aws-sdk/client-s3` GetObject.
 * OCI: S3-compatible GetObject when `STORAGE_BACKEND=oci_s3` (or per-call `backend`).
 */
export async function readCoursewareAssetText(
  objectKey: string,
  maxBytes = DEFAULT_READ_TEXT_MAX_BYTES,
  options?: { backend?: CoursewareStorageBackend },
): Promise<string> {
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!key) {
    throw new Error("Missing object key.");
  }

  if (isAwsS3ObjectKey(key)) {
    return readS3ObjectText(key, maxBytes);
  }

  return readObjectText(key, maxBytes, options);
}
