// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_GOOGLE_TTS_MODEL, DEFAULT_GOOGLE_TTS_VOICE_ID } from "./google-tts.ts";
import { cliEnv } from "./env.ts";

export type TtsProvider = "google" | "minimax" | "fishaudio";

/**
 * Default recommended style prompt (mirrors the backend's
 * DEFAULT_TTS_STYLE_KEY = friendly_teacher): style-less teachers — e.g.
 * agent/MCP-created ones — narrate with this instead of a bare voice.
 */
export const DEFAULT_GOOGLE_TTS_STYLE_PROMPT =
  "Speak like a warm, friendly teacher; clear, encouraging and patient.";

export interface AITeacher {
  ai_teacher_id: string;
  ai_teacher_name: string;
  runtime: string;
  model_url: string;
  ai_teacher_avatar_url: string;
  ai_teacher_live2d_model_url: string;
  ai_teacher_live2d_model_image_url: string;
  ai_teacher_tts_id?: string;
  ai_teacher_tts_style?: string;
  /** Backend-resolved style prompt (key -> text); empty when the teacher has no style. */
  ai_teacher_tts_style_prompt?: string;
  ai_teacher_tts_provider?: TtsProvider;
  ai_teacher_tts_model?: string;
  ai_teacher_tts_voice?: string;
  ai_teacher_tts_speed?: number;
  ai_teacher_tts_volume?: number;
  ai_teacher_tts_pitch?: number;
  ai_teacher_language?: string;
}

export interface AITeacherTtsSettings {
  provider: TtsProvider;
  model: string;
  /** Persona/delivery hint key resolved to a prompt before synthesis (Google only). */
  style?: string;
  voice_id: string;
  speed: number;
  vol: number;
  pitch: number;
  language_boost?: string;
}

/** Google Gemini TTS; MiniMax / FishAudio stay only for teachers already bound to them. */
export const DEFAULT_TTS_PROVIDER: TtsProvider = "google";
/** Default before Google; still used for provider-less legacy records with a native voice id. */
export const LEGACY_DEFAULT_TTS_PROVIDER: TtsProvider = "minimax";

export const DEFAULT_AI_TEACHER: AITeacher = {
  ai_teacher_id: "00000000-0000-0000-0000-000000000000",
  ai_teacher_name: "AINOBI教师",
  ai_teacher_tts_provider: DEFAULT_TTS_PROVIDER,
  runtime: "live2d",
  model_url:
    "https://courseware.example.com/model/live2d_model/ainobi-teacher-001/ainobi-teacher-001.model3.json",
  ai_teacher_avatar_url: "https://courseware.example.com/model/live2d_model/ainobi-teacher-001/ainobi-teacher-001.png",
  ai_teacher_live2d_model_url:
    "https://courseware.example.com/model/live2d_model/ainobi-teacher-001/ainobi-teacher-001.model3.json",
  ai_teacher_live2d_model_image_url:
    "https://courseware.example.com/model/live2d_model/ainobi-teacher-001/ainobi-teacher-001.png",
};

export const DEFAULT_AI_TEACHERS: readonly AITeacher[] = [DEFAULT_AI_TEACHER];

const stringOrEmpty = (value: unknown): string =>
  typeof value === "string" ? value : "";

const optionalString = (value: unknown): string | undefined => {
  const text = stringOrEmpty(value);
  return text || undefined;
};

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const normalizeTtsProvider = (value: unknown): TtsProvider | undefined => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return undefined;
  if (text === "google" || text === "gemini" || text === "google_gemini") return "google";
  if (text === "minimax" || text === "minimaxi") return "minimax";
  if (text === "fishaudio" || text === "fish.audio" || text === "fish_audio") {
    return "fishaudio";
  }
  return undefined;
};

const applyAiTeacherTtsNested = (teacher: AITeacher, nested: unknown): void => {
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return;
  const tts = nested as Record<string, unknown>;
  const provider = normalizeTtsProvider(tts.tts_provider);
  const model = optionalString(tts.tts_model);
  const voice = optionalString(tts.tts_voice);
  if (provider) teacher.ai_teacher_tts_provider = provider;
  if (model) teacher.ai_teacher_tts_model = model;
  if (voice) teacher.ai_teacher_tts_voice = voice;
};

const normalizeTeacher = (value: unknown): AITeacher | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = stringOrEmpty(raw.ai_teacher_id) || stringOrEmpty(raw.id) || stringOrEmpty(raw.model_id);
  const name = stringOrEmpty(raw.ai_teacher_name) || stringOrEmpty(raw.name);
  const fallbackModelUrl = DEFAULT_AI_TEACHER.ai_teacher_live2d_model_url?.trim() || "";
  const platformLive2dModelUrl =
    stringOrEmpty(raw.ai_teacher_live2d_model_url) || stringOrEmpty(raw.live2d_model_url);
  const hasPlatformLive2dModel = Boolean(platformLive2dModelUrl);
  const usedLive2dFallback = !hasPlatformLive2dModel && Boolean(fallbackModelUrl);
  const modelUrl = hasPlatformLive2dModel
    ? stringOrEmpty(raw.model_url) || platformLive2dModelUrl
    : fallbackModelUrl;
  if (!id || !name) return null;
  const teacher: AITeacher = {
    ai_teacher_id: id,
    ai_teacher_name: name,
    runtime: stringOrEmpty(raw.runtime) || "live2d",
    model_url: modelUrl,
    ai_teacher_avatar_url: usedLive2dFallback
      ? DEFAULT_AI_TEACHER.ai_teacher_avatar_url
      : stringOrEmpty(raw.ai_teacher_avatar_url) || stringOrEmpty(raw.avatar_url),
    ai_teacher_live2d_model_url: modelUrl,
    ai_teacher_live2d_model_image_url: usedLive2dFallback
      ? DEFAULT_AI_TEACHER.ai_teacher_live2d_model_image_url
      : stringOrEmpty(raw.ai_teacher_live2d_model_image_url) ||
        stringOrEmpty(raw.live2d_model_image_url) ||
        modelUrl,
  };
  const ttsId = optionalString(raw.ai_teacher_tts_id) || optionalString(raw.tts_id);
  const ttsProvider =
    normalizeTtsProvider(raw.ai_teacher_tts_provider) ?? normalizeTtsProvider(raw.tts_provider);
  const ttsModel = optionalString(raw.ai_teacher_tts_model) || optionalString(raw.tts_model);
  const ttsVoice = optionalString(raw.ai_teacher_tts_voice) || optionalString(raw.tts_voice);
  const ttsStyle = optionalString(raw.ai_teacher_tts_style);
  const ttsStylePrompt = optionalString(raw.ai_teacher_tts_style_prompt);
  const ttsSpeed = optionalNumber(raw.ai_teacher_tts_speed) ?? optionalNumber(raw.tts_speed);
  const ttsVolume = optionalNumber(raw.ai_teacher_tts_volume) ?? optionalNumber(raw.tts_volume);
  const ttsPitch = optionalNumber(raw.ai_teacher_tts_pitch) ?? optionalNumber(raw.tts_pitch);
  const language = optionalString(raw.ai_teacher_language) || optionalString(raw.language);
  applyAiTeacherTtsNested(teacher, raw.ai_teacher_tts);
  if (ttsId) teacher.ai_teacher_tts_id = ttsId;
  if (ttsProvider) teacher.ai_teacher_tts_provider = ttsProvider;
  if (ttsModel) teacher.ai_teacher_tts_model = ttsModel;
  if (ttsVoice) teacher.ai_teacher_tts_voice = ttsVoice;
  if (ttsStyle) teacher.ai_teacher_tts_style = ttsStyle;
  if (ttsStylePrompt) teacher.ai_teacher_tts_style_prompt = ttsStylePrompt;
  if (ttsSpeed !== undefined) teacher.ai_teacher_tts_speed = ttsSpeed;
  if (ttsVolume !== undefined) teacher.ai_teacher_tts_volume = ttsVolume;
  if (ttsPitch !== undefined) teacher.ai_teacher_tts_pitch = ttsPitch;
  if (language) teacher.ai_teacher_language = language;
  return teacher;
};

export const normalizeTeacherList = (value: unknown): AITeacher[] => {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? ((value as { ai_teachers?: unknown; teachers?: unknown }).ai_teachers ??
        (value as { teachers?: unknown }).teachers)
      : null;
  if (!Array.isArray(rawList)) return [];
  return rawList.flatMap((item) => {
    const teacher = normalizeTeacher(item);
    return teacher ? [teacher] : [];
  });
};

/** Default MiniMax voice when a teacher has no usable voice id. */
export const DEFAULT_TTS_VOICE_ID = "Chinese (Mandarin)_Gentleman";

/** Platform `ai_teacher_tts_id` values are UUIDs (org TTS catalog keys), not provider voice ids. */
const PLATFORM_TTS_RECORD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function defaultTtsVoiceId(provider: TtsProvider = DEFAULT_TTS_PROVIDER): string {
  if (provider === "google") {
    return cliEnv().GEMINI_TTS_VOICE_ID?.trim() || DEFAULT_GOOGLE_TTS_VOICE_ID;
  }
  if (provider === "fishaudio") {
    return (
      cliEnv().FISH_AUDIO_TTS_VOICE_ID?.trim() ||
      cliEnv().MINIMAX_TTS_VOICE_ID?.trim() ||
      DEFAULT_TTS_VOICE_ID
    );
  }
  return cliEnv().MINIMAX_TTS_VOICE_ID?.trim() || DEFAULT_TTS_VOICE_ID;
}

export function isPlatformTtsRecordId(voiceId: string | undefined): boolean {
  const trimmed = voiceId?.trim();
  if (!trimmed) return false;
  return PLATFORM_TTS_RECORD_ID.test(trimmed);
}

/** Voice id passed to the TTS provider (uses nested `tts_voice`, else substitutes catalog UUIDs). */
/**
 * Provider used to synthesize for a teacher. An explicit provider wins. Legacy
 * records without a provider that still carry a provider-native voice id (e.g.
 * `Chinese (Mandarin)_Gentleman` in `ai_teacher_tts_id`) keep the pre-Google
 * default (MiniMax) so their bound voice is not sent to Google and silently
 * replaced; only teachers with no voice at all get the Google default.
 */
export function resolveTeacherTtsProvider(teacher?: AITeacher): TtsProvider {
  if (teacher?.ai_teacher_tts_provider) return teacher.ai_teacher_tts_provider;
  const nativeVoice =
    teacher?.ai_teacher_tts_voice?.trim() ||
    (teacher?.ai_teacher_tts_id?.trim() && !isPlatformTtsRecordId(teacher.ai_teacher_tts_id)
      ? teacher.ai_teacher_tts_id.trim()
      : "");
  return nativeVoice ? LEGACY_DEFAULT_TTS_PROVIDER : DEFAULT_TTS_PROVIDER;
}

export function resolveTeacherTtsVoiceId(teacher?: AITeacher): string {
  const nestedVoice = teacher?.ai_teacher_tts_voice?.trim();
  if (nestedVoice) return nestedVoice;
  const candidate = teacher?.ai_teacher_tts_id?.trim();
  if (!candidate || isPlatformTtsRecordId(candidate)) {
    return defaultTtsVoiceId(resolveTeacherTtsProvider(teacher));
  }
  return candidate;
}

export function defaultTtsModelForProvider(provider: TtsProvider): string {
  if (provider === "google") {
    return cliEnv().GEMINI_TTS_MODEL?.trim() || DEFAULT_GOOGLE_TTS_MODEL;
  }
  if (provider === "fishaudio") {
    return cliEnv().FISH_AUDIO_TTS_MODEL?.trim() || "s1";
  }
  return cliEnv().MINIMAX_TTS_MODEL?.trim() || "speech-2.8-hd";
}

export const selectAITeacher = (
  externalTeachers: readonly AITeacher[],
  teacherId?: string,
): { teacher: AITeacher; source: "external" | "builtin" } => {
  const pool = externalTeachers.length > 0 ? externalTeachers : DEFAULT_AI_TEACHERS;
  const selected = teacherId
    ? pool.find((teacher) => teacher.ai_teacher_id === teacherId)
    : pool[0];
  return {
    teacher: selected ?? DEFAULT_AI_TEACHER,
    source: externalTeachers.length > 0 && selected ? "external" : "builtin",
  };
};

export const resolveTeacherTtsSettings = (teacher?: AITeacher): AITeacherTtsSettings => {
  const provider = resolveTeacherTtsProvider(teacher);
  const model = teacher?.ai_teacher_tts_model?.trim() || defaultTtsModelForProvider(provider);
  return {
    provider,
    model,
    voice_id: resolveTeacherTtsVoiceId(teacher),
    style:
      teacher?.ai_teacher_tts_style_prompt?.trim() ||
      DEFAULT_GOOGLE_TTS_STYLE_PROMPT,
    speed: teacher?.ai_teacher_tts_speed ?? Number(cliEnv().MINIMAX_TTS_SPEED || 1),
    vol: teacher?.ai_teacher_tts_volume ?? Number(cliEnv().MINIMAX_TTS_VOL || 1),
    pitch: teacher?.ai_teacher_tts_pitch ?? Number(cliEnv().MINIMAX_TTS_PITCH || 0),
    ...(teacher?.ai_teacher_language ? { language_boost: teacher.ai_teacher_language } : {}),
  };
};

/** Overlay a platform TTS catalog voice onto a teacher for synthesis (does not mutate the original). */
export const applyTtsCatalogToTeacher = (
  teacher: AITeacher,
  voice: {
    tts_id: string;
    tts_provider: string;
    tts_model: string;
    tts_voice: string;
    tts_speed?: number | null;
    tts_volume?: number | null;
    tts_pitch?: number | null;
    tts_language?: string | null;
  },
): AITeacher => {
  const provider = normalizeTtsProvider(voice.tts_provider) ?? teacher.ai_teacher_tts_provider;
  return {
    ...teacher,
    ai_teacher_tts_id: voice.tts_id,
    ...(provider ? { ai_teacher_tts_provider: provider } : {}),
    ai_teacher_tts_model: voice.tts_model,
    ai_teacher_tts_voice: voice.tts_voice,
    ...(voice.tts_speed != null && Number.isFinite(voice.tts_speed)
      ? { ai_teacher_tts_speed: voice.tts_speed }
      : {}),
    ...(voice.tts_volume != null && Number.isFinite(voice.tts_volume)
      ? { ai_teacher_tts_volume: voice.tts_volume }
      : {}),
    ...(voice.tts_pitch != null && Number.isFinite(voice.tts_pitch)
      ? { ai_teacher_tts_pitch: voice.tts_pitch }
      : {}),
    // Do not overwrite ai_teacher_language: the narration language contract still follows the teacher's config
  };
};

export const aiTeacherMetadata = (teacher: AITeacher): Record<string, unknown> => ({
  ai_teacher_id: teacher.ai_teacher_id,
  ai_teacher_name: teacher.ai_teacher_name,
  runtime: teacher.runtime,
  model_url: teacher.model_url,
  ai_teacher_avatar_url: teacher.ai_teacher_avatar_url,
  ai_teacher_live2d_model_url: teacher.ai_teacher_live2d_model_url,
  ai_teacher_live2d_model_image_url: teacher.ai_teacher_live2d_model_image_url,
  ...(teacher.ai_teacher_tts_id ? { ai_teacher_tts_id: teacher.ai_teacher_tts_id } : {}),
  ...(teacher.ai_teacher_tts_provider ? { ai_teacher_tts_provider: teacher.ai_teacher_tts_provider } : {}),
  ...(teacher.ai_teacher_tts_model ? { ai_teacher_tts_model: teacher.ai_teacher_tts_model } : {}),
  ...(teacher.ai_teacher_tts_voice ? { ai_teacher_tts_voice: teacher.ai_teacher_tts_voice } : {}),
  ...(teacher.ai_teacher_tts_style ? { ai_teacher_tts_style: teacher.ai_teacher_tts_style } : {}),
  ...(teacher.ai_teacher_tts_style_prompt
    ? { ai_teacher_tts_style_prompt: teacher.ai_teacher_tts_style_prompt }
    : {}),
  ...(teacher.ai_teacher_tts_speed !== undefined ? { ai_teacher_tts_speed: teacher.ai_teacher_tts_speed } : {}),
  ...(teacher.ai_teacher_tts_volume !== undefined ? { ai_teacher_tts_volume: teacher.ai_teacher_tts_volume } : {}),
  ...(teacher.ai_teacher_tts_pitch !== undefined ? { ai_teacher_tts_pitch: teacher.ai_teacher_tts_pitch } : {}),
  ...(teacher.ai_teacher_language ? { ai_teacher_language: teacher.ai_teacher_language } : {}),
});
