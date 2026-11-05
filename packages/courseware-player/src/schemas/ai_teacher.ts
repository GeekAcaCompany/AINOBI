// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";
import { array, number, object, string } from "yup";

import { AITeacherStatus } from "@ainobi/api-contracts/enums/ai_teacher.ts";
import { LLMProvider } from "@ainobi/web-kit/enums/llm";

import { baseUserInfoSchema } from "./base_user.ts";

export const aiTeacherInfoSchema = object({
  ai_teacher_id: string().uuid().required(),
  ai_teacher_no: string().nullable(),
  ai_teacher_name: string().required(),
  ai_teacher_name_kana: string().nullable(),
  ai_teacher_status: string().oneOf(Object.values(AITeacherStatus)).required(),
  ai_teacher_introduction: string().nullable(),
  ai_teacher_titles: array().of(string()).nullable(),
  ai_teacher_avatar_url: string().nullable(),
  ai_teacher_system_prompt: string().nullable(),
  ai_teacher_llm_provider: string()
    .oneOf(Object.values(LLMProvider))
    .required(),
  ai_teacher_llm_model: string().nullable(),
  ai_teacher_llm_temperature: number().nullable(),
  ai_teacher_live2d_model_url: string().nullable(),
  ai_teacher_live2d_model_image_url: string().nullable(),
  ai_teacher_tts_id: string().uuid().nullable(),
  ai_teacher_tts_speed: number().nullable(),
  ai_teacher_tts_volume: number().nullable(),
  ai_teacher_tts_pitch: number().nullable(),
  ai_teacher_tts_style: string().nullable(),
  ai_teacher_tts_style_prompt: string().nullable(),
  ai_teacher_tts_language: string().nullable(),
  ai_teacher_language: string().nullable(),
  ai_teacher_tts: object({
    created_by: string().uuid().nullable(),
    updated_by: string().uuid().nullable(),
    updated_at: string().nullable(),
    created_at: string().nullable(),
    tts_id: string().uuid().nullable(),
    tts_name: string().nullable(),
    tts_model: string().nullable(),
    tts_voice: string().nullable(),
    tts_speed: number().nullable(),
    tts_volume: number().nullable(),
    tts_pitch: number().nullable(),
    tts_language: string().nullable(),
    remark: string().nullable(),
  }).nullable(),
  ai_teacher_sort: number().nullable(),
  remark: string().nullable(),
  org_id: string().uuid().required(),
}).concat(baseUserInfoSchema);
export type AITeacherInfo = InferType<typeof aiTeacherInfoSchema>;

export const aiTeacherPlayerInfoSchema = object({
  ai_teacher_id: string().uuid().required(),
  ai_teacher_name: string().required(),
  ai_teacher_name_kana: string().nullable(),
  ai_teacher_status: string().oneOf(Object.values(AITeacherStatus)).required(),
  ai_teacher_introduction: string().nullable(),
  ai_teacher_titles: array().of(string()).nullable(),
  ai_teacher_avatar_url: string().nullable(),
  ai_teacher_live2d_model_url: string().nullable(),
  ai_teacher_live2d_model_image_url: string().nullable(),
  ai_teacher_tts_id: string().uuid().nullable(),
  ai_teacher_tts_speed: number().nullable(),
  ai_teacher_tts_volume: number().nullable(),
  ai_teacher_tts_pitch: number().nullable(),
  ai_teacher_language: string().nullable(),
  org_id: string().uuid().required(),
});

export type AITeacherPlayerInfo = InferType<typeof aiTeacherPlayerInfoSchema>;
export type AITeacherPlayableInfo = AITeacherInfo | AITeacherPlayerInfo;
