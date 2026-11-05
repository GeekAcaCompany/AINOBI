// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generic file upload schemas.
 */

/** File upload response (POST /user/file/upload) */
export interface FileUploadResponse {
  /** File access URL (presigned) */
  url: string;
  file_id: string | null;
  file_name: string | null;
  file_size: number | null;
}
