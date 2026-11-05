// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ASR domain schemas.
 *
 * Enums and response models for speech transcription (OpenAI Whisper-compatible endpoint).
 */

import { z } from "zod";
import { pyEnum, pyUuid, zQueryScalar } from "./helpers.ts";

/** ASR language enum (Form field values) */
export const ASRLanguage = {
  ZH_CN: "zh-cn",
  EN_US: "en-us",
  JA: "ja",
  KO: "ko",
  ES: "es",
  FR: "fr",
  DE: "de",
} as const;
export type ASRLanguage = (typeof ASRLanguage)[keyof typeof ASRLanguage];

/** Lax enum validation for ASRLanguage (error text matches production verbatim) */
export const ASRLanguageSchema = pyEnum(Object.values(ASRLanguage));

/** ASR status enum */
export const ASRStatus = {
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type ASRStatus = (typeof ASRStatus)[keyof typeof ASRStatus];

/** ASR transcription segment */
export interface ASRSegment {
  id: number | null;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

/** Transcription completed response */
export interface ASRCompleteResponse {
  task_id: string;
  status: ASRStatus;
  text: string;
  segments: ASRSegment[];
  confidence: number;
  processing_time_ms: number;
  total_duration_ms: number;
}

/**
 * Multipart form field schema for /asr/transcribe.
 * The audio file goes through route.form.files; language/course_id are Form fields
 * (starlette repeated keys are last-wins → zQueryScalar).
 */
export const ASRTranscribeFormFieldsSchema = z.object({
  language: zQueryScalar(ASRLanguageSchema).default(ASRLanguage.ZH_CN),
  course_id: zQueryScalar(pyUuid).nullish(),
});
