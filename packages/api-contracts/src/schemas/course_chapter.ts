// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course chapter domain schemas.
 */

import { z } from "zod";
import { CourseChapterStatus } from "../enums/course_chapter.ts";
import { PaginationRequestSchema } from "./user.ts";
import { pyUuid } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** Course chapter info */
export interface CourseChapterInfo {
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;

  chapter_id: string;
  chapter_name: string;
  chapter_status: CourseChapterStatus;
  chapter_description: string | null;
  main_image_url: string | null;
  chapter_price: number | null;
  chapter_original_price: number | null;
  course_id: string;
  org_id: string;
  remark: string | null;
  sort: number | null;
  published_by: string | null;
  published_at: string | null;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Chapter list query */
export const CourseChapterListRequestSchema = PaginationRequestSchema.extend({
  chapter_name: z.string().optional().nullable(),
  chapter_status: z.nativeEnum(CourseChapterStatus).optional().nullable(),
  chapter_statuses: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
});

export type CourseChapterListRequest = z.infer<typeof CourseChapterListRequestSchema>;

/** Create a chapter (the server overwrites sort with max+1; the request value is dropped) */
export const CourseChapterCreateRequestSchema = z.object({
  chapter_name: z.string().min(1).max(100),
  chapter_status: z.nativeEnum(CourseChapterStatus).default(CourseChapterStatus.Public),
  chapter_description: z.string().max(1000).optional().nullable(),
  main_image_url: z.string().max(500).optional().nullable(),
  chapter_price: z.number().min(0).optional().nullable(),
  chapter_original_price: z.number().min(0).optional().nullable(),
  remark: z.string().max(500).optional().nullable(),
  sort: z.number().int().min(0).optional().nullable().default(0),
});

export type CourseChapterCreateRequest = z.infer<typeof CourseChapterCreateRequestSchema>;

/** Update a chapter (None = not updated) */
export const CourseChapterUpdateRequestSchema = z.object({
  chapter_name: z.string().min(1).max(100).optional().nullable(),
  chapter_status: z.nativeEnum(CourseChapterStatus).optional().nullable(),
  chapter_description: z.string().max(1000).optional().nullable(),
  main_image_url: z.string().max(500).optional().nullable(),
  chapter_price: z.number().min(0).optional().nullable(),
  chapter_original_price: z.number().min(0).optional().nullable(),
  remark: z.string().max(500).optional().nullable(),
  sort: z.number().int().min(0).optional().nullable(),
});

export type CourseChapterUpdateRequest = z.infer<typeof CourseChapterUpdateRequestSchema>;

/** Reorder chapters (the order of chapter_ids is the sort order) */
export const CourseChapterReorderRequestSchema = z.object({
  // too_short message for min_items=1 (empty array → "not 0")
  chapter_ids: z.array(pyUuid).min(1, "List should have at least 1 item after validation, not 0"),
});

export type CourseChapterReorderRequest = z.infer<typeof CourseChapterReorderRequestSchema>;

// ---------------------------------------------------------------------------
// Cross-course copy
// ---------------------------------------------------------------------------

/** Copy whole chapters from another course into this course */
export const DuplicateChaptersFromCourseRequestSchema = z.object({
  source_course_id: pyUuid,
  /** Copy these chapters in the desired order (min_length=1 message) */
  chapter_ids: z.array(pyUuid).min(1, "List should have at least 1 item after validation, not 0"),
  /** Insert after this chapter; null = append at the end */
  insert_after_chapter_id: pyUuid.optional().nullable(),
});

export type DuplicateChaptersFromCourseRequest = z.infer<typeof DuplicateChaptersFromCourseRequestSchema>;
