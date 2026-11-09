// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google Gemini TTS for the CLI: the implementation lives in @ainobi/tts-google (shared with the
 * backend); this module re-exports it and resolves the CLI's credentials from its configuration.
 */
import {
  chooseGoogleTtsBackend,
  DEFAULT_GOOGLE_TTS_API_BASE,
  DEFAULT_GOOGLE_TTS_LOCATION,
  hasGoogleCredentials,
  type GoogleCredentialSource,
  type GoogleTtsBackend,
} from "@ainobi/tts-google";
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
  createGoogleAccessToken,
  decodeGooglePcm,
  encodePcmToMp3,
  encodePcmToMp3Async,
  extractGoogleInteractionAudio,
  hasGoogleCredentials,
  mapWithConcurrency,
  pcmDurationMs,
  readGoogleServiceAccount,
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

/**
 * Where Gemini TTS on Google Cloud Vertex AI runs: a service account (Vertex's Interactions API takes no API key), the
 * project (default: the service account's own), the location, and VERTEXAI_BASE_URL for a relay in front of it.
 */
export const resolveGoogleTtsVertexTarget = (
  env: NodeJS.ProcessEnv = cliEnv(),
): { credentials: GoogleCredentialSource; project: string | null; location: string; apiBase: string | null } => ({
  credentials: {
    credentialsJson: env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim() || null,
    credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || null,
  },
  project: env.VERTEXAI_PROJECT_ID?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim() || null,
  location: env.GEMINI_TTS_LOCATION?.trim() || DEFAULT_GOOGLE_TTS_LOCATION,
  apiBase: env.VERTEXAI_BASE_URL?.trim().replace(/\/+$/, "") || null,
});

/** AI Studio by default; Vertex AI with GEMINI_TTS_VERTEXAI=true, or when only a service account is configured. */
export const resolveGoogleTtsBackend = (env: NodeJS.ProcessEnv = cliEnv()): GoogleTtsBackend =>
  chooseGoogleTtsBackend({
    vertexAi: env.GEMINI_TTS_VERTEXAI,
    hasApiKey: Boolean(resolveGoogleTtsApiKey(env)),
    hasCredentials: hasGoogleCredentials(resolveGoogleTtsVertexTarget(env).credentials),
  });
