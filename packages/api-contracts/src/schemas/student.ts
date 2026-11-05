// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Student domain schemas.
 *
 * Covers:
 * - the course_student route family: CourseStudentListRequest /
 *   CourseStudentTeachingMemo* / CourseAddUserAsStudentRequest
 * - org-level student routes (role CRUD): create request + learning stats DTOs
 *
 * StudentInfo itself lives in schemas/user.ts (shared with the session codec).
 */

import { z } from "zod";
import { StudentStatus } from "../enums/student.ts";
import { StudentCourseStatus } from "../enums/student_course.ts";
import { PaginationRequestSchema } from "./user.ts";
import { UserInfoCreateSchema } from "./user.ts";
import { EnterpriseProvisionRequestSchema } from "./enterprise_member.ts";
import { pyBool, pyEnum, pyUuid } from "./helpers.ts";
import { httpUrlRefine } from "./user.ts";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Student status enum values (pyEnum lax: accepts only the member's raw string; error text matches production) */
const STUDENT_STATUS_VALUES = Object.values(StudentStatus) as readonly string[];
const STUDENT_COURSE_STATUS_VALUES = Object.values(StudentCourseStatus) as readonly string[];

/** Student list query (StudentListRequest — the base of CourseStudentListRequest) */
export const StudentListRequestSchema = PaginationRequestSchema.extend({
  student_name: z.string().nullable().optional(),
  student_no: z.string().nullable().optional(),
  student_status: pyEnum(STUDENT_STATUS_VALUES).nullable().optional(),
  /** Comma-separated statuses (invalid values silently dropped) */
  student_statuses: z.string().nullable().optional(),
  student_course_status: pyEnum(STUDENT_COURSE_STATUS_VALUES).nullable().optional(),
  /** Whether to include the student's enrolled course info */
  include_courses: pyBool().nullable().optional().default(false),
});

export type StudentListRequest = z.infer<typeof StudentListRequestSchema>;

/** Course-level student list (CourseStudentListRequest: adds inactivity / registration-days filters) */
export const CourseStudentListRequestSchema = StudentListRequestSchema.extend({
  inactive_days: z.coerce.number().int().min(1).nullable().optional(),
  enrolled_within_days: z.coerce.number().int().min(1).nullable().optional(),
});

export type CourseStudentListRequest = z.infer<typeof CourseStudentListRequestSchema>;

/**
 * Student create request (StudentCreateRequest).
 * student_avatar_url is URL-validated (URL form + http/https).
 */
export const StudentCreateRequestSchema = z.object({
  student_no: z.string().nullable().optional(),
  student_name: z.string(),
  student_status: pyEnum(STUDENT_STATUS_VALUES).default("pending"),
  student_title: z.array(z.string()).nullable().optional(),
  student_introduction: z.string().nullable().optional(),
  student_avatar_url: httpUrlRefine("student_avatar_url"),
  sort: z.coerce.number().int().default(0),
  user_id: pyUuid.nullable().optional(),
  /** User info when creating a student (required when user_id is omitted — checked by the service layer) */
  user: UserInfoCreateSchema.nullable().optional(),
  /** Enterprise provisioning block: when present, switches to the enterprise member provisioning flow */
  enterprise: EnterpriseProvisionRequestSchema.nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type StudentCreateRequest = z.infer<typeof StudentCreateRequestSchema>;

/**
 * Student info update (StudentUpdateRequest).
 * student_avatar_url is URL-validated (URL form + http/https).
 */
export const StudentUpdateRequestSchema = z.object({
  student_no: z.string().nullable().optional(),
  student_name: z.string().nullable().optional(),
  student_status: pyEnum(STUDENT_STATUS_VALUES).nullable().optional(),
  student_title: z.array(z.string()).nullable().optional(),
  student_introduction: z.string().nullable().optional(),
  student_avatar_url: httpUrlRefine("student_avatar_url"),
  sort: z.coerce.number().int().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type StudentUpdateRequest = z.infer<typeof StudentUpdateRequestSchema>;

/**
 * Course-level teaching memo update (CourseStudentTeachingMemoUpdateRequest).
 * teaching_memo is required (the key must be present in the JSON) but may be null (an explicit null clears it).
 */
export const CourseStudentTeachingMemoUpdateRequestSchema = z.object({
  teaching_memo: z.string().max(20000).nullable(),
});

export type CourseStudentTeachingMemoUpdateRequest = z.infer<
  typeof CourseStudentTeachingMemoUpdateRequestSchema
>;

/**
 * Add a user to a course as a student (CourseAddUserAsStudentRequest).
 * Originally a route-inline request model — the TS side keeps it in the student domain schema file.
 */
export const CourseAddUserAsStudentRequestSchema = z.object({
  user_id: pyUuid,
});

export type CourseAddUserAsStudentRequest = z.infer<typeof CourseAddUserAsStudentRequestSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** The student's teaching memo in the current course (student_course.teaching_memo) */
export interface CourseStudentTeachingMemoResponse {
  student_id: string;
  course_id: string;
  teaching_memo: string | null;
  updated_at: string;
}

/** Brief student course info (filled when include_courses=true) */
export interface StudentCourseSimple {
  course_id: string;
  course_name: string;
}

/** Learning time stats (StudentLearningTimeStatistics) */
export interface StudentLearningTimeStatistics {
  total_learning_time_seconds: number;
}

/** Homework submission stats (StudentHomeworkStatistics) */
export interface StudentHomeworkStatistics {
  total_questions: number;
  submitted_questions: number;
  submission_rate: number;
}

/** One week of the learning trend (StudentLearningTrendItem) */
export interface StudentLearningTrendItem {
  /** Week start date (ISO date string, e.g. 2025-02-24) */
  week_start: string;
  total_learning_time_seconds: number;
  /** Overall score 0-100, filled when there is answer data */
  score: number | null;
  /** Attendance rate 0-100, filled when there are attendance records */
  attendance_rate: number | null;
}

/** Learning trend (StudentLearningTrendResponse; oldest week first) */
export interface StudentLearningTrendResponse {
  items: StudentLearningTrendItem[];
}
