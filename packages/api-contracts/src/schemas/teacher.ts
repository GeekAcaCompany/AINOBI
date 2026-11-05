// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teacher domain schemas.
 *
 * TeacherInfo itself lives in schemas/user.ts (shared with the session codec); this file holds
 * the request schemas of the org-side teacher CRUD routes and the livestreaming time stats DTO.
 */

import { z } from "zod";
import { TeacherStatus } from "../enums/teacher.ts";
import { PaginationRequestSchema } from "./user.ts";
import { EnterpriseProvisionRequestSchema } from "./enterprise_member.ts";
import { pyEnum, pyUuid } from "./helpers.ts";

/** Teacher status enum values (pyEnum lax: accepts only the member's raw string) */
const TEACHER_STATUS_VALUES = Object.values(TeacherStatus) as readonly string[];

/** Teacher list query (TeacherListRequest) */
export const TeacherListRequestSchema = PaginationRequestSchema.extend({
  teacher_name: z.string().nullable().optional(),
  teacher_no: z.string().nullable().optional(),
  teacher_status: pyEnum(TEACHER_STATUS_VALUES).nullable().optional(),
  teacher_statuses: z.string().nullable().optional(),
});

export type TeacherListRequest = z.infer<typeof TeacherListRequestSchema>;

/** URL validation (urlparse semantics; the first failure is reported) */
function teacherAvatarUrlViolation(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "teacher_avatar_url must be a valid URL";
  }
  if (!parsed.protocol || !parsed.host) {
    return "teacher_avatar_url must be a valid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "teacher_avatar_url must use http or https protocol";
  }
  return null;
}

/** zod refine wrapper for teacher_avatar_url (null/undefined pass) */
function teacherAvatarUrlRefine() {
  return z
    .string()
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === null || value === undefined) {
        return;
      }
      const violation = teacherAvatarUrlViolation(value);
      if (violation !== null) {
        ctx.addIssue({ code: "custom", message: violation });
      }
    });
}

/** Teacher create request (TeacherCreateRequest) */
export const TeacherCreateRequestSchema = z.object({
  teacher_no: z.string().nullable().optional(),
  teacher_name: z.string(),
  teacher_name_kana: z.string().nullable().optional(),
  teacher_status: pyEnum(TEACHER_STATUS_VALUES).default("pending"),
  teacher_introduction: z.string().nullable().optional(),
  teacher_titles: z.array(z.string()).nullable().optional(),
  teacher_avatar_url: teacherAvatarUrlRefine(),
  sort: z.coerce.number().int().nullable().optional(),
  /** Optional user binding at creation */
  user_id: pyUuid.nullable().optional(),
  /** Enterprise provisioning block: when present, switches to the enterprise member provisioning flow */
  enterprise: EnterpriseProvisionRequestSchema.nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type TeacherCreateRequest = z.infer<typeof TeacherCreateRequestSchema>;

/** Teacher update request (TeacherUpdateRequest; None = unchanged) */
export const TeacherUpdateRequestSchema = z.object({
  teacher_no: z.string().nullable().optional(),
  teacher_name: z.string().nullable().optional(),
  teacher_name_kana: z.string().nullable().optional(),
  teacher_status: pyEnum(TEACHER_STATUS_VALUES).nullable().optional(),
  teacher_introduction: z.string().nullable().optional(),
  teacher_titles: z.array(z.string()).nullable().optional(),
  teacher_avatar_url: teacherAvatarUrlRefine(),
  sort: z.coerce.number().int().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type TeacherUpdateRequest = z.infer<typeof TeacherUpdateRequestSchema>;

/** Teacher bind user request (TeacherBindUserRequest) */
export const TeacherBindUserRequestSchema = z.object({
  user_id: pyUuid,
});

export type TeacherBindUserRequest = z.infer<typeof TeacherBindUserRequestSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** Teacher livestreaming time stats (TeacherLivestreamingTimeStatistics) */
export interface TeacherLivestreamingTimeStatistics {
  org_id: string;
  teacher_id: string;
  course_id: string | null;
  filter_type: string;
  start_time: string;
  end_time: string;
  total_livestream_time_seconds: number;
  total_recording_count: number;
}
