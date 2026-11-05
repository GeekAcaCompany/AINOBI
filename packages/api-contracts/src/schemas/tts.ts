// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TTS domain schemas.
 */

import { z } from "zod";
import { PaginationRequestSchema } from "./user.ts";

const ttsStatusEnum = z.enum(["active", "inactive", "deleted"]);
const ttsProviderEnum = z.enum(["google", "fishaudio", "minimax"]);

export const TTSListRequestSchema = PaginationRequestSchema.extend({
  tts_name: z.string().optional(),
  tts_status: ttsStatusEnum.optional(),
  tts_statuses: z.string().optional(),
  tts_provider: ttsProviderEnum.optional(),
  tts_language: z.string().optional(),
});

export const TTSCreateRequestSchema = z.object({
  tts_name: z.string(),
  tts_status: ttsStatusEnum,
  tts_provider: ttsProviderEnum,
  tts_model: z.string(),
  tts_voice: z.string(),
  tts_speed: z.number().optional().default(1.0),
  tts_volume: z.number().optional().default(1.0),
  tts_pitch: z.number().optional().default(1.0),
  tts_language: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export const TTSUpdateRequestSchema = z.object({
  tts_name: z.string().optional(),
  tts_status: ttsStatusEnum.optional(),
  tts_provider: ttsProviderEnum.optional(),
  tts_model: z.string().optional(),
  tts_voice: z.string().optional(),
  tts_speed: z.number().optional(),
  tts_volume: z.number().optional(),
  tts_pitch: z.number().optional(),
  tts_language: z.string().optional(),
  remark: z.string().optional(),
});

const MAX_TTS_TEXT_UTF8_BYTES = 15000;

export const TTSGenerateRequestSchema = z.object({
  text: z.string().superRefine((value, ctx) => {
    if (!value || !value.trim()) {
      ctx.addIssue({ code: "custom", message: "text must not be empty" });
      return;
    }
    const byteLength = Buffer.byteLength(value, "utf8");
    if (byteLength > MAX_TTS_TEXT_UTF8_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `text exceeds ${MAX_TTS_TEXT_UTF8_BYTES} UTF-8 bytes (got ${byteLength} bytes)`,
      });
    }
  }),
  /** Style preset key (used without ai_teacher_id, e.g. for a preview) */
  style_key: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  speed: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
  top_p: z.number().nullable().optional(),
  ai_teacher_id: z.string().nullable().optional(),
});

export type TTSListRequest = z.infer<typeof TTSListRequestSchema>;
export type TTSCreateRequest = z.infer<typeof TTSCreateRequestSchema>;
export type TTSUpdateRequest = z.infer<typeof TTSUpdateRequestSchema>;
export type TTSGenerateRequest = z.infer<typeof TTSGenerateRequestSchema>;

/** TTS DTO (TTSInfo) */
export interface TTSInfo {
  tts_id: string;
  tts_name: string;
  tts_status: string;
  tts_provider: string;
  tts_model: string;
  tts_voice: string;
  tts_speed: number | null;
  tts_volume: number | null;
  tts_pitch: number | null;
  tts_language: string | null;
  remark: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
