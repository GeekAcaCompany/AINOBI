// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course knowledge-base file domain schemas (the parts the course_section routes reference;
 * the other request/response schemas live with the upload flow and the services layer).
 */

import { z } from "zod";
import { CourseKnowledgeFileStatus, CourseKnowledgeFileType } from "../enums/course_knowledge_file.ts";
import { PaginationRequestSchema, isoDatetime } from "./user.ts";
import { pyBool, pyBoolRequired, pyUuid } from "./helpers.ts";

// ---------------------------------------------------------------------------
// CourseKnowledgeFileInfo
// ---------------------------------------------------------------------------

export const CourseKnowledgeFileInfoSchema = z
  .object({
    file_id: pyUuid,
    file_status: z.nativeEnum(CourseKnowledgeFileStatus),
    file_type: z.nativeEnum(CourseKnowledgeFileType),
    file_name: z.string(),
    /** pg bigint: production outputs a JSON number — the TS entity holds a string, the DTO layer converts to a number */
    file_size: z.number().int(),
    file_md5: z.string(),
    file_url: z.string(),
    file_text_content: z.string().nullable().optional(),
    file_summary: z.string().nullable().optional(),
    file_keywords: z.string().nullable().optional(),
    course_id: pyUuid,
    org_id: pyUuid,
    remark: z.string().nullable().optional(),
    sort: z.number().int().nullable().optional(),
    file_page_count: z.number().int().nullable().optional(),
    duration_seconds: z.number().int().nullable().optional(),
    allow_student_download: z.boolean().default(true),
    /** Filled from the join table only when querying by section */
    is_primary: z.boolean().nullable().optional(),
    created_by: pyUuid.nullable().optional(),
    updated_by: pyUuid.nullable().optional(),
    processed_at: isoDatetime.nullable().optional(),
    updated_at: isoDatetime,
    created_at: isoDatetime,
  })
  .passthrough();

export type CourseKnowledgeFileInfo = z.infer<typeof CourseKnowledgeFileInfoSchema>;

// ---------------------------------------------------------------------------
// Section bind / unbind responses
// ---------------------------------------------------------------------------

export const AssociateKnowledgeFilesResponseSchema = z.object({
  associated_count: z.number().int(),
  skipped_count: z.number().int(),
  failed_count: z.number().int(),
  associated_file_ids: z.array(pyUuid),
  skipped_file_ids: z.array(pyUuid),
  failed_file_ids: z.array(pyUuid),
});

export const DisassociateKnowledgeFilesResponseSchema = z.object({
  disassociated_count: z.number().int(),
  skipped_count: z.number().int(),
  failed_count: z.number().int(),
  disassociated_file_ids: z.array(pyUuid),
  skipped_file_ids: z.array(pyUuid),
  failed_file_ids: z.array(pyUuid),
});

export type AssociateKnowledgeFilesResponse = z.infer<typeof AssociateKnowledgeFilesResponseSchema>;
export type DisassociateKnowledgeFilesResponse = z.infer<typeof DisassociateKnowledgeFilesResponseSchema>;

// ---------------------------------------------------------------------------
// Agent catalog / text chunks (lookup route responses)
// ---------------------------------------------------------------------------

export const SectionKnowledgeAgentCatalogItemSchema = z.object({
  file_id: pyUuid,
  file_name: z.string(),
  file_type: z.string(),
  file_summary: z.string().nullable().optional(),
  file_text_length: z.number().int().default(0),
  is_primary: z.boolean().default(false),
  sort: z.number().int().default(0),
});

export const SectionKnowledgeAgentCatalogResponseSchema = z.object({
  section_id: pyUuid,
  course_id: pyUuid,
  org_id: pyUuid,
  files: z.array(SectionKnowledgeAgentCatalogItemSchema).default([]),
});

export const SectionKnowledgeTextSliceResponseSchema = z.object({
  file_id: pyUuid,
  section_id: pyUuid,
  offset: z.number().int(),
  limit: z.number().int(),
  total_length: z.number().int(),
  text: z.string(),
  next_offset: z.number().int().nullable().optional(),
});

export type SectionKnowledgeAgentCatalogItem = z.infer<typeof SectionKnowledgeAgentCatalogItemSchema>;
export type SectionKnowledgeAgentCatalogResponse = z.infer<typeof SectionKnowledgeAgentCatalogResponseSchema>;
export type SectionKnowledgeTextSliceResponse = z.infer<typeof SectionKnowledgeTextSliceResponseSchema>;

// ---------------------------------------------------------------------------
// course_knowledge_file route family request schemas
// 
// ---------------------------------------------------------------------------

/** Course knowledge file list query */
export const CourseKnowledgeFileListRequestSchema = PaginationRequestSchema.extend({
  file_name: z.string().nullable().optional(),
  file_status: z.nativeEnum(CourseKnowledgeFileStatus).nullable().optional(),
  /**
   * Comma-separated statuses. Note production passes the whole string straight to in_() —
   * in_ refuses a bare string (ArgumentError) → 500 DATABASE_ERROR;
   * the TS side reproduces that 500 (locked by parity; do not "fix" it).
   */
  file_statuses: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type CourseKnowledgeFileListRequest = z.infer<typeof CourseKnowledgeFileListRequestSchema>;

/** Knowledge file metadata update (None = not updated; on a file_name conflict the server appends a sequence suffix) */
export const CourseKnowledgeFileUpdateRequestSchema = z.object({
  file_name: z.string().min(1).max(100).optional().nullable(),
  file_type: z.nativeEnum(CourseKnowledgeFileType).optional().nullable(),
  file_status: z.nativeEnum(CourseKnowledgeFileStatus).optional().nullable(),
  file_text_content: z.string().optional().nullable(),
  file_summary: z.string().optional().nullable(),
  file_keywords: z.string().optional().nullable(),
  remark: z.string().max(1000).optional().nullable(),
  sort: z.coerce.number().int().min(0).optional().nullable(),
  allow_student_download: pyBool().optional().nullable(),
});

export type CourseKnowledgeFileUpdateRequest = z.infer<typeof CourseKnowledgeFileUpdateRequestSchema>;

/** Direct upload presign parameters (single file) */
export const CourseKnowledgeFileUploadParamsRequestSchema = z.object({
  file_name: z.string().min(1).max(255),
  file_size: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1),
  ),
  content_type: z.string(),
  file_id: z.string().optional().nullable(),
});

export type CourseKnowledgeFileUploadParamsRequest = z.infer<
  typeof CourseKnowledgeFileUploadParamsRequestSchema
>;

/** Direct upload presign parameters (batch item) */
export const CourseKnowledgeFileUploadParamsItemSchema = z.object({
  file_name: z.string().min(1).max(255),
  file_size: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1),
  ),
  content_type: z.string(),
  allow_student_download: pyBoolRequired().default(true),
});

export type CourseKnowledgeFileUploadParamsItem = z.infer<
  typeof CourseKnowledgeFileUploadParamsItemSchema
>;

/** Direct upload presign parameters (batch) */
export const CourseKnowledgeFileBatchUploadParamsRequestSchema = z.object({
  files: z
    .array(CourseKnowledgeFileUploadParamsItemSchema)
    .min(1, { message: "List should have at least 1 item after validation, not 0" })
    .max(20, {
      message: "List should have at most 20 items after validation, not 20",
    }),
});

export type CourseKnowledgeFileBatchUploadParamsRequest = z.infer<
  typeof CourseKnowledgeFileBatchUploadParamsRequestSchema
>;

/** Direct upload confirmation (single file; persists the row + commits the pre-reserved bytes) */
export const CourseKnowledgeFileConfirmUploadRequestSchema = z.object({
  file_path: z.string(),
  lock_id: pyUuid,
  file_name: z.string().min(1).max(255),
  file_size: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1),
  ),
  file_md5: z.string().nullable().optional().default(""),
  file_id: z.string().optional().nullable(),
  allow_student_download: pyBoolRequired().default(true),
  duration_seconds: z.coerce.number().int().min(0).optional().nullable(),
});

export type CourseKnowledgeFileConfirmUploadRequest = z.infer<
  typeof CourseKnowledgeFileConfirmUploadRequestSchema
>;

/** Direct upload confirmation (batch item; file_id is the value returned by upload_params, required) */
export const CourseKnowledgeFileConfirmUploadItemSchema = z.object({
  file_path: z.string(),
  lock_id: pyUuid,
  file_name: z.string().min(1).max(255),
  file_size: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1),
  ),
  file_md5: z.string().nullable().optional().default(""),
  file_id: z.string(),
  allow_student_download: pyBoolRequired().default(true),
  duration_seconds: z.coerce.number().int().min(0).optional().nullable(),
});

export type CourseKnowledgeFileConfirmUploadItem = z.infer<
  typeof CourseKnowledgeFileConfirmUploadItemSchema
>;

/** Direct upload confirmation (batch) */
export const CourseKnowledgeFileBatchConfirmUploadRequestSchema = z.object({
  files: z
    .array(CourseKnowledgeFileConfirmUploadItemSchema)
    .min(1, { message: "List should have at least 1 item after validation, not 0" })
    .max(20, {
      message: "List should have at most 20 items after validation, not 20",
    }),
});

export type CourseKnowledgeFileBatchConfirmUploadRequest = z.infer<
  typeof CourseKnowledgeFileBatchConfirmUploadRequestSchema
>;

// ---------------------------------------------------------------------------
// course_knowledge_file route family response DTOs
// 
// ---------------------------------------------------------------------------

/** Sections linked to a knowledge file */
export interface KnowledgeFileSectionsResponse {
  section_ids: string[];
  count: number;
}

/** Direct upload presign parameters response (single file) */
export interface CourseKnowledgeFileUploadParamsResponse {
  upload_url: string;
  method: string;
  file_path: string;
  file_name: string;
  file_id: string;
  lock_id: string | null;
  expires_at: string | null;
  fields: Record<string, unknown> | null;
  headers: Record<string, string> | null;
}

/** Direct upload presign parameters response (batch item) */
export interface CourseKnowledgeFileBatchUploadParamsItemResponse {
  index: number;
  success: boolean;
  upload_url: string | null;
  method: string | null;
  file_path: string | null;
  file_name: string | null;
  file_id: string | null;
  lock_id: string | null;
  expires_at: string | null;
  fields: Record<string, unknown> | null;
  headers: Record<string, string> | null;
  error_code: number | null;
  error_message: string | null;
}

/** Direct upload presign parameters response (batch) */
export interface CourseKnowledgeFileBatchUploadParamsResponse {
  success_count: number;
  failed_count: number;
  items: CourseKnowledgeFileBatchUploadParamsItemResponse[];
}

/** Direct upload confirmation response (batch item) */
export interface CourseKnowledgeFileBatchConfirmUploadItemResponse {
  index: number;
  success: boolean;
  file: CourseKnowledgeFileInfo | null;
  error_code: number | null;
  error_message: string | null;
}

/** Direct upload confirmation response (batch) */
export interface CourseKnowledgeFileBatchConfirmUploadResponse {
  success_count: number;
  failed_count: number;
  items: CourseKnowledgeFileBatchConfirmUploadItemResponse[];
}
