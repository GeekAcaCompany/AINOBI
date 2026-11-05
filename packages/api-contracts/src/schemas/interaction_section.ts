// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Interaction section domain schemas: the request schema family of the batch_sync endpoint
 * (ContentElementSchema + BatchSync) and the response DTOs.
 */

import { z } from "zod";
import {
  AIScoringTemplate,
  InteractionContentType,
  InteractionQuestionType,
} from "../enums/interaction.ts";
import { pyBool, pyBoolRequired, pyEnum, pyUuidParam } from "./helpers.ts";

/** AI scoring config (extra=forbid; a custom template must carry template_id) */
export const AIScoringConfigSchema = z
  .strictObject({
    template: pyEnum(Object.values(AIScoringTemplate)),
    template_id: z.string().min(1).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.template === AIScoringTemplate.CUSTOM && !data.template_id) {
      ctx.addIssue({
        code: "custom",
        path: ["ai_scoring_config"],
        message: "template_id is required when template is custom",
      });
    }
  });

/** Content element (static content and question components share one shape) */
export const ContentElementSchema = z.object({
  type: pyEnum(Object.values(InteractionContentType)),
  // ---- Static content fields ----
  content: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  file_type: z.string().optional().nullable(),
  file_url: z.string().optional().nullable(),
  file_id: pyUuidParam.optional().nullable(),
  page_number: z.coerce.number().int().min(1).optional().nullable(),
  prompt_template_id: pyUuidParam.optional().nullable(),
  // ---- Question fields (only for question_* types) ----
  question_id: z.string().optional().nullable(),
  question_type: pyEnum(Object.values(InteractionQuestionType)).optional().nullable(),
  question_text: z.string().optional().nullable(),
  options: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
  score: z.coerce.number().int().optional().nullable(),
  timeout: z.coerce.number().int().optional().nullable(),
  allow_resubmit: pyBool().optional().nullable(),
  is_multi_select: pyBool().optional().nullable(),
  question_images: z.array(z.string()).optional().nullable(),
  question_audios: z.array(z.string()).optional().nullable(),
  text_answer: z.string().optional().nullable(),
  ai_scoring_config: AIScoringConfigSchema.optional().nullable(),
});

/** Create an interaction section */
export const InteractionSectionCreateRequestSchema = z.object({
  // is_required is not Optional — null is refused
  is_required: pyBoolRequired().default(false),
  pass_score: z.coerce.number().int().min(0).max(100).nullable().optional(),
  content_elements: z.array(ContentElementSchema).default([]),
  order: z.coerce.number().int().min(0).default(0),
});

export type InteractionSectionCreateRequest = z.infer<typeof InteractionSectionCreateRequestSchema>;

/** Update an interaction section */
export const InteractionSectionUpdateRequestSchema = z.object({
  is_required: pyBool().nullable().optional(),
  pass_score: z.coerce.number().int().min(0).max(100).nullable().optional(),
  content_elements: z.array(ContentElementSchema).nullable().optional(),
  order: z.coerce.number().int().min(0).nullable().optional(),
});

export type InteractionSectionUpdateRequest = z.infer<typeof InteractionSectionUpdateRequestSchema>;

/** Batch update item (with id) */
export const InteractionSectionBatchUpdateItemSchema = InteractionSectionUpdateRequestSchema.extend({
  id: pyUuidParam,
});

/** Batch sync payload (create + update + delete parts) */
export const InteractionSectionBatchSyncRequestSchema = z.object({
  sections_to_create: z.array(InteractionSectionCreateRequestSchema).default([]),
  sections_to_update: z.array(InteractionSectionBatchUpdateItemSchema).default([]),
  section_ids_to_delete: z.array(pyUuidParam).default([]),
});

export type InteractionSectionBatchUpdateItem = z.infer<typeof InteractionSectionBatchUpdateItemSchema>;
export type InteractionSectionBatchSyncRequest = z.infer<typeof InteractionSectionBatchSyncRequestSchema>;
export type ContentElement = z.infer<typeof ContentElementSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** AI scoring config response (sanitized form) */
export interface AIScoringConfigResponse {
  template: string | null;
  template_id: string | null;
}

/** Interaction question response (teacher/admin view — includes the answer key) */
export interface InteractionQuestionResponse {
  id: string;
  interaction_section_id: string;
  question_type: string;
  question_text: string | null;
  question_images: Array<Record<string, unknown>> | null;
  question_audios: Array<Record<string, unknown>> | null;
  options: Array<Record<string, unknown>> | null;
  text_answer: string | null;
  ai_scoring_config: AIScoringConfigResponse | null;
  score: number;
  timeout: number | null;
  allow_resubmit: boolean;
  order: number;
  created_at: string;
  updated_at: string;
}

/** Summary of a student's interaction answer (embedded in the question list) */
export interface StudentInteractionAnswerSummary {
  id: string;
  answer_content: Record<string, unknown>;
  score: number | null;
  feedback: string | null;
  start_at: string | null;
  submitted_at: string;
  scored_at: string | null;
}

/** Interaction question response (student view — answer key stripped + submitted answer) */
export interface InteractionQuestionStudentResponse {
  id: string;
  interaction_section_id: string;
  question_type: string;
  question_text: string | null;
  question_images: Array<Record<string, unknown>> | null;
  question_audios: Array<Record<string, unknown>> | null;
  options: Array<Record<string, unknown>> | null;
  score: number;
  timeout: number | null;
  allow_resubmit: boolean;
  order: number;
  created_at: string;
  updated_at: string;
  submitted_answer: StudentInteractionAnswerSummary | null;
}

/** Content element response (extra=allow: keeps every extra key of the payload) */
export interface ContentElementResponse {
  type: string;
  [key: string]: unknown;
}

/** Interaction section response */
export interface InteractionSectionResponse {
  id: string;
  course_section_id: string;
  is_required: boolean;
  pass_score: number | null;
  content_elements: ContentElementResponse[];
  order: number;
  questions: Array<InteractionQuestionResponse | InteractionQuestionStudentResponse>;
  created_at: string;
  updated_at: string;
}

/** Batch sync response */
export interface InteractionSectionBatchSyncResponse {
  created_sections: InteractionSectionResponse[];
  updated_sections: InteractionSectionResponse[];
}
