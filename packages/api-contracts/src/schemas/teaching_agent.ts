// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teaching agent domain schemas.
 *
 * The request schemas referenced by the teaching_agent_lookup route (/transcript/text).
 */

import { z } from "zod";
import { pyUuidParam } from "./helpers.ts";

/** Generate transcript text in an AI teacher's style (no section binding) */
export const AITeacherTranscriptGenerateRequestSchema = z.object({
  ai_teacher_id: pyUuidParam,
  text: z.string(),
});

export type AITeacherTranscriptGenerateRequest = z.infer<
  typeof AITeacherTranscriptGenerateRequestSchema
>;
