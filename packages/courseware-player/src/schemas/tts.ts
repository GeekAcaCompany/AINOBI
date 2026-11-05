// SPDX-License-Identifier: AGPL-3.0-only
import { TTSProvider, TTSStatus } from "../enums/tts.ts";
import type { InferType } from "yup";
import { number, object, string } from "yup";
import { baseInfoSchema } from "@ainobi/web-kit/schemas/base";

/**
 * TTS Info Schema
 */
export const ttsInfoSchema = object({
  tts_id: string().uuid().required(),
  tts_name: string().required(),
  tts_status: string().oneOf(Object.values(TTSStatus)).required(),
  tts_provider: string().oneOf(Object.values(TTSProvider)).required(),
  tts_model: string().required(),
  tts_voice: string().required(),
  tts_speed: number().nullable(),
  tts_volume: number().nullable(),
  tts_pitch: number().nullable(),
  tts_language: string().nullable(),
  remark: string().nullable(),
}).concat(baseInfoSchema);
export type TTSInfo = InferType<typeof ttsInfoSchema>;

/**
 * TTS Generate URL Response Schema
 */
export const ttsGenerateUrlResponseSchema = object({
  tts_url: string().required(),
  object_key: string().required(),
  format: string().required(),
  content_type: string().required(),
});
export type TTSGenerateUrlResponse = InferType<
  typeof ttsGenerateUrlResponseSchema
>;
