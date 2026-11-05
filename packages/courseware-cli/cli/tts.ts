// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { AinobiCliError } from "./errors.ts";
import { uploadBufferAsset } from "./assets.ts";
import {
  defaultTtsVoiceId,
  type AITeacherTtsSettings,
} from "./ai-teachers.ts";
import { FishAudioHttpError, synthesizeFishAudioSpeech } from "@ainobi/tts-fishaudio";
import { synthesizeMiniMaxSpeech } from "@ainobi/tts-minimax";
import { readMp3DurationMs } from "./mp3-duration.ts";
import {
  DEFAULT_GOOGLE_TTS_MODEL,
  encodePcmToMp3Async,
  resolveGoogleTtsApiBase,
  resolveGoogleTtsApiKey,
  synthesizeGoogleSpeech,
} from "./google-tts.ts";
import { coursewareAssetBaseUrl } from "./url-policy.ts";
import { cliEnv, runWithCliEnv } from "./env.ts";
import {
  applyJapaneseKanaReplacements,
  buildMinimaxToneRules,
  parseKanaLineRewritesJson,
  parsePronunciationDictJson,
  resolveKanaLineRewrite,
  shouldApplyMinimaxToneDict,
  shouldApplyPronunciationDict,
  AINOBI_TTS_JA_KANA_LINES_FILE_ENV,
  AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV,
  type PronunciationDictEntry,
} from "./tts-pronunciation-apply.ts";

export interface NarrationTtsSegment {
  text: string;
  audio_url: string;
  duration_ms: number;
  gap_ms: number;
}

interface TtsBuildOptions {
  gapMs: number;
  settings: AITeacherTtsSettings;
  /** Catalog `ai_teacher_tts_id` / `tts_voice` before substitution (for fallback reporting). */
  requestedVoiceId?: string;
}

export type BuildTtsSegmentsResult = {
  segments: NarrationTtsSegment[];
  voice_id: string;
  voice_fallback_applied: boolean;
};

export const isTtsVoiceNotFoundError = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : String(error);
  if (/voice id not exist/i.test(text)) return true;
  if (/["']status_code["']\s*:\s*2054/.test(text)) return true;
  if (/status_code\\":\s*2054/.test(text)) return true;
  if (/reference[_\s-]?id.*(?:not found|invalid|does not exist)/i.test(text)) return true;
  if (/\b404\b/.test(text) && /reference/i.test(text)) return true;
  // Google Gemini TTS: HTTP 400 invalid_request for an unknown voice name.
  if (/no matching speaker voice found/i.test(text)) return true;
  return false;
};

export { normalizeFishAudioModel } from "@ainobi/tts-fishaudio";

/** Trim a TTS line the way `splitTranscriptForTts` does (host kana-rewrite keys must match). */
export const trimNarrationLine = (value: string): string =>
  value.trim().replace(/^[\s,.，。]+|[\s,.，。]+$/g, "").trim();

const ttsStubEnabled = (): boolean => /^(1|true|yes)$/i.test(cliEnv().AINOBI_TTS_STUB ?? "");

const ttsMaxRetries = (): number => {
  const parsed = Number(cliEnv().AINOBI_TTS_MAX_RETRIES ?? 3);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3;
};

const ttsRetryDelayMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_TTS_RETRY_DELAY_MS ?? 500);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 500;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Keep user/agent-facing TTS errors vendor-neutral. */
const sanitizeTtsErrorDetail = (detail: string): string => {
  let next = detail
    .replace(/\bMiniMax\b/gi, "TTS")
    .replace(/\bminimaxi\b/gi, "TTS")
    .replace(/\bGoogle\b/g, "TTS")
    .replace(/\bGemini\b/gi, "TTS");
  if (/unexpected server response:\s*404/i.test(next)) {
    return "TTS service endpoint not found (HTTP 404). Verify TTS WebSocket URL configuration on the host.";
  }
  return next;
};

/** Prefer provider-specific proxy, then shared HTTPS/OSS proxy (common in CN dev setups). */
export const resolveTtsProxyUrl = (): string | undefined => {
  const candidates = [
    cliEnv().FISH_AUDIO_PROXY,
    cliEnv().FISH_AUDIO_TTS_PROXY,
    cliEnv().MINIMAX_PROXY,
    cliEnv().MINIMAX_TTS_PROXY,
    cliEnv().HTTPS_PROXY,
    cliEnv().https_proxy,
    cliEnv().HTTP_PROXY,
    cliEnv().http_proxy,
    cliEnv().OSS_PROXY,
    cliEnv().OSS_PROXY_URL,
  ];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
};

const withTtsRetry = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const maxAttempts = ttsMaxRetries();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delay = ttsRetryDelayMs() * attempt;
      if (delay > 0) await sleep(delay);
    }
  }
  const detail = sanitizeTtsErrorDetail(
    lastError instanceof Error ? lastError.message : String(lastError),
  );
  throw new AinobiCliError(
    "INTERNAL",
    `TTS failed for ${label} after ${maxAttempts} attempt(s): ${detail}`,
    {
      hint: "Check TTS API credentials and OSS upload settings on the host. Transient errors are retried automatically.",
    },
  );
};

export const splitTranscriptForTts = (transcript: string): string[] =>
  transcript
    .split(/\n+/)
    .map(trimNarrationLine)
    .filter((line) => line.length > 0);

const miniMaxConnectTimeoutMs = (): number => {
  const parsed = Number(cliEnv().MINIMAX_TTS_CONNECT_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
};

const miniMaxSynthesisTimeoutMs = (): number => {
  const parsed = Number(cliEnv().MINIMAX_TTS_SYNTHESIS_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
};

const googleTtsSynthesisTimeoutMs = (): number => {
  const parsed = Number(cliEnv().GEMINI_TTS_SYNTHESIS_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
};

const fishAudioSynthesisTimeoutMs = (): number => {
  const parsed = Number(cliEnv().FISH_AUDIO_TTS_SYNTHESIS_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
};

/** Google requests only: GEMINI_TTS_PROXY first, then the shared TTS/HTTPS proxies. */
export const resolveGoogleTtsProxyUrl = (): string | undefined =>
  cliEnv().GEMINI_TTS_PROXY?.trim() || resolveTtsProxyUrl();

/** Prefer parsing MP3 frames; fall back to coarse heuristics when bytes are not MP3. */
export const resolveMp3DurationMs = (audio: Buffer, text: string): number => {
  const parsed = readMp3DurationMs(audio);
  if (parsed != null && parsed > 0) return parsed;

  const bitrateKbps = Number(cliEnv().FISH_AUDIO_TTS_MP3_BITRATE || 128);
  const fromBytes =
    audio.length > 0 && Number.isFinite(bitrateKbps) && bitrateKbps > 0
      ? Math.round((audio.length * 8) / (bitrateKbps * 1000))
      : 0;
  const fromText = Math.max(500, Array.from(text).length * 80);
  return Math.max(fromBytes, fromText);
};

const synthesizeFishAudioAudio = async (
  text: string,
  settings: AITeacherTtsSettings,
): Promise<{ audio: Buffer; duration_ms: number; extension: string }> => {
  const apiKey = cliEnv().FISH_AUDIO_API_KEY?.trim();
  if (!apiKey) {
    throw new AinobiCliError(
      "USAGE",
      "Fish Audio API credentials are required for narration insert (configure FISH_AUDIO_API_KEY on the AINOBI host).",
    );
  }

  const format = cliEnv().FISH_AUDIO_TTS_FORMAT?.trim() || "mp3";
  let audio: Buffer;
  try {
    audio = await synthesizeFishAudioSpeech({
      apiKey,
      endpoint: cliEnv().FISH_AUDIO_TTS_URL?.trim() || "https://api.fish.audio/v1/tts",
      model: settings.model,
      text,
      voiceId: settings.voice_id,
      format,
      speed: settings.speed,
      volume: settings.vol,
      mp3Bitrate: Number(cliEnv().FISH_AUDIO_TTS_MP3_BITRATE || 128),
      proxy: resolveTtsProxyUrl() ?? null,
      timeoutMs: fishAudioSynthesisTimeoutMs(),
    });
  } catch (error) {
    if (error instanceof FishAudioHttpError) {
      throw new AinobiCliError(
        "INTERNAL",
        `TTS synthesis failed (HTTP ${error.httpStatus}): ${sanitizeTtsErrorDetail(error.body)}`,
      );
    }
    throw error;
  }

  if (audio.length === 0) {
    throw new AinobiCliError("INTERNAL", "TTS returned empty audio.");
  }

  return {
    audio,
    duration_ms: resolveMp3DurationMs(audio, text),
    extension: `.${format.replace(/^./, "")}`,
  };
};

// The outer withTtsRetry retries the whole line as well, so a single segment gets only one extra attempt, to avoid multiplying requests during a persistent outage.
const GOOGLE_TTS_CHUNK_ATTEMPTS = 2;

const synthesizeGoogleAudio = async (
  text: string,
  settings: AITeacherTtsSettings,
): Promise<{ audio: Buffer; duration_ms: number; extension: string }> => {
  const apiKey = resolveGoogleTtsApiKey();
  if (!apiKey) {
    throw new AinobiCliError(
      "USAGE",
      "TTS API credentials are required for narration insert (configure GEMINI_API_KEY or GEMINI_TTS_API_KEY on the AINOBI host).",
    );
  }

  // Gemini returns WAV only; MP3 is the only format the courseware stores.
  const format = (cliEnv().GEMINI_TTS_FORMAT?.trim() || "mp3").toLowerCase();
  if (format !== "mp3") {
    throw new AinobiCliError("USAGE", `Unsupported TTS format "${format}" (only mp3 is supported).`);
  }
  let synthesized: Awaited<ReturnType<typeof synthesizeGoogleSpeech>>;
  try {
    synthesized = await synthesizeGoogleSpeech({
      apiKey,
      apiBase: resolveGoogleTtsApiBase(),
      model: settings.model?.trim() || DEFAULT_GOOGLE_TTS_MODEL,
      text,
      voiceId: settings.voice_id,
      speed: settings.speed,
      style: settings.style,
      volume: settings.vol,
      // GEMINI_TTS_PROXY applies to Google only, never to MiniMax / Fish Audio.
      proxy: resolveGoogleTtsProxyUrl(),
      timeoutMs: googleTtsSynthesisTimeoutMs(),
      chunkAttempts: GOOGLE_TTS_CHUNK_ATTEMPTS,
      retryDelayMs: ttsRetryDelayMs(),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new AinobiCliError("INTERNAL", sanitizeTtsErrorDetail(error.message));
    }
    throw error;
  }
  const audio = await encodePcmToMp3Async(synthesized.pcm, Number(cliEnv().GEMINI_TTS_MP3_BITRATE_KBPS || 128));
  if (audio.length === 0) {
    throw new AinobiCliError("INTERNAL", "TTS returned empty audio.");
  }
  return { audio, duration_ms: synthesized.durationMs, extension: ".mp3" };
};

const synthesizeProviderAudio = async (
  text: string,
  settings: AITeacherTtsSettings,
  pronunciationToneRules?: readonly string[],
): Promise<{ audio: Buffer; duration_ms: number; extension: string }> => {
  if (settings.provider === "google") {
    return synthesizeGoogleAudio(text, settings);
  }
  if (settings.provider === "fishaudio") {
    return synthesizeFishAudioAudio(text, settings);
  }
  return synthesizeMiniMaxAudio(text, settings, pronunciationToneRules);
};

const synthesizeMiniMaxAudio = async (
  text: string,
  settings: AITeacherTtsSettings,
  pronunciationToneRules?: readonly string[],
): Promise<{ audio: Buffer; duration_ms: number; extension: string }> => {
  const apiKey = cliEnv().MINIMAX_API_KEY;
  if (!apiKey) {
    throw new AinobiCliError(
      "USAGE",
      "TTS API credentials are required for narration insert (configure on the AINOBI host).",
    );
  }

  const format = cliEnv().MINIMAX_TTS_FORMAT || "mp3";
  let synthesized: { audio: Buffer; durationMs: number };
  try {
    synthesized = await synthesizeMiniMaxSpeech({
      apiKey,
      wsUrl: cliEnv().MINIMAX_TTS_WS_URL || undefined,
      model: settings.model,
      text,
      voiceId: settings.voice_id,
      speed: settings.speed,
      volume: settings.vol,
      pitch: settings.pitch,
      languageBoost: settings.language_boost,
      format,
      sampleRate: Number(cliEnv().MINIMAX_TTS_SAMPLE_RATE || 32000),
      bitrate: Number(cliEnv().MINIMAX_TTS_BITRATE || 128000),
      channel: Number(cliEnv().MINIMAX_TTS_CHANNEL || 1),
      englishNormalization: /^(1|true|yes)$/i.test(cliEnv().MINIMAX_TTS_ENGLISH_NORMALIZATION || ""),
      pronunciationTone: pronunciationToneRules,
      proxy: resolveTtsProxyUrl() ?? null,
      connectTimeoutMs: miniMaxConnectTimeoutMs(),
      synthesisTimeoutMs: miniMaxSynthesisTimeoutMs(),
      connectAttempts: ttsMaxRetries(),
      retryDelayMs: ttsRetryDelayMs(),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new AinobiCliError("INTERNAL", sanitizeTtsErrorDetail(error.message));
    }
    throw error;
  }

  if (synthesized.audio.length === 0) {
    throw new AinobiCliError("INTERNAL", "TTS returned empty audio.");
  }
  const resolvedDuration =
    synthesized.durationMs > 0 ? synthesized.durationMs : resolveMp3DurationMs(synthesized.audio, text);
  return {
    audio: synthesized.audio,
    duration_ms: resolvedDuration,
    extension: `.${format}`,
  };
};

const synthesizeWithVoiceFallback = async (
  text: string,
  settings: AITeacherTtsSettings,
  pronunciationToneRules?: readonly string[],
): Promise<{ audio: Buffer; duration_ms: number; extension: string; voice_fallback: boolean }> => {
  const defaultVoice = defaultTtsVoiceId(settings.provider);
  try {
    const result = await synthesizeProviderAudio(text, settings, pronunciationToneRules);
    return { ...result, voice_fallback: false };
  } catch (error) {
    if (!isTtsVoiceNotFoundError(error) || settings.voice_id === defaultVoice) {
      throw error;
    }
    const fallback = await synthesizeProviderAudio(
      text,
      { ...settings, voice_id: defaultVoice },
      pronunciationToneRules,
    );
    return { ...fallback, voice_fallback: true };
  }
};

export type SynthesizeAndUploadTtsLineOptions = {
  text: string;
  settings: AITeacherTtsSettings;
  /** Audio container, e.g. `mp3` (default). */
  format?: string;
  requestedVoiceId?: string;
  /**
   * Org pronunciation dict entries, passed explicitly by the host (courseware API).
   * This function runs inside the long-lived host process, so the dict must NOT be
   * read from the environment (`cliEnv()`): a process-global value leaks between concurrent
   * requests of different organizations. Do NOT add an env fallback here.
   */
  pronunciationDict?: readonly PronunciationDictEntry[];
  /**
   * Host-computed Japanese full-text kana rewrite of `text` (dictionary already applied).
   * When present it is sent to the provider as-is instead of the dictionary-only rewrite.
   */
  kanaRewrite?: string;
};

export type SynthesizeAndUploadTtsLineResult = {
  tts_url: string;
  object_key: string;
  format: string;
  content_type: string;
  duration_ms: number;
  voice_id: string;
  voice_fallback_applied: boolean;
  bytes: number;
  file_id: string;
  /** true when the content-addressed object already existed (dedup hit) —
   * callers must not count org storage for it again. */
  existed: boolean;
};

/** Single-line TTS synthesis + OSS upload (host / courseware API). */
export const synthesizeAndUploadTtsLine = async (
  options: SynthesizeAndUploadTtsLineOptions,
): Promise<SynthesizeAndUploadTtsLineResult> => {
  const text = trimNarrationLine(options.text);
  if (!text) {
    throw new AinobiCliError("USAGE", "TTS text is empty.");
  }

  const dictEntries = options.pronunciationDict ?? [];
  const applyDict = shouldApplyPronunciationDict(options.settings.provider);
  const hostKana = applyDict ? options.kanaRewrite?.trim() || undefined : undefined;
  // Japanese: the host's full-text kana first, otherwise dictionary kana replaces the source (MiniMax / FishAudio); Chinese tone only for MiniMax
  const textForSynth =
    hostKana ?? (applyDict ? applyJapaneseKanaReplacements(text, dictEntries) : text);
  const pronunciationToneRules = shouldApplyMinimaxToneDict(options.settings.provider)
    ? buildMinimaxToneRules(dictEntries)
    : [];

  // Same rule as the narration path: log the original text only, the kana text is
  // sent to the provider and then dropped.
  if (applyDict && textForSynth !== text) {
    console.info("[tts] japanese kana rewrite", {
      provider: options.settings.provider,
      source: hostKana ? "host-auto-kana" : "dict",
      from: text,
    });
  }

  const formatRaw = (options.format?.trim() || "mp3").toLowerCase().replace(/^\./, "");
  if (formatRaw !== "mp3") {
    throw new AinobiCliError("USAGE", `Unsupported TTS format "${formatRaw}" (only mp3 is supported).`);
  }

  // The providers read the output format from the environment; scope it to this call so
  // concurrent in-process callers (the courseware host) never see each other's value.
  return runWithCliEnv({ MINIMAX_TTS_FORMAT: formatRaw, FISH_AUDIO_TTS_FORMAT: formatRaw }, async () => {
    if (ttsStubEnabled()) {
      const stubBase = `${coursewareAssetBaseUrl()}/stub/tts`;
      const extension = `.${formatRaw}`;
      return {
        tts_url: `${stubBase}/${encodeURIComponent(textForSynth)}${extension}`,
        object_key: `stub/tts/${encodeURIComponent(textForSynth)}${extension}`,
        format: formatRaw,
        content_type: "audio/mpeg",
        duration_ms: Math.max(500, Array.from(textForSynth).length * 80),
        voice_id: options.settings.voice_id,
        voice_fallback_applied: false,
        bytes: 0,
        file_id: "stub",
        existed: true,
      };
    }

    const synthesized = await withTtsRetry(`line "${textForSynth.slice(0, 32)}"`, () =>
      synthesizeWithVoiceFallback(textForSynth, options.settings, pronunciationToneRules),
    );
    const extension = synthesized.extension.startsWith(".")
      ? synthesized.extension
      : `.${synthesized.extension}`;
    const uploaded = await withTtsRetry(`upload for line "${textForSynth.slice(0, 32)}"`, () =>
      uploadBufferAsset(synthesized.audio, extension, `${textForSynth.slice(0, 24)}${extension}`),
    );
    return {
      tts_url: uploaded.url,
      object_key: uploaded.object_key,
      format: formatRaw,
      content_type: uploaded.content_type,
      duration_ms: synthesized.duration_ms,
      voice_id: options.settings.voice_id,
      voice_fallback_applied: synthesized.voice_fallback,
      bytes: uploaded.bytes,
      file_id: uploaded.file_id,
      existed: uploaded.existed,
    };
  });
};

/**
 * Host-written merged pronunciation dict (path from env, see agent-narration-host-run.ts).
 * Missing or unreadable file → no dict; never throws.
 */
const readPronunciationDictFile = (path: string | undefined): PronunciationDictEntry[] => {
  const file = path?.trim();
  if (!file) return [];
  try {
    return parsePronunciationDictJson(readFileSync(file, "utf8"));
  } catch (error) {
    console.warn("[tts] pronunciation dict file unreadable, synthesizing without it", {
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * Host-written `{ [line]: kana }` map (path from env, see agent-narration-host-run.ts).
 * Missing or unreadable file → empty map, i.e. dictionary-only rewriting; never throws.
 */
const readKanaLineRewritesFile = (path: string | undefined): Record<string, string> => {
  const file = path?.trim();
  if (!file) return {};
  try {
    return parseKanaLineRewritesJson(readFileSync(file, "utf8"));
  } catch (error) {
    console.warn("[tts] japanese kana line map unreadable, using dictionary only", {
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
};

export const buildTtsSegments = async (
  transcript: string,
  options: TtsBuildOptions,
): Promise<BuildTtsSegmentsResult> => {
  const lines = splitTranscriptForTts(transcript);
  if (lines.length === 0) {
    throw new AinobiCliError("USAGE", "Narration TTS source has no non-empty lines after splitting on newlines.");
  }

  const requested = options.requestedVoiceId?.trim();
  let voiceFallbackApplied =
    Boolean(requested) && requested !== options.settings.voice_id;

  // Child-process env (injected per job by the host, see agent-narration-host-env.ts):
  // paths of the host-written merged dict file and of the host-computed full-text kana
  // map file. A line missing from the kana map falls back to the dictionary-only rewrite.
  const applyDict = shouldApplyPronunciationDict(options.settings.provider);
  const dictEntries = applyDict
    ? readPronunciationDictFile(cliEnv()[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV])
    : [];
  const kanaLines = applyDict
    ? readKanaLineRewritesFile(cliEnv()[AINOBI_TTS_JA_KANA_LINES_FILE_ENV])
    : {};
  const resolveHostKana = (line: string): string | undefined =>
    applyDict ? resolveKanaLineRewrite(line, kanaLines) : undefined;
  const resolveLineForSynth = (line: string): string =>
    resolveHostKana(line) ??
    (applyDict ? applyJapaneseKanaReplacements(line, dictEntries) : line);
  // Logged before the stub early-return as well, so stub runs stay observable.
  // Diagnostics go to STDERR as one line: stdout carries the CLI JSON envelope and the
  // host forwards the child's stdout verbatim to the agent (narration-host-job.ts), so
  // anything else on stdout breaks the "every command returns JSON" contract.
  // Only the ORIGINAL line is logged: this stderr ends up in the agent context, and the
  // kana text exists solely for the TTS request — it is dropped once synthesized.
  const logKanaRewrite = (line: string, lineForSynth: string, hostKana: string | undefined): void => {
    if (applyDict && lineForSynth !== line) {
      const detail = JSON.stringify({
        provider: options.settings.provider,
        source: hostKana ? "host-auto-kana" : "dict",
        from: line,
      });
      process.stderr.write(`[tts] japanese kana rewrite ${detail}\n`);
    }
  };

  if (ttsStubEnabled()) {
    const stubBase = `${coursewareAssetBaseUrl()}/stub/tts`;
    return {
      voice_id: options.settings.voice_id,
      voice_fallback_applied: voiceFallbackApplied,
      segments: lines.map((line) => {
        const hostKana = resolveHostKana(line);
        const lineForSynth = resolveLineForSynth(line);
        logKanaRewrite(line, lineForSynth, hostKana);
        return {
          text: line,
          audio_url: `${stubBase}/${encodeURIComponent(lineForSynth)}.mp3`,
          duration_ms: Math.max(500, Array.from(lineForSynth).length * 80),
          gap_ms: options.gapMs,
        };
      }),
    };
  }

  const segments: NarrationTtsSegment[] = [];
  const pronunciationToneRules = shouldApplyMinimaxToneDict(options.settings.provider)
    ? buildMinimaxToneRules(dictEntries)
    : [];
  for (const line of lines) {
    const hostKana = resolveHostKana(line);
    const lineForSynth = resolveLineForSynth(line);
    logKanaRewrite(line, lineForSynth, hostKana);
    const synthesized = await withTtsRetry(`line "${lineForSynth.slice(0, 32)}"`, () =>
      synthesizeWithVoiceFallback(lineForSynth, options.settings, pronunciationToneRules),
    );
    if (synthesized.voice_fallback) {
      voiceFallbackApplied = true;
    }
    const uploaded = await withTtsRetry(`upload for line "${line.slice(0, 32)}"`, () =>
      uploadBufferAsset(
        synthesized.audio,
        synthesized.extension,
        `${line.slice(0, 24)}${synthesized.extension}`,
      ),
    );
    segments.push({
      text: line,
      audio_url: uploaded.url,
      duration_ms: synthesized.duration_ms,
      gap_ms: options.gapMs,
    });
  }
  return {
    segments,
    voice_id: voiceFallbackApplied
      ? defaultTtsVoiceId(options.settings.provider)
      : options.settings.voice_id,
    voice_fallback_applied: voiceFallbackApplied,
  };
};
