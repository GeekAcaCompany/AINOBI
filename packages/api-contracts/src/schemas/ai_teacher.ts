// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI teacher domain schemas.
 *
 * Covers: the AITeacherInfo / AITeacherPlayerInfo DTOs (lookup route responses) +
 * list/create/update request schemas + Live2D/avatar generation response DTOs.
 *
 * Note: on the TS side, AITeacherInfo's `_resolve_tts_style_prompt` model_validator
 * is reproduced by convertAiTeacherToSchema in services/ai_teacher.ts calling getStylePrompt
 * (the single place where a style key resolves to prompt text).
 */

import { z } from "zod";
import { AITeacherStatus } from "../enums/ai_teacher.ts";
import { LLMProvider, LLMModelMap } from "../enums/llm.ts";
import { PaginationRequestSchema, isoDatetime } from "./user.ts";
import { pyEnum, pyUuid } from "./helpers.ts";

/** TTSInfo shape (ai_teacher_tts is filled only in the list case and is always null for a single lookup — loosely typed for now) */
export const TTSInfoStubSchema = z.object({}).passthrough();
export type TTSInfoStub = z.infer<typeof TTSInfoStubSchema>;

export const AITeacherInfoSchema = z
  .object({
    ai_teacher_id: pyUuid,
    ai_teacher_no: z.string().nullable().optional(),
    ai_teacher_name: z.string(),
    ai_teacher_name_kana: z.string().nullable().optional(),
    ai_teacher_status: z.nativeEnum(AITeacherStatus),
    ai_teacher_introduction: z.string().nullable().optional(),
    ai_teacher_titles: z.array(z.string()).nullable().optional(),
    ai_teacher_avatar_url: z.string().nullable().optional(),
    ai_teacher_system_prompt: z.string().nullable().optional(),
    ai_teacher_llm_provider: z.nativeEnum(LLMProvider).nullable().optional(),
    ai_teacher_llm_model: z.string().nullable().optional(),
    ai_teacher_llm_temperature: z.number().nullable().optional(),
    ai_teacher_live2d_model_url: z.string().nullable().optional(),
    ai_teacher_live2d_model_image_url: z.string().nullable().optional(),
    ai_teacher_tts_id: pyUuid.nullable().optional(),
    /** TTS config filled in the list case; always null for a single lookup */
    ai_teacher_tts: TTSInfoStubSchema.nullable().optional(),
    ai_teacher_tts_speed: z.number().nullable().optional(),
    ai_teacher_tts_volume: z.number().nullable().optional(),
    ai_teacher_tts_pitch: z.number().nullable().optional(),
    ai_teacher_tts_style: z.string().nullable().optional(),
    /** Prompt resolved from the style key (empty key → null; custom text → normalized text) */
    ai_teacher_tts_style_prompt: z.string().nullable().optional(),
    ai_teacher_language: z.string().nullable().optional(),
    org_id: pyUuid,
    remark: z.string().nullable().optional(),
    // BaseInfo
    created_by: pyUuid.nullable().optional(),
    updated_by: pyUuid.nullable().optional(),
    updated_at: isoDatetime,
    created_at: isoDatetime,
  })
  .passthrough();

export type AITeacherInfo = z.infer<typeof AITeacherInfoSchema>;

/** Player-safe field set (no system prompt / LLM config / audit fields) */
export const AITeacherPlayerInfoSchema = z
  .object({
    ai_teacher_id: pyUuid,
    ai_teacher_name: z.string(),
    ai_teacher_name_kana: z.string().nullable().optional(),
    ai_teacher_status: z.nativeEnum(AITeacherStatus),
    ai_teacher_introduction: z.string().nullable().optional(),
    ai_teacher_titles: z.array(z.string()).nullable().optional(),
    ai_teacher_avatar_url: z.string().nullable().optional(),
    ai_teacher_live2d_model_url: z.string().nullable().optional(),
    ai_teacher_live2d_model_image_url: z.string().nullable().optional(),
    ai_teacher_tts_id: pyUuid.nullable().optional(),
    ai_teacher_tts_style: z.string().nullable().optional(),
    ai_teacher_tts_style_prompt: z.string().nullable().optional(),
    ai_teacher_tts_speed: z.number().nullable().optional(),
    ai_teacher_tts_volume: z.number().nullable().optional(),
    ai_teacher_tts_pitch: z.number().nullable().optional(),
    ai_teacher_language: z.string().nullable().optional(),
    org_id: pyUuid,
  })
  .passthrough();

export type AITeacherPlayerInfo = z.infer<typeof AITeacherPlayerInfoSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** AI teacher status enum values (pyEnum lax: accepts only the member's raw string) */
const AI_TEACHER_STATUS_VALUES = Object.values(AITeacherStatus) as readonly string[];
/** LLM provider enum values */
const LLM_PROVIDER_VALUES = Object.values(LLMProvider) as readonly string[];

/** AI teacher list query (AITeacherListRequest) */
export const AITeacherListRequestSchema = PaginationRequestSchema.extend({
  ai_teacher_no: z.string().nullable().optional(),
  ai_teacher_status: pyEnum(AI_TEACHER_STATUS_VALUES).nullable().optional(),
  ai_teacher_statuses: z.string().nullable().optional(),
  ai_teacher_name: z.string().nullable().optional(),
  ai_teacher_name_kana: z.string().nullable().optional(),
  ai_teacher_introduction: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type AITeacherListRequest = z.infer<typeof AITeacherListRequestSchema>;

/** Avatar generation request (AvatarGenerationRequest) */
export const AvatarGenerationRequestSchema = z.object({
  prompt: z.string().min(4).max(1200),
});

export type AvatarGenerationRequest = z.infer<typeof AvatarGenerationRequestSchema>;

/** Live2D model presign request: the object key (or URL) of a .model3.json */
export const AITeacherLive2dModelPresignRequestSchema = z.object({
  model_key: z.string().min(1).max(2048),
});

export type AITeacherLive2dModelPresignRequest = z.infer<typeof AITeacherLive2dModelPresignRequestSchema>;

/**
 * kimi-k3 (Moonshot, OpenAI-protocol compatible) is allowed only as the courseware editor model — the server
 * excludes it for AI teachers, so callers hitting the API directly cannot bypass the /system/llm-providers hiding either.
 */
export const AI_TEACHER_EXCLUDED_MODELS = new Set(["kimi-k3"]);

/** List repr form (matches the Allowed list in the error message verbatim) */
function pyListRepr(values: string[]): string {
  return `[${values.map((value) => `'${value}'`).join(", ")}]`;
}

/** provider/model pair validation */
function validateAiTeacherModelIssue(
  provider: LLMProvider,
  model: string,
): string | null {
  const stripped = model.trim();
  if (provider === LLMProvider.OpenAI && AI_TEACHER_EXCLUDED_MODELS.has(stripped)) {
    return (
      `Model '${stripped}' cannot be used for AI teachers ` +
      "(OpenAI-provider list only; it belongs to Moonshot and is a " +
      "courseware-editor model)"
    );
  }
  // Pair check: a model not in the provider's discovery table (e.g. provider=xai + model=gpt-5.4-mini)
  // would be sent as-is to the provider endpoint, and every teaching session would fail
  const allowed = LLMModelMap[provider] ?? [];
  if (allowed.length > 0 && !allowed.includes(stripped)) {
    return (
      `Model '${stripped}' is not available for provider '${provider}'. ` +
      `Allowed: ${pyListRepr(allowed)}`
    );
  }
  return null;
}

/** URL validation (urlparse semantics; the first failure is reported) */
function aiTeacherUrlViolation(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "URL must be a valid URL";
  }
  if (!parsed.protocol || !parsed.host) {
    return "URL must be a valid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "URL must use http or https protocol";
  }
  return null;
}

/** zod refine wrapper for URL-validated fields (null/undefined pass) */
function aiTeacherUrlRefine() {
  return z
    .string()
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === null || value === undefined) {
        return;
      }
      const violation = aiTeacherUrlViolation(value);
      if (violation !== null) {
        ctx.addIssue({ code: "custom", message: violation });
      }
    });
}

/** AI teacher create request (AITeacherCreateRequest) */
export const AITeacherCreateRequestSchema = z
  .object({
    ai_teacher_no: z.string().nullable().optional(),
    ai_teacher_name: z.string(),
    ai_teacher_name_kana: z.string().nullable().optional(),
    ai_teacher_introduction: z.string().nullable().optional(),
    ai_teacher_titles: z.array(z.string()).nullable().optional(),
    ai_teacher_avatar_url: aiTeacherUrlRefine(),
    ai_teacher_system_prompt: z.string(),
    ai_teacher_llm_provider: pyEnum(LLM_PROVIDER_VALUES),
    ai_teacher_llm_model: z.string(),
    ai_teacher_llm_temperature: z.coerce.number().nullable().optional().default(1),
    ai_teacher_live2d_model_image_url: aiTeacherUrlRefine(),
    /** Temporary object key of a pre-uploaded file (the server moves it to its final location) */
    temp_live2d_model_object_key: z.string().nullable().optional(),
    ai_teacher_tts_id: z.string(),
    ai_teacher_tts_style: z.string().nullable().optional(),
    ai_teacher_tts_speed: z.coerce.number().nullable().optional().default(1),
    ai_teacher_tts_volume: z.coerce.number().nullable().optional().default(1),
    ai_teacher_tts_pitch: z.coerce.number().nullable().optional().default(1),
    ai_teacher_language: z.string().nullable().optional(),
    sort: z.coerce.number().int().nullable().optional(),
    remark: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // model_validator(mode="after") _check_model_provider_pair:
    // model-level error loc = ("body",)
    const issue = validateAiTeacherModelIssue(
      value.ai_teacher_llm_provider as LLMProvider,
      value.ai_teacher_llm_model,
    );
    if (issue !== null) {
      ctx.addIssue({ code: "custom", path: ["body"], message: issue });
    }
  });

export type AITeacherCreateRequest = z.infer<typeof AITeacherCreateRequestSchema>;

/** AI teacher update request (AITeacherUpdateRequest; None = unchanged) */
export const AITeacherUpdateRequestSchema = z
  .object({
    ai_teacher_no: z.string().nullable().optional(),
    ai_teacher_name: z.string().nullable().optional(),
    ai_teacher_name_kana: z.string().nullable().optional(),
    ai_teacher_status: pyEnum(AI_TEACHER_STATUS_VALUES).nullable().optional(),
    ai_teacher_introduction: z.string().nullable().optional(),
    ai_teacher_titles: z.array(z.string()).nullable().optional(),
    ai_teacher_avatar_url: aiTeacherUrlRefine(),
    ai_teacher_system_prompt: z.string().nullable().optional(),
    ai_teacher_llm_provider: pyEnum(LLM_PROVIDER_VALUES).nullable().optional(),
    ai_teacher_llm_model: z.string().nullable().optional(),
    ai_teacher_llm_temperature: z.coerce.number().nullable().optional(),
    ai_teacher_live2d_model_url: aiTeacherUrlRefine(),
    temp_live2d_model_object_key: z.string().nullable().optional(),
    ai_teacher_live2d_model_image_url: aiTeacherUrlRefine(),
    ai_teacher_tts_id: pyUuid.nullable().optional(),
    ai_teacher_tts_style: z.string().nullable().optional(),
    ai_teacher_tts_speed: z.coerce.number().nullable().optional(),
    ai_teacher_tts_volume: z.coerce.number().nullable().optional(),
    ai_teacher_tts_pitch: z.coerce.number().nullable().optional(),
    ai_teacher_language: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // Validated only when a model is actually submitted (partial updates may omit it); with no provider it is checked
    // as OpenAI (the row's current provider is unknown upstream, so a kimi-k3 pair is always refused)
    if (value.ai_teacher_llm_model != null && value.ai_teacher_llm_provider == null) {
      const issue = validateAiTeacherModelIssue(
        LLMProvider.OpenAI,
        value.ai_teacher_llm_model,
      );
      if (issue !== null) {
        ctx.addIssue({ code: "custom", path: ["body"], message: issue });
      }
    } else if (value.ai_teacher_llm_model != null) {
      const issue = validateAiTeacherModelIssue(
        value.ai_teacher_llm_provider as LLMProvider,
        value.ai_teacher_llm_model,
      );
      if (issue !== null) {
        ctx.addIssue({ code: "custom", path: ["body"], message: issue });
      }
    }
  });

export type AITeacherUpdateRequest = z.infer<typeof AITeacherUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** TTSInfo DTO (filled by tts_id in the AI teacher list case) */
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
  updated_at: string;
  created_at: string;
}

/** Live2D model upload response (Live2DModelUploadResponse) */
export interface Live2DModelUploadResponse {
  /** Object key of the uploaded model file */
  object_key: string;
  /** Directory path (base object name) */
  base_object_name: string;
  /** Presigned download URL; with the bucket private, the frontend must prefer model_url */
  model_url: string | null;
}

/** Avatar generation response (AvatarGenerationResponse: an Inochi2D model that passed temporarily) */
export interface AvatarGenerationResponse extends Live2DModelUploadResponse {
  format: string;
  qa_accepted: boolean;
}

/** Avatar generation task accepted response (AvatarGenerationTaskSubmitResponse) */
export interface AvatarGenerationTaskSubmitResponse {
  task_id: string;
  status: "queued";
}

/** Avatar generation task poll response (AvatarGenerationTaskStatusResponse) */
export interface AvatarGenerationTaskStatusResponse {
  task_id: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  result: AvatarGenerationResponse | null;
  error: string | null;
  /** ApiError code name (e.g. ASSET_INSUFFICIENT_BALANCE) when the failure is one */
  error_code: string | null;
}
