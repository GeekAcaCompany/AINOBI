// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Prompt template domain schemas.
 */

import { z } from "zod";
import { PaginationRequestSchema } from "./user.ts";
import { pyBool, pyEnum, pyUuid } from "./helpers.ts";

const promptTemplateTypeEnum = pyEnum(["multiple_choice", "text", "audio", "llm_explanation"]);

export const PromptTemplateListRequestSchema = PaginationRequestSchema.extend({
  template_name: z.string().optional(),
  template_type: promptTemplateTypeEnum.optional(),
  is_active: pyBool().optional().default(true),
});

export const PromptTemplateCreateRequestSchema = z.strictObject({
  template_name: z.string().min(1).max(200),
  template_content: z.string().min(1),
  template_type: promptTemplateTypeEnum,
  is_active: pyBool().optional(),
});

export const PromptTemplateUpdateRequestSchema = z.strictObject({
  template_name: z.string().min(1).max(200).optional(),
  template_content: z.string().min(1).optional(),
  template_type: promptTemplateTypeEnum.optional(),
  is_active: pyBool().optional(),
});

export type PromptTemplateListRequest = z.infer<typeof PromptTemplateListRequestSchema>;
export type PromptTemplateCreateRequest = z.infer<typeof PromptTemplateCreateRequestSchema>;
export type PromptTemplateUpdateRequest = z.infer<typeof PromptTemplateUpdateRequestSchema>;

export interface PromptTemplateInfo {
  template_id: string;
  template_name: string;
  template_content: string;
  template_type: string;
  org_id: string;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export { pyUuid as promptTemplateIdParam };
