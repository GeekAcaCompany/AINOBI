// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google Gemini TTS provider for the `@ainobi/tts` port, built on the shared implementation in
 * speech.ts (the one the courseware CLI uses). Output is MP3 (LAME) or WAV.
 */

import { countBillableCodePoints, type BaseTTSProvider } from "@ainobi/tts";
import {
  DEFAULT_GOOGLE_TTS_API_BASE,
  DEFAULT_GOOGLE_TTS_MODEL,
  encodePcmToMp3Async,
  encodePcmToWav,
  synthesizeGoogleSpeech,
} from "./speech.ts";

/** Deployment settings; the host maps its configuration onto these (nothing is read from the environment). */
export interface GoogleTTSSettings {
  api_key: string;
  api_base: string;
  /** Outbound proxy URI; empty for a direct connection. */
  proxy: string;
  model: string;
  /** Request timeout in seconds. */
  service_timeout: number;
  mp3_bitrate_kbps: number;
  /** Attempts per chunk on transient failures (429, 5xx, network). */
  chunk_attempts: number;
  /** Delay before retry n is `retry_delay_ms * n`. */
  retry_delay_ms: number;
}

export const DEFAULT_GOOGLE_TTS_SETTINGS: GoogleTTSSettings = {
  api_key: "",
  api_base: DEFAULT_GOOGLE_TTS_API_BASE,
  proxy: "",
  model: DEFAULT_GOOGLE_TTS_MODEL,
  service_timeout: 180,
  mp3_bitrate_kbps: 128,
  chunk_attempts: 3,
  retry_delay_ms: 1000,
};

export const GOOGLE_TTS_SUPPORTED_FORMATS = new Set(["mp3", "wav"]);

export class GoogleTTSProvider implements BaseTTSProvider {
  model: string;
  api_key: string | null;
  api_base: string | null;
  proxy: string | null;
  timeout: number;
  readonly settings: GoogleTTSSettings;

  constructor(params: {
    model?: string;
    api_key?: string | null;
    api_base?: string | null;
    settings?: Partial<GoogleTTSSettings>;
  } & Record<string, unknown>) {
    this.settings = { ...DEFAULT_GOOGLE_TTS_SETTINGS, ...params.settings };
    this.model = params.model || this.settings.model;
    this.api_key = params.api_key ?? null;
    this.api_base = params.api_base ?? null;

    if (!this.api_key) {
      this.api_key = this.settings.api_key;
      if (!this.api_key) {
        throw new Error(
          "Google TTS API key not provided and GEMINI_TTS_API_KEY / GEMINI_API_KEY / GOOGLE_CLOUD_API_KEY are not set",
        );
      }
    }

    if (!this.api_base) {
      this.api_base = this.settings.api_base;
    }
    this.api_base = this.api_base.replace(/\/+$/, "");

    this.proxy = (params.proxy as string | undefined) || this.settings.proxy || null;
    this.timeout = Number(params.timeout) || this.settings.service_timeout || 180;
  }

  async textToSpeech(params: {
    text: string;
    voice_id: string;
    speed: number;
    temperature: number;
    top_p: number;
    format: string;
    [key: string]: unknown;
  }): Promise<Buffer> {
    const audioFormat = (params.format || "mp3").toLowerCase().replace(/^\./, "");
    if (!GOOGLE_TTS_SUPPORTED_FORMATS.has(audioFormat)) {
      throw new Error(`Unsupported Google TTS format '${audioFormat}' (mp3 or wav)`);
    }
    // temperature / top_p are not used by Gemini TTS
    const { pcm } = await synthesizeGoogleSpeech({
      apiKey: this.api_key ?? "",
      apiBase: this.api_base ?? undefined,
      model: this.model,
      text: params.text,
      voiceId: params.voice_id,
      speed: params.speed,
      style: String(params.style ?? "").trim() || null,
      volume: Number(params.vol ?? params.volume ?? 1.0),
      proxy: this.proxy,
      timeoutMs: this.timeout * 1000,
      chunkAttempts: this.settings.chunk_attempts,
      retryDelayMs: this.settings.retry_delay_ms,
    });
    return audioFormat === "wav" ? encodePcmToWav(pcm) : encodePcmToMp3Async(pcm, this.settings.mp3_bitrate_kbps);
  }

  async close(): Promise<void> {
    // Each request is an independent fetch, no persistent client
  }

  get_service_code(): string {
    return this.model.toLowerCase().replace(/ /g, "_");
  }

  get_billable_units(text: string): number {
    return countBillableCodePoints(text);
  }
}
