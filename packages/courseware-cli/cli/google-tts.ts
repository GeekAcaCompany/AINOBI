// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google Gemini TTS for the CLI: the implementation lives in @ainobi/tts-google (shared with the
 * backend); this module re-exports it and resolves the CLI's credentials from its configuration.
 */
import { DEFAULT_GOOGLE_TTS_API_BASE } from "@ainobi/tts-google";
import { cliEnv } from "./env.ts";

export {
  DEFAULT_GOOGLE_TTS_MODEL,
  DEFAULT_GOOGLE_TTS_VOICE_ID,
  GOOGLE_TTS_MAX_CHUNK_CHARS,
  GOOGLE_TTS_MAX_PARALLEL_CHUNKS,
  GoogleTtsError,
  applyPcmGain,
  buildGoogleSpeedStyle,
  buildGoogleTtsPayload,
  concatPcm,
  decodeGooglePcm,
  encodePcmToMp3,
  encodePcmToMp3Async,
  extractGoogleInteractionAudio,
  mapWithConcurrency,
  pcmDurationMs,
  splitGoogleTtsText,
  synthesizeGoogleSpeech,
  type PcmAudio,
} from "@ainobi/tts-google";

export const resolveGoogleTtsApiKey = (env: NodeJS.ProcessEnv = cliEnv()): string | undefined =>
  env.GEMINI_TTS_API_KEY?.trim() ||
  env.GEMINI_API_KEY?.trim() ||
  env.GOOGLE_CLOUD_API_KEY?.trim() ||
  undefined;

export const resolveGoogleTtsApiBase = (env: NodeJS.ProcessEnv = cliEnv()): string =>
  (env.GEMINI_TTS_API_BASE?.trim() || DEFAULT_GOOGLE_TTS_API_BASE).replace(/\/+$/, "");
