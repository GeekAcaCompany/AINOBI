// SPDX-License-Identifier: AGPL-3.0-only
// Request-pipeline types the route machinery shares with its host server.

/** A multipart file field (spilled to disk when large). */
export interface UploadedFile {
  readonly fieldname: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  /** Read the whole content (large files are read fully into memory — switch to streaming when needed) */
  read(): Promise<Buffer>;
  /** Temp file cleanup (when spilled to disk) */
  cleanup(): Promise<void>;
}

/** Per-request log fields; the auth guard fills in the user and org. */
export type HttpRequestLogContext = {
  method: string;
  pathname: string;
  url?: string;
  userId?: string;
  orgId?: string;
};
