// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Community (teacher feedback) domain schemas.
 */

import { z } from "zod";
import { pyUuid } from "./helpers.ts";

export const FeedbackType = {
  ToStudent: "to_student",
  ToAdminSystemNote: "to_admin_system_note",
} as const;
export type FeedbackType = (typeof FeedbackType)[keyof typeof FeedbackType];

const feedbackTypeEnum = z.enum(["to_student", "to_admin_system_note"]);

/** Create teacher feedback */
export const CreateFeedbackRequestSchema = z.object({
  course_id: pyUuid,
  /** to_student (sent to the student) or to_admin_system_note (sent to managers / system note) */
  feedback_type: feedbackTypeEnum.default("to_student"),
  feedback_content: z.string().min(1),
});

/** Update teacher feedback (at least one field) */
export const UpdateFeedbackRequestSchema = z.object({
  feedback_type: feedbackTypeEnum.optional(),
  feedback_content: z.string().min(1).optional(),
});

/** Feedback list query (course_id optional; the feedback_type Query parameter is declared separately in the route layer) */
export const GetFeedbackListRequestSchema = z.object({
  course_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

/** Teacher feedback DTO (TeacherFeedback) */
export interface TeacherFeedback {
  feedback_id: string;
  course_id: string;
  student_id: string;
  reviewer_id: string;
  reviewer_role: string;
  reviewer_name: string | null;
  avatar_url: string | null;
  feedback_type: FeedbackType;
  feedback_content: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Community pagination info (field names differ from the generic PaginationInfo: page/total rather than page_number/total_count) */
export interface CommunityPaginationInfo {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface GetFeedbackListResponse {
  data: TeacherFeedback[];
  pagination: CommunityPaginationInfo;
}
