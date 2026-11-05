// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MiniMax TTS — the one implementation the backend provider and the courseware CLI share.
 *
 * Wire protocol: the T2A v2 WebSocket (default wss://api.minimax.io/ws/v1/t2a_v2). After
 * `connected_success` the client sends `task_start` (voice and audio settings, optional
 * pronunciation tone rules), `task_continue` with the text, collects the hex audio of every
 * message until `is_final`, then `task_finish`. Nothing here reads the environment: credentials,
 * endpoint, proxy and timeouts are options.
 */

import type { Agent as HttpAgent } from "node:http";
import ProxyAgent from "proxy-agent";
import type { EventEmitter } from "node:events";
import WebSocket from "ws";
import { countBillableCodePoints, type BaseTTSProvider } from "@ainobi/tts";

/** Deployment settings; the host maps its configuration onto these (nothing is read from the environment). */
export interface MiniMaxSettings {
  api_key: string;
  /** Outbound proxy URI; empty for a direct connection. */
  proxy: string;
  ws_url: string;
  connect_timeout_ms: number;
  synthesis_timeout_ms: number;
  /** Connection attempts before a synthesis fails. */
  connect_attempts: number;
  /** Delay before connection retry n is `retry_delay_ms * n`. */
  retry_delay_ms: number;
  sample_rate: number;
  bitrate: number;
  channel: number;
  english_normalization: boolean;
}

export const DEFAULT_MINIMAX_WS_URL = "wss://api.minimax.io/ws/v1/t2a_v2";

export const DEFAULT_MINIMAX_SETTINGS: MiniMaxSettings = {
  api_key: "",
  proxy: "",
  ws_url: DEFAULT_MINIMAX_WS_URL,
  connect_timeout_ms: 30_000,
  synthesis_timeout_ms: 120_000,
  connect_attempts: 1,
  retry_delay_ms: 500,
  sample_rate: 32000,
  bitrate: 128000,
  channel: 1,
  english_normalization: false,
};

/** The socket surface synthesis uses; `ws` satisfies it, and so can a test double. */
export interface MiniMaxSocket extends EventEmitter {
  readonly readyState: number;
  send(data: string, callback?: (error?: Error) => void): void;
  close(): void;
  terminate(): void;
}

export interface MiniMaxSocketOptions {
  headers: Record<string, string>;
  agent?: HttpAgent;
}

/** Socket seam: replaceable at module level so unit tests can drive a fake server. */
export const outboundWs: {
  connect: (url: string, options: MiniMaxSocketOptions) => MiniMaxSocket;
} = {
  connect: (url, options) => new WebSocket(url, options),
};

const LANGUAGE_BOOST_MAP: Record<string, string> = {
  zh: "Chinese",
  ja: "Japanese",
  en: "English",
};

export interface MiniMaxSpeechOptions {
  apiKey: string;
  wsUrl?: string;
  model: string;
  text: string;
  voiceId: string;
  speed?: number;
  /** Linear volume (1.0 = unchanged). */
  volume?: number;
  pitch?: number;
  /** MiniMax language boost (`Chinese`, `Japanese`, …); `zh` / `ja` / `en` are mapped. */
  languageBoost?: string | null;
  format?: string;
  sampleRate?: number;
  bitrate?: number;
  channel?: number;
  englishNormalization?: boolean;
  /** Pronunciation tone rules (`pronunciation_dict.tone`). */
  pronunciationTone?: readonly string[];
  proxy?: string | null;
  connectTimeoutMs?: number;
  synthesisTimeoutMs?: number;
  connectAttempts?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The `task_start` message. */
export const buildMiniMaxTaskStart = (options: MiniMaxSpeechOptions): Record<string, unknown> => {
  const tone = (options.pronunciationTone ?? []).map((rule) => rule.trim()).filter(Boolean);
  const boost = options.languageBoost
    ? LANGUAGE_BOOST_MAP[String(options.languageBoost).toLowerCase()] ?? String(options.languageBoost)
    : undefined;
  const pitch = Math.round(Number(options.pitch ?? 0));
  return {
    event: "task_start",
    model: options.model,
    voice_setting: {
      voice_id: options.voiceId,
      speed: options.speed ?? 1,
      vol: options.volume ?? 1,
      pitch: Number.isNaN(pitch) ? 0 : pitch,
      ...(boost ? { language_boost: boost } : {}),
      english_normalization: options.englishNormalization ?? false,
    },
    audio_setting: {
      sample_rate: options.sampleRate ?? 32000,
      bitrate: options.bitrate ?? 128000,
      format: options.format || "mp3",
      channel: options.channel ?? 1,
    },
    ...(tone.length > 0 ? { pronunciation_dict: { tone } } : {}),
  };
};

const request = (ws: MiniMaxSocket, payload: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      cleanup();
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.once("message", onMessage);
    ws.once("error", onError);
    ws.send(JSON.stringify(payload), (error) => {
      if (error) {
        cleanup();
        reject(error);
      }
    });
  });

const open = (options: MiniMaxSpeechOptions): Promise<MiniMaxSocket> =>
  new Promise((resolve, reject) => {
    const connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
    const wsOptions: MiniMaxSocketOptions = { headers: { Authorization: `Bearer ${options.apiKey}` } };
    if (options.proxy) wsOptions.agent = new ProxyAgent(options.proxy) as unknown as HttpAgent;
    const ws = outboundWs.connect(options.wsUrl || DEFAULT_MINIMAX_WS_URL, wsOptions);
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
      fn();
    };
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const response = JSON.parse(data.toString()) as Record<string, unknown>;
        if (response.event !== "connected_success") {
          settle(() => reject(new Error(`TTS connection failed: ${JSON.stringify(response)}`)));
          return;
        }
        settle(() => resolve(ws));
      } catch (error) {
        settle(() => reject(error));
      }
    };
    const onError = (error: Error) => settle(() => reject(new Error(error.message || "TTS connection error.")));
    const onClose = () => settle(() => reject(new Error("TTS connection closed before handshake completed.")));
    const timeout = setTimeout(() => {
      settle(() => {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        reject(new Error(`TTS connection timed out after ${connectTimeoutMs}ms.`));
      });
    }, connectTimeoutMs);
    ws.once("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });

const connect = async (options: MiniMaxSpeechOptions): Promise<MiniMaxSocket> => {
  const attempts = Math.max(1, options.connectAttempts ?? 1);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await open(options);
    } catch (error) {
      if (attempt >= attempts) throw error;
      const delay = (options.retryDelayMs ?? 500) * attempt;
      if (delay > 0) await sleep(delay);
    }
  }
};

const finish = (ws: MiniMaxSocket): void => {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ event: "task_finish" }));
  } finally {
    ws.close();
  }
};

const durationOf = (response: Record<string, unknown>): number => {
  const extra = response.extra_info as Record<string, unknown> | undefined;
  const candidates = [extra?.audio_length, extra?.audio_duration, (response.data as Record<string, unknown> | undefined)?.duration_ms];
  const value = candidates.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? 0 : Math.max(0, Math.round(Number(value)));
};

/**
 * Synthesizes `text` over the WebSocket. Returns the audio and the duration MiniMax reports
 * (0 when it reports none). Failures throw with the server message (for example the
 * `status_code` 2054 of an unknown voice).
 */
export const synthesizeMiniMaxSpeech = async (
  options: MiniMaxSpeechOptions,
): Promise<{ audio: Buffer; durationMs: number }> => {
  const synthesisTimeoutMs = options.synthesisTimeoutMs ?? 120_000;
  const ws = await connect(options);
  let durationMs = 0;
  const chunks: Buffer[] = [];
  try {
    const started = await request(ws, buildMiniMaxTaskStart(options));
    if (started.event !== "task_started") {
      throw new Error(`TTS task failed to start: ${JSON.stringify(started)}`);
    }
    ws.send(JSON.stringify({ event: "task_continue", text: options.text }));
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.off("message", onMessage);
        ws.off("error", onError);
        ws.off("close", onClose);
        fn();
      };
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const response = JSON.parse(data.toString()) as Record<string, unknown>;
          if (response.event === "task_failed" || response.event === "error") {
            settle(() => reject(new Error(`TTS synthesis failed: ${JSON.stringify(response)}`)));
            return;
          }
          const audioHex = (response.data as Record<string, unknown> | undefined)?.audio;
          if (typeof audioHex === "string" && audioHex.length > 0) {
            // Buffer.from silently truncates invalid hex, which would deliver a cut-off payload as complete audio
            if (!/^(?:[0-9a-fA-F]{2})+$/.test(audioHex)) {
              settle(() => reject(new Error("TTS returned invalid hex audio.")));
              return;
            }
            chunks.push(Buffer.from(audioHex, "hex"));
          }
          if (response.is_final === true) {
            durationMs = durationOf(response);
            settle(() => resolve());
          }
        } catch (error) {
          settle(() => reject(error));
        }
      };
      const onError = (error: Error) => settle(() => reject(error));
      const onClose = () => settle(() => reject(new Error("TTS connection closed before synthesis completed.")));
      const timeout = setTimeout(() => {
        settle(() => reject(new Error(`TTS synthesis timed out after ${synthesisTimeoutMs}ms.`)));
      }, synthesisTimeoutMs);
      ws.on("message", onMessage);
      ws.once("error", onError);
      ws.once("close", onClose);
    });
  } finally {
    finish(ws);
  }
  return { audio: Buffer.concat(chunks), durationMs };
};

export class MiniMaxProvider implements BaseTTSProvider {
  model: string;
  api_key: string | null;
  api_base: string | null;
  proxy: string | null;
  readonly settings: MiniMaxSettings;

  constructor(params: {
    model?: string;
    api_key?: string | null;
    api_base?: string | null;
    settings?: Partial<MiniMaxSettings>;
  } & Record<string, unknown>) {
    this.settings = { ...DEFAULT_MINIMAX_SETTINGS, ...params.settings };
    this.model = params.model ?? "speech-2.8-hd";
    this.api_key = params.api_key ?? null;
    // api_base names the WebSocket endpoint for this provider
    this.api_base = params.api_base ?? null;

    if (!this.api_key) {
      this.api_key = this.settings.api_key;
      if (!this.api_key) {
        throw new Error(
          "MiniMax API key not provided and MINIMAX_API_KEY environment variable is not set",
        );
      }
    }

    if (!this.api_base) {
      this.api_base = this.settings.ws_url;
    }

    this.proxy = (params.proxy as string | undefined) || this.settings.proxy || null;
  }

  /** Synthesizes and also returns the duration MiniMax reports. */
  async synthesize(params: {
    text: string;
    voice_id: string;
    speed?: number;
    format?: string;
    [key: string]: unknown;
  }): Promise<{ audio: Buffer; durationMs: number }> {
    return synthesizeMiniMaxSpeech({
      apiKey: this.api_key ?? "",
      wsUrl: this.api_base ?? undefined,
      model: this.model,
      text: params.text,
      voiceId: params.voice_id,
      speed: params.speed !== null && params.speed !== undefined ? Number(params.speed) : 1,
      volume: Number(params.vol ?? params.volume ?? 1),
      pitch: Number(params.pitch ?? 0),
      languageBoost: (params.language_boost ?? params.language) as string | undefined,
      format: (params.format || "mp3").toLowerCase().replace(/^\./, ""),
      sampleRate: this.settings.sample_rate,
      bitrate: this.settings.bitrate,
      channel: this.settings.channel,
      englishNormalization: this.settings.english_normalization,
      pronunciationTone: params.pronunciation_tone as readonly string[] | undefined,
      proxy: this.proxy,
      connectTimeoutMs: this.settings.connect_timeout_ms,
      synthesisTimeoutMs: this.settings.synthesis_timeout_ms,
      connectAttempts: this.settings.connect_attempts,
      retryDelayMs: this.settings.retry_delay_ms,
    });
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
    // temperature / top_p are part of the port signature; MiniMax does not use them
    const { audio } = await this.synthesize(params);
    if (audio.length === 0) {
      throw new Error("MiniMax TTS returned empty audio");
    }
    return audio;
  }

  async close(): Promise<void> {
    // Every synthesis opens and finishes its own WebSocket
  }

  get_service_code(): string {
    // The billing code matches the configs/service_prices.csv import (the model name is the code)
    return this.model.toLowerCase().replace(/ /g, "_");
  }

  get_billable_units(text: string): number {
    return countBillableCodePoints(text);
  }
}
