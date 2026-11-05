// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Courseware quiz domain schemas.
 *
 * Answer payloads submitted by the runtime (courseware player) and the server's scoring results.
 */

import { z } from "zod";
import { pyBoolRequired, pyUuid } from "./helpers.ts";

/**
 * Required int (body): z.coerce.number() would silently turn null into 0,
 * while production reports invalid_type for null — so nullable+refine rejects it first.
 */
function pyRequiredInt<T extends z.ZodType<number>>(schema: T) {
  return schema
    .nullable()
    .refine((value) => value !== null, {
      message: "Input should be a valid integer",
    }) as unknown as z.ZodType<number>;
}

/** Runtime answer payload (CoursewareQuizAnswerContent) */
export const CoursewareQuizAnswerContentSchema = z.object({
  /** Option IDs selectable in the rendered canvas template */
  selected_option_ids: z.array(z.string()).nullable().optional(),
  /** Option indexes of the rendered canvas template */
  selected_option_indices: z.array(z.coerce.number().int()).nullable().optional(),
  /** Ordered text answers for fill-in/essay questions */
  values: z.array(z.string()).nullable().optional(),
  /** Raw input values keyed by canvas member element ID */
  value_by_member_id: z.record(z.string(), z.string()).nullable().optional(),
  /** Record button / member ID of voice questions */
  recording_member_id: z.string().nullable().optional(),
  /** courseware service recording row ID */
  recording_id: pyUuid.nullable().optional(),
  /** Cloud path of the courseware asset after upload (needed for AI audio scoring) */
  recording_file_path: z.string().nullable().optional(),
  /** Cloud URL of the courseware asset after upload (needed for AI audio scoring) */
  recording_file_url: z.string().nullable().optional(),
  /** Recording duration reported by the client (seconds, optional metadata) */
  recording_duration_sec: z.number().nonnegative().nullable().optional(),
});
export type CoursewareQuizAnswerContent = z.infer<typeof CoursewareQuizAnswerContentSchema>;

/** Complete session request (ends the quiz session on reaching the score summary page) */
export const CoursewareQuizCompleteSessionRequestSchema = z.object({
  course_id: pyUuid,
  section_id: pyUuid,
  scene_id: z.string().nullable().optional(),
  total_score: z.number().nonnegative(),
  max_score: z.number().nonnegative(),
  answered_count: pyRequiredInt(z.coerce.number().int().nonnegative()),
  total_count: pyRequiredInt(z.coerce.number().int().nonnegative()),
  /** Required question wrapper IDs; when given, all must be answered */
  required_question_wrapper_ids: z.array(z.string()).nullable().optional(),
});
export type CoursewareQuizCompleteSessionRequest = z.infer<
  typeof CoursewareQuizCompleteSessionRequestSchema
>;

/** Single answer submit request (scored by the server) */
export const CoursewareQuizSubmitAnswerRequestSchema = z.object({
  /** Course ID for billing / organization ownership checks */
  course_id: pyUuid.nullable().optional(),
  /** Section ID for billing / organization ownership checks */
  section_id: pyUuid.nullable().optional(),
  scene_id: z.string().nullable().optional(),
  slide_element_id: z.string().nullable().optional(),
  question_wrapper_id: z.string().min(1),
  /** Serialized QuizQuestion config */
  question: z.record(z.string(), z.unknown()),
  /** Answer captured at runtime */
  answer: CoursewareQuizAnswerContentSchema,
  /** Total required questions of the scene (homework is marked submitted automatically once all are answered) */
  quiz_total_required: z.coerce.number().int().nonnegative().nullable().optional(),
  /** Required question wrapper IDs on the slide (the primary basis for homework completion) */
  required_question_wrapper_ids: z.array(z.string()).nullable().optional(),
  /** Quiz full score configured by the scene (usable for stats even when not all are answered) */
  quiz_max_score: z.number().nonnegative().nullable().optional(),
  /** Client hint for the learner-facing scoring feedback language */
  language: z.string().nullable().optional(),
});
export type CoursewareQuizSubmitAnswerRequest = z.infer<
  typeof CoursewareQuizSubmitAnswerRequestSchema
>;

/**
 * Internal progress projection request (projected after the authoritative attempt owned by courseware-service completes).
 * = CoursewareQuizCompleteSessionRequest + user_id.
 */
export const CoursewareQuizInternalProgressProjectionRequestSchema =
  CoursewareQuizCompleteSessionRequestSchema.extend({
    user_id: pyUuid,
  });
export type CoursewareQuizInternalProgressProjectionRequest = z.infer<
  typeof CoursewareQuizInternalProgressProjectionRequestSchema
>;

/**
 * Internal answer projection request (replay of a submission owned by courseware-service).
 * = CoursewareQuizSubmitAnswerRequest + scoring result fields.
 */
export const CoursewareQuizInternalAnswerProjectionRequestSchema =
  CoursewareQuizSubmitAnswerRequestSchema.extend({
    user_id: pyUuid,
    /** SubmitAnswerRequest's course_id/section_id are required in the internal projection */
    course_id: pyUuid,
    section_id: pyUuid,
    score: z.number().nonnegative(),
    max_score: z.number().nonnegative(),
    passed: pyBoolRequired(),
    can_advance: pyBoolRequired(),
    feedback: z.string(),
    feedback_detail: z.record(z.string(), z.unknown()).nullable().optional(),
  });
export type CoursewareQuizInternalAnswerProjectionRequest = z.infer<
  typeof CoursewareQuizInternalAnswerProjectionRequestSchema
>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** Server scoring result for one question */
export interface CoursewareQuizSubmitAnswerResponse {
  score: number;
  max_score: number;
  passed: boolean;
  can_advance: boolean;
  feedback: string;
  feedback_detail: Record<string, unknown> | null;
}

/** Persisted quiz answer (for teacher/student review) */
export interface CoursewareQuizAnswerRecord {
  id: string;
  student_id: string;
  section_id: string;
  scene_id: string | null;
  question_wrapper_id: string;
  slide_element_id: string | null;
  question_type: string | null;
  question_title: string | null;
  answer: Record<string, unknown>;
  score: number;
  max_score: number;
  is_correct: boolean;
  feedback: string | null;
  feedback_detail: Record<string, unknown> | null;
  submitted_at: string;
}

/** Answer list response */
export interface CoursewareQuizAnswerListResponse {
  section_id: string;
  student_id: string;
  answers: CoursewareQuizAnswerRecord[];
}

/** Complete session response */
export interface CoursewareQuizCompleteSessionResponse {
  homework_submitted: boolean;
  homework_submitted_at: string | null;
}
