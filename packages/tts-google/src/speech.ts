// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google Gemini TTS (Interactions endpoint) — the one implementation the backend provider and the
 * courseware CLI share. It runs on the Gemini Developer API (AI Studio, an API key) or on Google
 * Cloud Vertex AI (a service account's access token, addressed by project and location); the
 * request body is the same on both.
 *
 * The delivery style travels in its own `speech_metadata` annotation, apart from the text, so it
 * is never read aloud.
 *
 * The API answers with 24 kHz mono 16-bit WAV (or raw L16); callers store MP3, so the PCM is
 * encoded locally. Gemini TTS has no numeric speed / volume / pitch fields: speed becomes a
 * `speech_metadata.style` delivery hint, volume a PCM gain, pitch is ignored (the timbre is fixed
 * by the voice id). Nothing here reads the environment: credentials, proxy, timeouts and the
 * retry policy are options.
 */
import { Mp3Encoder } from "@breezystack/lamejs";
import { fetch as undiciFetch, ProxyAgent } from "undici";

export const DEFAULT_GOOGLE_TTS_MODEL = "gemini-3.8-flash-tts";
/** Multilingual base voice (works for zh / ja / en). */
export const DEFAULT_GOOGLE_TTS_VOICE_ID = "kore";
export const DEFAULT_GOOGLE_TTS_API_BASE = "https://generativelanguage.googleapis.com";
export const DEFAULT_GOOGLE_TTS_LOCATION = "global";

/** Where Gemini TTS runs: the Gemini Developer API (AI Studio) with an API key, or Vertex AI with an access token. */
export type GoogleTtsTarget =
  | { backend: "gemini_api"; apiKey: string; apiBase?: string | null }
  | {
      backend: "vertexai";
      /** A Google Cloud access token for each request (see createGoogleAccessToken). */
      accessToken: () => Promise<string>;
      project: string;
      location?: string | null;
      /** Vertex AI's address, or a relay in front of it; default from the location. */
      apiBase?: string | null;
    };

export type GoogleTtsBackend = GoogleTtsTarget["backend"];

/**
 * Which backend to use. An explicit choice (hosts read GEMINI_TTS_VERTEXAI, like GEMINI_LIVE_VERTEXAI) wins;
 * otherwise an API key means AI Studio, and a service account alone means Vertex AI.
 */
export const chooseGoogleTtsBackend = (args: {
  vertexAi?: string | null;
  hasApiKey: boolean;
  hasCredentials: boolean;
}): GoogleTtsBackend => {
  const choice = args.vertexAi?.trim().toLowerCase();
  if (choice === "true" || choice === "1") return "vertexai";
  if (choice === "false" || choice === "0") return "gemini_api";
  return !args.hasApiKey && args.hasCredentials ? "vertexai" : "gemini_api";
};

/** Vertex AI's address for a location: the global endpoint, or the regional one. */
export const googleTtsApiBase = (location: string = DEFAULT_GOOGLE_TTS_LOCATION): string =>
  location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;

/** The Interactions endpoint of a project and location on Vertex AI. */
export const googleTtsInteractionsUrl = (args: { apiBase?: string | null; project: string; location?: string | null }): string => {
  const location = args.location?.trim() || DEFAULT_GOOGLE_TTS_LOCATION;
  const apiBase = (args.apiBase?.trim() || googleTtsApiBase(location)).replace(/\/+$/, "");
  return `${apiBase}/v1beta1/projects/${encodeURIComponent(args.project)}/locations/${encodeURIComponent(location)}/interactions`;
};

const SPEED_EPSILON = 0.05;

/**
 * A single Gemini TTS request silently truncates long text (2000 Chinese characters come back at
 * only ~2/3 of the duration) and nears the timeout, so long text is split into sentences,
 * synthesized, and the PCM concatenated.
 */
export const GOOGLE_TTS_MAX_CHUNK_CHARS = 500;
export const GOOGLE_TTS_MAX_PARALLEL_CHUNKS = 4;

const SENTENCE_END = /(?<=[。！？!?；;\n])|(?<=[.])(?=\s)/u;
const CLAUSE_END = /(?<=[，,、：:])/u;

/** Split text into chunks ≤ maxChars code points at sentence, then clause, then hard cuts. */
export const splitGoogleTtsText = (
  text: string,
  maxChars: number = GOOGLE_TTS_MAX_CHUNK_CHARS,
): string[] => {
  const length = (value: string): number => Array.from(value).length;
  if (length(text) <= maxChars) return [text];
  const pieces: string[] = [];
  for (const sentence of text.split(SENTENCE_END)) {
    if (length(sentence) <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    for (const clause of sentence.split(CLAUSE_END)) {
      let rest = Array.from(clause);
      while (rest.length > maxChars) {
        pieces.push(rest.slice(0, maxChars).join(""));
        rest = rest.slice(maxChars);
      }
      pieces.push(rest.join(""));
    }
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && length(current) + length(piece) > maxChars) {
      chunks.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.trim().length > 0);
};

/**
 * Run async tasks with bounded concurrency, preserving input order in the result.
 * On the first failure no new task is started and the in-flight ones are awaited
 * before the error propagates, so a caller-level retry never overlaps stragglers
 * (which would exceed `limit` and re-request already-synthesized chunks).
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async (): Promise<void> => {
    while (!failure && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        if (!failure) failure = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
};

export type PcmAudio = { samples: Int16Array; sampleRate: number; channels: number };

/** Concatenate PCM chunks (all must share sample rate / channels). */
export const concatPcm = (parts: readonly PcmAudio[]): PcmAudio => {
  if (parts.length === 0) throw new Error("Google TTS returned no audio chunks.");
  const { sampleRate, channels } = parts[0] as PcmAudio;
  if (parts.some((part) => part.sampleRate !== sampleRate || part.channels !== channels)) {
    throw new Error("Google TTS returned chunks with mismatched audio formats.");
  }
  const total = parts.reduce((sum, part) => sum + part.samples.length, 0);
  const samples = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    samples.set(part.samples, offset);
    offset += part.samples.length;
  }
  return { samples, sampleRate, channels };
};

/** Numeric speed multiplier → Gemini delivery style hint (undefined when ~1.0). */
export const buildGoogleSpeedStyle = (speed: number | null | undefined): string | undefined => {
  const value = Number(speed ?? 1);
  if (!Number.isFinite(value) || value <= 0 || Math.abs(value - 1) < SPEED_EPSILON) {
    return undefined;
  }
  const direction = value > 1 ? "faster" : "slower";
  return (
    `Speak ${direction} than a normal speaking pace, ` +
    `at about ${value.toFixed(2)}x normal speed, keeping a clear teaching delivery`
  );
};

export const buildGoogleTtsPayload = (args: {
  model: string;
  text: string;
  voiceId: string;
  speed?: number | null;
  /** Persona/delivery hint merged with the speed hint into one style string. */
  style?: string | null;
}): Record<string, unknown> => {
  const hints = [(args.style ?? "").trim(), buildGoogleSpeedStyle(args.speed) ?? ""].filter(
    (hint) => hint !== "",
  );
  const style = hints.length > 0 ? hints.join("; ") : undefined;
  return {
    model: args.model,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: args.text,
            ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}),
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: args.voiceId }] },
  };
};

/** Last audio output of an Interactions response → bytes + mime type. */
export const extractGoogleInteractionAudio = (
  body: Record<string, unknown>,
): { audio: Buffer; mimeType: string } => {
  const error = body.error as { message?: unknown } | string | undefined;
  if (error) {
    const message = typeof error === "string" ? error : String(error.message ?? "unknown error");
    throw new Error(`Google TTS failed: ${message}`);
  }
  const steps = Array.isArray(body.steps) ? (body.steps as Array<Record<string, unknown>>) : [];
  const parts = steps
    .filter((step) => step?.type === "model_output")
    .flatMap((step) => (Array.isArray(step.content) ? (step.content as Array<Record<string, unknown>>) : []))
    .filter((content) => content?.type === "audio");
  const last = parts[parts.length - 1];
  const data = typeof last?.data === "string" ? last.data : "";
  if (!data) {
    throw new Error(`Google TTS returned no audio (status=${String(body.status ?? "unknown")})`);
  }
  const audio = Buffer.from(data, "base64");
  if (audio.length === 0) {
    throw new Error("Google TTS returned empty audio.");
  }
  return { audio, mimeType: typeof last?.mime_type === "string" ? last.mime_type : "audio/wav" };
};

/** Decode RIFF/WAV (16-bit PCM) or raw `audio/l16` (Gemini: little-endian). */
export const decodeGooglePcm = (audio: Buffer, mimeType: string): PcmAudio => {
  const mime = mimeType.toLowerCase();
  if (mime.includes("l16") || mime.includes("pcm")) {
    const rateMatch = /rate=(\d+)/.exec(mime);
    const count = Math.floor(audio.length / 2);
    const samples = new Int16Array(count);
    // Gemini documents audio/l16 as headerless 16-bit signed little-endian PCM
    // (not the RFC 2586 big-endian wire order).
    for (let i = 0; i < count; i += 1) samples[i] = audio.readInt16LE(i * 2);
    return { samples, sampleRate: rateMatch ? Number(rateMatch[1]) : 24000, channels: 1 };
  }

  if (audio.length < 12 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Google TTS returned audio that is neither WAV nor L16.");
  }
  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bitsPerSample = 16;
  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = audio.readUInt16LE(body + 2);
      sampleRate = audio.readUInt32LE(body + 4);
      bitsPerSample = audio.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bitsPerSample !== 16) {
        throw new Error(`Google TTS returned unsupported sample width: ${bitsPerSample} bits.`);
      }
      const end = Math.min(audio.length, body + size);
      const count = Math.floor((end - body) / 2);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i += 1) samples[i] = audio.readInt16LE(body + i * 2);
      return { samples, sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("Google TTS WAV has no data chunk.");
};

/**
 * Linear volume multiplier on 16-bit PCM (clipped). 0 → silence; ~1.0, negative or
 * invalid values return the input unchanged.
 */
export const applyPcmGain = (samples: Int16Array, volume: number | null | undefined): Int16Array => {
  const gain = Number(volume ?? 1);
  if (!Number.isFinite(gain) || gain < 0 || Math.abs(gain - 1) < 1e-3) return samples;
  if (gain === 0) return new Int16Array(samples.length);
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round((samples[i] as number) * gain)));
  }
  return out;
};

export const pcmDurationMs = (pcm: PcmAudio): number =>
  Math.round((pcm.samples.length / Math.max(1, pcm.channels) / pcm.sampleRate) * 1000);

/** Feed PCM to the LAME encoder frame by frame; yields after each encoded frame batch. */
function* encodeMp3Frames(pcm: PcmAudio, bitrateKbps: number): Generator<Buffer> {
  const channels = pcm.channels === 2 ? 2 : 1;
  const encoder = new Mp3Encoder(channels, pcm.sampleRate, bitrateKbps);
  const frame = 1152;
  const toBuffer = (out: Int8Array | Uint8Array): Buffer =>
    Buffer.from(out.buffer, out.byteOffset, out.length);
  if (channels === 1) {
    for (let i = 0; i < pcm.samples.length; i += frame) {
      yield toBuffer(encoder.encodeBuffer(pcm.samples.subarray(i, i + frame)));
    }
  } else {
    const frames = Math.floor(pcm.samples.length / 2);
    const left = new Int16Array(frames);
    const right = new Int16Array(frames);
    for (let i = 0; i < frames; i += 1) {
      left[i] = pcm.samples[i * 2] as number;
      right[i] = pcm.samples[i * 2 + 1] as number;
    }
    for (let i = 0; i < frames; i += frame) {
      yield toBuffer(encoder.encodeBuffer(left.subarray(i, i + frame), right.subarray(i, i + frame)));
    }
  }
  yield toBuffer(encoder.flush());
}

/** Encode 16-bit PCM to CBR MP3 (mono or interleaved stereo), synchronously. */
export const encodePcmToMp3 = (pcm: PcmAudio, bitrateKbps = 128): Buffer =>
  Buffer.concat([...encodeMp3Frames(pcm, bitrateKbps)].filter((chunk) => chunk.length > 0));

/** Frames encoded between event-loop yields (~1s of 24 kHz audio). */
const MP3_FRAMES_PER_YIELD = 21;

/**
 * Same as {@link encodePcmToMp3} but yields to the event loop periodically: hosts serve TTS
 * in-process, and pure-JS LAME takes ~3.3s for 10 minutes of audio, which would otherwise stall
 * every other request.
 */
export const encodePcmToMp3Async = async (pcm: PcmAudio, bitrateKbps = 128): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let sinceYield = 0;
  for (const chunk of encodeMp3Frames(pcm, bitrateKbps)) {
    if (chunk.length > 0) chunks.push(chunk);
    sinceYield += 1;
    if (sinceYield >= MP3_FRAMES_PER_YIELD) {
      sinceYield = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return Buffer.concat(chunks);
};

/** 16-bit PCM → RIFF/WAV container. */
export const encodePcmToWav = (pcm: PcmAudio): Buffer => {
  const data = Buffer.from(pcm.samples.buffer, pcm.samples.byteOffset, pcm.samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(pcm.channels, 22);
  header.writeUInt32LE(pcm.sampleRate, 24);
  header.writeUInt32LE((pcm.sampleRate * pcm.channels * 2) >>> 0, 28); // byte rate
  header.writeUInt16LE(pcm.channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

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

/** A failed Gemini TTS request; `transient` failures (429, 5xx, network) are retried per chunk. */
export class GoogleTtsError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleTtsError";
  }
}

export interface GoogleSpeechOptions {
  target: GoogleTtsTarget;
  model?: string;
  text: string;
  voiceId: string;
  speed?: number | null;
  style?: string | null;
  /** Linear gain applied to the PCM (1.0 = unchanged). */
  volume?: number | null;
  /** Outbound proxy URI; empty for a direct connection. */
  proxy?: string | null;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Attempts per chunk on transient failures (429, 5xx, network). */
  chunkAttempts?: number;
  /** Delay before retry n is `retryDelayMs * n`. */
  retryDelayMs?: number;
}

/** The Interactions endpoint and credential header of a target. */
const targetRequest = async (target: GoogleTtsTarget): Promise<{ url: string; auth: Record<string, string> }> => {
  if (target.backend === "gemini_api") {
    const apiBase = (target.apiBase?.trim() || DEFAULT_GOOGLE_TTS_API_BASE).replace(/\/+$/, "");
    return { url: `${apiBase}/v1beta/interactions`, auth: { "x-goog-api-key": target.apiKey } };
  }
  let token: string;
  try {
    token = await target.accessToken();
  } catch (error) {
    // A token that cannot be minted is a configuration problem, not worth retrying.
    throw new GoogleTtsError(error instanceof Error ? error.message : String(error), false);
  }
  return { url: googleTtsInteractionsUrl(target), auth: { authorization: `Bearer ${token}` } };
};

const requestChunk = async (options: GoogleSpeechOptions, text: string): Promise<PcmAudio> => {
  const { url, auth } = await targetRequest(options.target);
  let response: Response;
  try {
    response = await outboundHttp.fetch(url, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(
        buildGoogleTtsPayload({
          model: options.model || DEFAULT_GOOGLE_TTS_MODEL,
          text,
          voiceId: options.voiceId,
          speed: options.speed,
          style: options.style,
        }),
      ),
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
      // undici's dispatcher isn't in the DOM RequestInit, yet under Node types it is a concrete Dispatcher
      ...(options.proxy ? { dispatcher: outboundHttp.proxyAgent(options.proxy) } : {}),
    } as RequestInit);
  } catch (error) {
    throw new GoogleTtsError(error instanceof Error ? error.message : String(error), true);
  }
  const rawBody = await response.text();
  if (response.status < 200 || response.status >= 300) {
    const transient = response.status === 429 || response.status >= 500;
    throw new GoogleTtsError(
      `TTS synthesis failed (HTTP ${response.status}): ${rawBody || response.statusText}`,
      transient,
      response.status,
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new GoogleTtsError("TTS returned a non-JSON response.", false, response.status);
  }
  try {
    const { audio, mimeType } = extractGoogleInteractionAudio(parsed);
    return decodeGooglePcm(audio, mimeType);
  } catch (error) {
    throw new GoogleTtsError(error instanceof Error ? error.message : String(error), false, response.status);
  }
};

const synthesizeChunk = async (options: GoogleSpeechOptions, text: string): Promise<PcmAudio> => {
  const attempts = Math.max(1, options.chunkAttempts ?? 3);
  const delayMs = options.retryDelayMs ?? 1000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestChunk(options, text);
    } catch (error) {
      if (!(error instanceof GoogleTtsError) || !error.transient || attempt >= attempts) throw error;
      const delay = delayMs * attempt;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

/**
 * Synthesizes `text` to PCM: split into chunks, synthesize up to four at a time (transient failures
 * retried per chunk), concatenate, and apply the volume gain. Encode with
 * {@link encodePcmToMp3Async} or {@link encodePcmToWav}.
 */
export const synthesizeGoogleSpeech = async (
  options: GoogleSpeechOptions,
): Promise<{ pcm: PcmAudio; durationMs: number }> => {
  const chunks = splitGoogleTtsText(options.text);
  const parts = await mapWithConcurrency(chunks, GOOGLE_TTS_MAX_PARALLEL_CHUNKS, (chunk) =>
    synthesizeChunk(options, chunk),
  );
  const joined = concatPcm(parts);
  const pcm = { ...joined, samples: applyPcmGain(joined.samples, options.volume) };
  return { pcm, durationMs: pcmDurationMs(pcm) };
};
