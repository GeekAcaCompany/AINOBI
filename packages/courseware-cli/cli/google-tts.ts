// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google Gemini TTS for the CLI: the implementation lives in @ainobi/tts-google (shared with the
 * backend); this module re-exports it and resolves the CLI's credentials from its configuration.
 */
import { DEFAULT_GOOGLE_TTS_LOCATION, type GoogleCredentialSource } from "@ainobi/tts-google";
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

/**
 * Where Gemini TTS runs: Google Cloud Vertex AI's Interactions API, with a service account (it takes no API key). The
 * project defaults to the service account's own; VERTEXAI_BASE_URL puts a relay in front of Vertex AI.
 */
export const resolveGoogleTtsTarget = (
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
