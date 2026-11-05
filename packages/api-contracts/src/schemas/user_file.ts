// SPDX-License-Identifier: AGPL-3.0-only
/**
 * User file domain schemas.
 */

import { z } from "zod";
import { UserFileSource, UserFileType, UserFileStatus } from "../enums/user_file.ts";
import { PaginationRequestSchema } from "./user.ts";
import { pyEnum, pyUuid } from "./helpers.ts";

/** Self-service file list query (GET /user/file/list) */
export const UserFileListRequestSchema = PaginationRequestSchema.extend({
  /** Fuzzy file name match */
  file_name: z.string().nullable().optional(),
  /** Coarse file type bucket */
  file_type: z.nativeEnum(UserFileType).nullable().optional(),
  /** Registration source */
  source: z.nativeEnum(UserFileSource).nullable().optional(),
});

/** Register an externally uploaded object as a user file (satellite service attachments) */
export const UserFileRegisterRequestSchema = z.object({
  file_name: z.string().min(1).max(255),
  // Required enum: pyEnum (missing → Field required; wrong value → production enum text)
  file_type: pyEnum(Object.values(UserFileType) as unknown as [string, ...string[]]),
  object_key: z.string().min(1).max(512),
  bucket_name: z.string().max(128).nullable().optional(),
  file_size: z.number().int().gt(0).lte(1024 ** 4),
  content_md5: z.string().max(64).nullable().optional(),
  org_id: pyUuid.nullable().optional(),
});

/** Registered file row info (response DTO; datetime fields are isoformat strings) */
export interface UserFileInfo {
  file_id: string;
  user_id: string;
  org_id: string | null;
  source: UserFileSource;
  file_type: string;
  file_name: string;
  object_key: string;
  bucket_name: string | null;
  /** Byte count (production outputs a JSON number; the DB bigint string is converted in the service layer) */
  file_size: number;
  ref_id: string | null;
  file_status: UserFileStatus;
  url: string;
  created_at: string;
  updated_at: string;
}

export type UserFileListRequest = z.infer<typeof UserFileListRequestSchema>;
export type UserFileRegisterRequest = z.infer<typeof UserFileRegisterRequestSchema>;
