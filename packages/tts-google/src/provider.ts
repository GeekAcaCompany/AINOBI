// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google Gemini TTS provider for the `@ainobi/tts` port, built on the shared implementation in
 * speech.ts (the one the courseware CLI uses). Output is MP3 (LAME) or WAV. It runs on Google
 * Cloud Vertex AI with a service account.
 */

import { countBillableCodePoints, type BaseTTSProvider } from "@ainobi/tts";
import { createGoogleAccessToken, hasGoogleCredentials, readGoogleServiceAccount, type GoogleCredentialSource } from "./google-auth.ts";
import {
  DEFAULT_GOOGLE_TTS_LOCATION,
  DEFAULT_GOOGLE_TTS_MODEL,
  encodePcmToMp3Async,
  encodePcmToWav,
  synthesizeGoogleSpeech,
} from "./speech.ts";

/** Deployment settings; the host maps its configuration onto these (nothing is read from the environment). */
export interface GoogleTTSSettings {
  /** A service account key, inline JSON or a file path, or a ready access token. */
  credentials_json: string;
  credentials_path: string;
  access_token: string;
  /** The Google Cloud project; empty to use the service account's own project. */
  project: string;
  /** The Vertex AI location of the Interactions endpoint. */
  location: string;
  /** Vertex AI's address, or a relay in front of it; empty for the location's default. */
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
  credentials_json: "",
  credentials_path: "",
  access_token: "",
  project: "",
  location: DEFAULT_GOOGLE_TTS_LOCATION,
  api_base: "",
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
  proxy: string | null;
  timeout: number;
  readonly settings: GoogleTTSSettings;
  private readonly credentials: GoogleCredentialSource;
  private readonly accessToken: () => Promise<string>;
  private project: string | null;

  constructor(params: {
    model?: string;
    settings?: Partial<GoogleTTSSettings>;
  } & Record<string, unknown>) {
    this.settings = { ...DEFAULT_GOOGLE_TTS_SETTINGS, ...params.settings };
    this.model = params.model || this.settings.model;
    this.credentials = {
      accessToken: this.settings.access_token,
      credentialsJson: this.settings.credentials_json,
      credentialsPath: this.settings.credentials_path,
    };
    if (!hasGoogleCredentials(this.credentials)) {
      throw new Error("Google TTS needs Google Cloud credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service account key file");
    }
    this.accessToken = createGoogleAccessToken(this.credentials);
    this.project = this.settings.project.trim() || null;
    this.proxy = (params.proxy as string | undefined) || this.settings.proxy || null;
    this.timeout = Number(params.timeout) || this.settings.service_timeout || 180;
  }

  /** The configured project, else the one the service account belongs to. */
  private async resolveProject(): Promise<string> {
    if (this.project) return this.project;
    const project = (await readGoogleServiceAccount(this.credentials))?.project_id?.trim();
    if (!project) {
      throw new Error("Google TTS needs a Google Cloud project: set GOOGLE_CLOUD_PROJECT");
    }
    this.project = project;
    return project;
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
      accessToken: this.accessToken,
      project: await this.resolveProject(),
      location: this.settings.location,
      apiBase: this.settings.api_base || null,
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
