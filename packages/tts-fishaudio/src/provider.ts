// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fish Audio TTS — the one implementation the backend provider and the courseware CLI share.
 *
 * Wire protocol: POST {endpoint} (default https://api.fish.audio/v1/tts) with a JSON TTSRequest,
 * headers `model: {model}` and `Authorization: Bearer {key}`; the response body is the audio.
 * Loudness is normalized and the volume is applied as prosody gain in dB. Nothing here reads the
 * environment: credentials, endpoint, proxy and timeout are options.
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { BaseTTSProvider } from "@ainobi/tts";

/** Deployment settings; the host maps its configuration onto these (nothing is read from the environment). */
export interface FishAudioSettings {
  api_key: string;
  /** API base; requests go to {service_url}/v1/tts unless `endpoint` is set. */
  service_url: string;
  /** Full TTS endpoint URL; overrides `service_url`. */
  endpoint: string;
  /** Outbound proxy URI; empty for a direct connection. */
  proxy: string;
  mp3_bitrate: number;
  /** Request timeout in milliseconds; 0 = none (synthesis time grows with the text length). */
  timeout_ms: number;
}

export const DEFAULT_FISHAUDIO_SETTINGS: FishAudioSettings = {
  api_key: "",
  service_url: "https://api.fish.audio",
  endpoint: "",
  proxy: "",
  mp3_bitrate: 128,
  timeout_ms: 0,
};

/** A non-2xx Fish Audio response: the API's `{status, message}` when present, plus the raw body. */
export class FishAudioHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiMessage: string,
    public readonly body: string = "",
    /** The HTTP status (`status` prefers the API's own code). */
    public readonly httpStatus: number = status,
  ) {
    super(`${status} ${apiMessage}`);
    this.name = "FishAudioHttpError";
  }
}

/**
 * Outbound HTTP seam: in proxy mode, fetch and ProxyAgent must come from the same undici
 * (requests hang when the dispatcher and fetch major versions differ). Replaceable at module
 * level so unit tests can inject stubs.
 */
export const outboundHttp: {
  fetch: typeof fetch;
  proxyAgent: (uri: string) => unknown;
} = {
  fetch: undiciFetch as unknown as typeof fetch,
  proxyAgent: (uri) => new ProxyAgent(uri),
};

/** Fish Audio `model` header values (callers may send `S1`, `s2-pro`, `s2.1-pro`, etc.). */
export const normalizeFishAudioModel = (model: string): string => {
  const trimmed = model.trim().toLowerCase();
  if (!trimmed) return "s1";
  if (trimmed === "s1" || trimmed === "s-1") return "s1";
  if (trimmed === "s2-pro" || trimmed === "s2pro" || trimmed === "s2") return "s2-pro";
  return trimmed;
};

/** Linear volume multiplier → prosody gain in dB (±12 dB, 1.0 → 0). */
export const fishAudioVolumeDb = (volume: number): number => {
  if (!Number.isFinite(volume) || volume === 1) return 0;
  return Math.max(-12, Math.min(12, (volume - 1) * 12));
};

export interface FishAudioSpeechOptions {
  apiKey: string;
  /** Full TTS endpoint URL. */
  endpoint?: string;
  model: string;
  text: string;
  voiceId: string;
  format?: string;
  speed?: number;
  /** Linear volume multiplier (1.0 = unchanged). */
  volume?: number;
  mp3Bitrate?: number;
  /** Sampling parameters; sent only when given. */
  temperature?: number;
  topP?: number;
  proxy?: string | null;
  /** 0 or undefined = no timeout. */
  timeoutMs?: number;
}

/** The TTSRequest body. */
export const buildFishAudioRequest = (options: FishAudioSpeechOptions): Record<string, unknown> => ({
  text: options.text,
  reference_id: options.voiceId,
  format: options.format || "mp3",
  normalize: true,
  mp3_bitrate: options.mp3Bitrate ?? 128,
  prosody: {
    speed: options.speed ?? 1,
    volume: fishAudioVolumeDb(options.volume ?? 1),
    normalize_loudness: true,
  },
  ...(Number.isFinite(options.temperature) ? { temperature: options.temperature } : {}),
  ...(Number.isFinite(options.topP) ? { top_p: options.topP } : {}),
});

/** Synthesizes `text`; throws FishAudioHttpError for non-2xx responses. Returns the audio bytes. */
export const synthesizeFishAudioSpeech = async (options: FishAudioSpeechOptions): Promise<Buffer> => {
  const timeoutMs = options.timeoutMs ?? 0;
  const response = await outboundHttp.fetch(options.endpoint || "https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      accept: "audio/*,application/octet-stream",
      model: normalizeFishAudioModel(options.model),
    },
    body: JSON.stringify(buildFishAudioRequest(options)),
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    // undici's dispatcher isn't in the DOM RequestInit, yet under Node types it is a concrete Dispatcher
    ...(options.proxy ? { dispatcher: outboundHttp.proxyAgent(options.proxy) } : {}),
  } as RequestInit);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let status = response.status;
    let message = response.statusText || "HTTP error";
    try {
      const data = JSON.parse(body) as { status?: number; message?: string };
      if (data && typeof data === "object") {
        if (typeof data.status === "number") status = data.status;
        message = data.message ?? data.status?.toString() ?? message;
      }
    } catch {
      if (body) message = body;
    }
    throw new FishAudioHttpError(status, message, body || response.statusText, response.status);
  }
  return Buffer.from(await response.arrayBuffer());
};

export class FishAudioProvider implements BaseTTSProvider {
  model: string;
  api_key: string | null;
  api_base: string | null;
  readonly settings: FishAudioSettings;

  constructor(params: {
    model?: string;
    api_key?: string | null;
    api_base?: string | null;
    settings?: Partial<FishAudioSettings>;
  } & Record<string, unknown>) {
    this.settings = { ...DEFAULT_FISHAUDIO_SETTINGS, ...params.settings };
    this.model = params.model ?? "s2.1-pro";
    this.api_key = params.api_key ?? null;
    this.api_base = params.api_base ?? null;

    if (!this.api_key) {
      this.api_key = this.settings.api_key;
      if (!this.api_key) {
        throw new Error(
          "FishAudio API key not provided and FISH_TTS_API_KEY environment variable is not set",
        );
      }
    }

    if (!this.api_base) {
      this.api_base = this.settings.service_url;
    }
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
    return synthesizeFishAudioSpeech({
      apiKey: this.api_key ?? "",
      endpoint: this.settings.endpoint || `${(this.api_base ?? "").replace(/\/+$/, "")}/v1/tts`,
      model: this.model || "s2.1-pro",
      text: params.text,
      voiceId: params.voice_id,
      format: params.format || "mp3",
      speed: params.speed || 1,
      volume: Number(params.vol ?? params.volume ?? 1),
      mp3Bitrate: this.settings.mp3_bitrate,
      temperature: params.temperature,
      topP: params.top_p,
      proxy: this.settings.proxy || null,
      timeoutMs: this.settings.timeout_ms,
    });
  }

  async close(): Promise<void> {
    // No persistent connection (each request is an independent fetch)
  }

  get_service_code(): string {
    // The canonical code keeps the dot of the model version (e.g. "fishaudio-s2.1-pro"), aligned with the production
    // service_price row and AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE
    return `fishaudio-${this.model.toLowerCase()}`;
  }

  get_billable_units(text: string): number {
    // Fish Audio bills by UTF-8 bytes, not characters
    return Buffer.byteLength(text, "utf8");
  }
}
