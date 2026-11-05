// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Study companion persona domain schemas.
 */

import { z } from "zod";
import { pyBool } from "./helpers.ts";

const ALLOWED_MODEL_IDS = new Set(["geekaca-teacher"]);
const ALLOWED_PERSONALITY_TAGS = new Set([
  "gentle", "coach", "senpai", "humorous", "rigorous", "encouraging",
]);
const ALLOWED_LANGUAGES = new Set(["zh", "en", "ja"]);
const MAX_CUSTOM_PROMPT_LENGTH = 2000;
const MAX_NAME_LENGTH = 128;

function modelIdSchema() {
  return z.preprocess(
    (value) => (value === undefined || value === null ? undefined : String(value).trim()),
    z.string().superRefine((value, ctx) => {
      if (!ALLOWED_MODEL_IDS.has(value)) {
        ctx.addIssue({ code: "custom", message: "Unsupported companion model_id" });
      }
    }),
  ).optional();
}

function languageSchema() {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null) {
        return undefined;
      }
      const lowered = String(value).trim().toLowerCase();
      return lowered === "" ? "zh" : lowered;
    },
    z.string().superRefine((value, ctx) => {
      if (!ALLOWED_LANGUAGES.has(value)) {
        ctx.addIssue({ code: "custom", message: "Unsupported companion language" });
      }
    }),
  ).optional();
}

function personalityTagsSchema() {
  return z
    .array(z.string())
    .optional()
    .superRefine((value, ctx) => {
      if (!value) {
        return;
      }
      const invalid = value.find((tag) => !ALLOWED_PERSONALITY_TAGS.has(tag));
      if (invalid !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Unsupported personality tag: ${invalid}`,
        });
      }
    });
}

export const CompanionPersonaCreateRequestSchema = z.strictObject({
  model_id: modelIdSchema().default("geekaca-teacher"),
  language: languageSchema().default("zh"),
  personality_tags: personalityTagsSchema().default([]),
  custom_prompt: z.string().max(MAX_CUSTOM_PROMPT_LENGTH).nullable().optional(),
  name: z.string().max(MAX_NAME_LENGTH).nullable().optional(),
  voice_name: z.string().nullable().optional(),
  activate: pyBool().default(true),
});

export const CompanionPersonaUpdateRequestSchema = z.strictObject({
  model_id: modelIdSchema(),
  language: languageSchema(),
  personality_tags: personalityTagsSchema(),
  custom_prompt: z.string().max(MAX_CUSTOM_PROMPT_LENGTH).nullable().optional(),
  name: z.string().max(MAX_NAME_LENGTH).nullable().optional(),
  voice_name: z.string().nullable().optional(),
});

export type CompanionPersonaCreateRequest = z.infer<typeof CompanionPersonaCreateRequestSchema>;
export type CompanionPersonaUpdateRequest = z.infer<typeof CompanionPersonaUpdateRequestSchema>;

export interface CompanionPersonaInfo {
  persona_id: string;
  user_id: string;
  name: string;
  model_id: string;
  language: string;
  personality_tags: string[];
  custom_prompt: string | null;
  personality_prompt: string;
  voice_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompanionPersonaListResponse {
  items: CompanionPersonaInfo[];
}
