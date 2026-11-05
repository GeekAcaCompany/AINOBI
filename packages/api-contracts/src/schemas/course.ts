// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course domain schemas.
 *
 * - Request side: zod (runtime validation; production's lax semantics bridged through helpers)
 * - Response side: TS interfaces (datetimes converted to toPythonIso strings at construction)
 */

import { z } from "zod";
import { CourseStatus } from "../enums/course.ts";
import { PaginationRequestSchema } from "./user.ts";
import { pyBool, pyUuid } from "./helpers.ts";
import type { TeacherInfo } from "./user.ts";
import type { AITeacherInfo } from "./ai_teacher.ts";

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** Course info (shared by list/detail/tree; stats and teacher fields filled on demand) */
export interface CourseInfo {
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;

  course_id: string;
  course_name: string;
  course_status: CourseStatus;
  course_description: string | null;
  main_image_url: string | null;
  course_price: number | null;
  course_original_price: number | null;
  org_id: string;
  /** Whether it is a public course (joinable without an organization; AI spend counts to the learner personally) */
  is_public_course: boolean | null;
  remark: string | null;
  sort: number | null;
  published_by: string | null;
  published_at: string | null;
  /** The current user's first unfinished chapter (filled by the detail route) */
  last_unfinished_chapter_id: string | null;
  /** The current user's first unfinished section (filled by the detail route) */
  last_unfinished_section_id: string | null;
  /** Overall course progress 0-100 (filled by the tree route) */
  course_progress: number | null;
  /** Live attendance rate 0-100 (filled by the tree route) */
  attendance_rate: number | null;
  /** Enrolled student count (filled with include_counts) */
  student_count: number | null;
  chapter_count: number | null;
  section_count: number | null;
  /** Teachers (filled with include_teachers) */
  teachers: TeacherInfo[] | null;
  /** AI teachers (filled with include_ai_teachers) */
  ai_teachers: AITeacherInfo[] | null;
}

/** Public course discovery info (used by the /public route family) */
export interface PublicCourseInfo {
  course_id: string;
  course_name: string;
  course_description: string | null;
  main_image_url: string | null;
  org_id: string;
  is_public_course: boolean;
  is_enrolled: boolean;
}

/** Clone link generation response */
export interface CourseGenerateCloneLinkResponse {
  clone_link: string;
  verify_code: string;
  expires_at: string;
}

/** Attendance stats (last 30 days) */
export interface CourseAttendanceStats {
  org_id: string;
  course_id: string;
  course_name: string;
  start_time: string;
  stop_time: string;
  average_attendance_rate: number;
  total_live_classrooms: number;
  total_absent_students: number;
}

/** Homework stats (last 30 days) */
export interface CourseHomeworkStats {
  org_id: string;
  course_id: string;
  course_name: string;
  start_time: string;
  stop_time: string;
  homework_completion_rate: number;
  recent_submissions_count: number;
}

/** Live progress stats */
export interface CourseLiveProgressStats {
  org_id: string;
  course_id: string;
  total_live_sections_count: number;
  ended_live_sections_count: number;
  progress: number;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Course list query (query; course name normalization happens in the route layer) */
export const CourseListRequestSchema = PaginationRequestSchema.extend({
  course_name: z.string().optional().nullable(),
  course_status: z.nativeEnum(CourseStatus).optional().nullable(),
  /** Comma-separated statuses (invalid values silently dropped) */
  course_statuses: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  /** Whether CourseInfo carries student/chapter/section counts */
  include_counts: pyBool().optional().nullable().default(false),
  /** Whether CourseInfo carries the teacher list */
  include_teachers: pyBool().optional().nullable().default(false),
  /** Whether CourseInfo carries the AI teacher list */
  include_ai_teachers: pyBool().optional().nullable().default(false),
});

export type CourseListRequest = z.infer<typeof CourseListRequestSchema>;

/**
 * Lax JSON form of a non-Optional bool (accepts true/false/1/0/"true"…,
 * refuses null). helpers.pyBool is the Optional[bool] version (null passes).
 */
const pyBoolRequired = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(lowered)) {
        return false;
      }
    }
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return value;
  },
  z.boolean(),
);

/** Create a course */
export const CourseCreateRequestSchema = z.object({
  course_name: z.string().min(1).max(200),
  course_status: z.nativeEnum(CourseStatus),
  is_public_course: pyBool().optional().nullable().default(false),
  course_description: z.string().max(1000).optional().nullable(),
  /** Cover image base64 (data URL or bare base64); the server uploads it to object storage */
  main_image_base64: z.string().optional().nullable(),
  course_price: z.number().min(0).optional().nullable(),
  course_original_price: z.number().min(0).optional().nullable(),
  remark: z.string().max(500).optional().nullable(),
  sort: z.number().int().min(0).optional().nullable().default(0),
});

export type CourseCreateRequest = z.infer<typeof CourseCreateRequestSchema>;

/** Update a course (every field optional; None = not updated) */
export const CourseUpdateRequestSchema = z.object({
  course_name: z.string().min(1).max(200).optional().nullable(),
  course_status: z.nativeEnum(CourseStatus).optional().nullable(),
  is_public_course: pyBool().optional().nullable(),
  course_description: z.string().max(1000).optional().nullable(),
  main_image_base64: z.string().optional().nullable(),
  course_price: z.number().min(0).optional().nullable(),
  course_original_price: z.number().min(0).optional().nullable(),
  remark: z.string().max(500).optional().nullable(),
  sort: z.number().int().min(0).optional().nullable(),
});

export type CourseUpdateRequest = z.infer<typeof CourseUpdateRequestSchema>;

/** Clone a course (cross-organization cloning with verify_code reuses the same body) */
export const CourseCloneRequestSchema = z.object({
  new_course_name: z.string().min(1).max(200),
  copy_knowledge_files: pyBoolRequired.default(true),
});

export type CourseCloneRequest = z.infer<typeof CourseCloneRequestSchema>;

/** Generate a clone link */
export const CourseGenerateCloneLinkRequestSchema = z.object({
  ttl_seconds: z.number().int().min(600).max(2592000).optional().nullable(),
  max_clone_count: z.number().int().min(1).max(1000).optional().nullable(),
});

export type CourseGenerateCloneLinkRequest = z.infer<typeof CourseGenerateCloneLinkRequestSchema>;

/** Attendance stats request (empty model, kept only for API compatibility) */
export const CourseAttendanceStatsRequestSchema = z.object({});

/** Homework stats request (empty model, kept only for API compatibility) */
export const CourseHomeworkStatsRequestSchema = z.object({});

// ---------------------------------------------------------------------------
// course_student route family (/organization/{org_id}/course/{course_id}/student)
// ---------------------------------------------------------------------------

/** Join a course by invite code (learner-facing; the invite code itself is the authorization) */
export const CourseInviteStudentRequestSchema = z.object({
  code: z.string(),
});

export type CourseInviteStudentRequest = z.infer<typeof CourseInviteStudentRequestSchema>;

/** Generate a course invite code (short-lived; 24h by default) */
export const CourseGenerateInviteCodeRequestSchema = z.object({
  redirect_url: z.string().optional().nullable(),
  ttl_seconds: z.number().int().min(60).max(2592000).optional().nullable(),
  max_uses: z.number().int().min(1).max(100000).optional().nullable(),
  join_to_org: pyBool().optional().nullable().default(false),
});

export type CourseGenerateInviteCodeRequest = z.infer<typeof CourseGenerateInviteCodeRequestSchema>;

/** Add students to a course in bulk */
export const CourseBatchAddStudentsRequestSchema = z.object({
  student_ids: z.array(pyUuid).min(1, { message: "List should have at least 1 item after validation, not 0" }),
});

export type CourseBatchAddStudentsRequest = z.infer<typeof CourseBatchAddStudentsRequestSchema>;

/** Bulk add students result */
export interface BatchAddStudentsResponse {
  success_ids: string[];
  failed_ids: Record<string, string>;
  total_count: number;
  success_count: number;
  failed_count: number;
}

/** Course invite code generation result (invite_code is a short link URL) */
export interface CourseGenerateInviteCodeResponse {
  invite_code: string;
}

