// SPDX-License-Identifier: AGPL-3.0-only
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import OpenAI, { toFile } from "openai";

import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { repairJSON } from "../libs/json-repair.ts";
import {
  isCreditsConsumptionGloballyDisabled,
  normalizeAinobiServiceCode,
  resolveCreditsOrgId,
} from "./ainobi-credits.ts";
import { consumeAinobiCredits } from "./credits-consume-retry.ts";
import {
  signObjectReadUrl,
  storageBackendForStoredObjectUrl,
} from "@ainobi/courseware-cli/cli/assets.ts";
import type {
  CoursewareQuizAnswerContent,
  CoursewareQuizRawScoreResult,
} from "@ainobi/courseware-core/quiz-scoring.ts";
import type { QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

const DEFAULT_FILL_BLANK_AI_RUBRIC =
  "Score the student's answers against the expected answers for each blank. Award partial credit when some blanks are correct. Return one total score from 0 to the maximum.";
const DEFAULT_ESSAY_AI_RUBRIC =
  "Score the student's essay against the reference answer and any keywords. Evaluate completeness, accuracy, and relevance. Award partial credit when the response partially addresses the prompt. Return one total score from 0 to the maximum.";
const DEFAULT_SHADOWING_RUBRIC =
  "You are scoring a shadowing (listen-and-repeat) exercise. Compare the student's transcript to the reference text. Evaluate pronunciation proxy signals from transcription completeness, fluency, and accuracy. Return JSON with score and concise feedback.";
const DEFAULT_SPEECH_RUBRIC =
  "You are scoring a read-aloud exercise. Evaluate how well the student reads the prompt/reference text, including pronunciation proxy signals from transcription accuracy and completeness.";

export const QUIZ_SCORING_RESUBMIT_ERROR_CODE = "quiz_scoring_retry";
export const QUIZ_SCORING_RESUBMIT_MESSAGE =
  "AI scoring temporarily failed. Please submit your answer again.";

export class QuizScoringResubmitError extends Error {
  readonly code = QUIZ_SCORING_RESUBMIT_ERROR_CODE;

  constructor(message = QUIZ_SCORING_RESUBMIT_MESSAGE) {
    super(message);
    this.name = "QuizScoringResubmitError";
  }
}

export function isQuizScoringResubmitError(error: unknown): error is QuizScoringResubmitError {
  return error instanceof QuizScoringResubmitError;
}

const SCORING_JSON_PARSE_MAX_ATTEMPTS = 4;

class QuizScoringInvalidJsonError extends Error {
  readonly contentPreview: string;

  constructor(message: string, contentPreview: string) {
    super(message);
    this.name = "QuizScoringInvalidJsonError";
    this.contentPreview = contentPreview;
  }
}

type ScoringProvider = "vertexai" | "gemini_api" | "openai";
type ScoringModality = "text" | "audio";

type QuizAiScoringArgs = {
  session: AinobiAuthorizedSession;
  orgId: string;
  submissionId: string;
  questionWrapperId: string;
  language?: string;
  question: QuizQuestion;
  answer: CoursewareQuizAnswerContent;
};

type ParsedScore = {
  score: number;
  is_correct?: boolean;
  confidence?: number;
  explanation: string;
  strengths?: string[];
  improvements?: string[];
  pronunciation?: number;
  fluency?: number;
  accuracy?: number;
  transcript?: string;
  content_match?: boolean;
  raw: Record<string, unknown>;
};

type ScoringUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
};

type ScoringRunResult = {
  parsed: ParsedScore;
  usage: ScoringUsage;
};

function normalizeProvider(value: string | undefined, fallback: ScoringProvider): ScoringProvider {
  const provider = (value?.trim() || fallback).toLowerCase();
  if (provider === "openai") return "openai";
  if (provider === "gemini_api" || provider === "gemini" || provider === "google_gemini") return "gemini_api";
  return "vertexai";
}

function scoringProvider(modality: ScoringModality): ScoringProvider {
  const specific =
    modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_PROVIDER
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_PROVIDER;
  return normalizeProvider(
    specific || process.env.COURSEWARE_QUIZ_SCORING_PROVIDER,
    modality === "audio" ? "vertexai" : "openai",
  );
}

function geminiApiKey(modality: ScoringModality): string {
  const key =
    (modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_API_KEY?.trim()
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_API_KEY?.trim()) ||
    process.env.COURSEWARE_QUIZ_SCORING_API_KEY?.trim() ||
    process.env.GOOGLE_CLOUD_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "AI scoring is not configured: set GEMINI_API_KEY or GOOGLE_CLOUD_API_KEY.",
    );
  }
  return key;
}

function openAiScoringApiKey(modality: ScoringModality): string {
  const modalitySpecific =
    modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_API_KEY?.trim()
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_API_KEY?.trim();
  if (modalitySpecific) {
    return modalitySpecific;
  }
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    return openAiKey;
  }
  const globalKey = process.env.COURSEWARE_QUIZ_SCORING_API_KEY?.trim();
  if (globalKey) {
    return globalKey;
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    return anthropicKey;
  }
  throw new Error("COURSEWARE_QUIZ_SCORING_API_KEY or OPENAI_API_KEY is not configured");
}

function openAiScoringBaseUrl(modality: ScoringModality): string | undefined {
  return (
    (modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_BASE_URL?.trim()
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_BASE_URL?.trim()) ||
    process.env.COURSEWARE_QUIZ_SCORING_BASE_URL?.trim() ||
    process.env.OPENAI_API_BASE?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim() ||
    undefined
  );
}

function scoringModel(modality: ScoringModality): string {
  const provider = scoringProvider(modality);
  const specific =
    modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_MODEL?.trim()
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_MODEL?.trim();
  return (
    specific ||
    (provider === "openai" ? process.env.OPENAI_MODEL?.trim() : undefined) ||
    process.env.COURSEWARE_QUIZ_SCORING_MODEL?.trim() ||
    (provider !== "openai" ? process.env.VERTEXAI_MODEL?.trim() : undefined) ||
    "gemini-3.6-flash"
  );
}

/** Gemini thinking + JSON output share the output token budget; keep thinking minimal for scoring. */
function geminiScoringThinkingConfig(model: string): Record<string, unknown> | undefined {
  const normalized = model.toLowerCase();
  if (/gemini-3/.test(normalized)) {
    return { thinkingLevel: "minimal" };
  }
  if (/gemini-2\.5/.test(normalized)) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

function geminiScoringGenerationConfig(model: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    temperature: 0,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  };
  // const thinkingConfig = geminiScoringThinkingConfig(model);
  // if (thinkingConfig) {
  //   config.thinkingConfig = thinkingConfig;
  // }
  return config;
}

function transcriptionModel(): string {
  return process.env.COURSEWARE_QUIZ_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
}

function openaiClient(modality: ScoringModality): OpenAI {
  return new OpenAI({
    apiKey: openAiScoringApiKey(modality),
    baseURL: openAiScoringBaseUrl(modality),
  });
}

function maxScore(question: QuizQuestion): number {
  return Math.max(0, Number.isFinite(question.score) ? Number(question.score) : 0);
}

function clampScore(value: unknown, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(max, n));
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function stripMarkdownJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function scoringJsonRetryDelayMs(attemptIndex: number): number {
  return Math.min(300 * 2 ** Math.max(0, attemptIndex - 1), 2_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runScoringWithJsonRetries(
  label: string,
  run: () => Promise<ScoringRunResult>,
): Promise<ScoringRunResult> {
  let lastError: QuizScoringInvalidJsonError | undefined;
  for (let attempt = 1; attempt <= SCORING_JSON_PARSE_MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof QuizScoringInvalidJsonError)) {
        throw error;
      }
      lastError = error;
      if (attempt >= SCORING_JSON_PARSE_MAX_ATTEMPTS) {
        break;
      }
      const delayMs = scoringJsonRetryDelayMs(attempt);
      console.warn(
        `[courseware-quiz] ${label} invalid JSON on attempt ${attempt}/${SCORING_JSON_PARSE_MAX_ATTEMPTS}; retry in ${delayMs}ms:`,
        error.message,
      );
      await sleep(delayMs);
    }
  }
  console.error(
    `[courseware-quiz] ${label} invalid JSON after ${SCORING_JSON_PARSE_MAX_ATTEMPTS} attempts:`,
    lastError?.message,
    lastError?.contentPreview,
  );
  throw new QuizScoringResubmitError();
}

function parseScoreJson(content: string, max: number): ParsedScore {
  const candidate = stripMarkdownJsonFence(content) || content.trim() || "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    try {
      parsed = repairJSON(candidate) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new QuizScoringInvalidJsonError(
        `Courseware quiz scoring returned invalid JSON: ${message}`,
        candidate.slice(0, 500),
      );
    }
  }
  const feedback = parsed.feedback && typeof parsed.feedback === "object" && !Array.isArray(parsed.feedback)
    ? parsed.feedback as Record<string, unknown>
    : {};
  return {
    score: clampScore(parsed.score, max),
    is_correct: typeof parsed.is_correct === "boolean" ? parsed.is_correct : undefined,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    explanation:
      typeof feedback.explanation === "string"
        ? feedback.explanation
        : typeof parsed.explanation === "string"
          ? parsed.explanation
          : "",
    strengths: asStringArray(feedback.strengths ?? parsed.strengths),
    improvements: asStringArray(feedback.improvements ?? parsed.improvements ?? parsed.weaknesses),
    pronunciation: typeof feedback.pronunciation === "number" ? feedback.pronunciation : undefined,
    fluency: typeof feedback.fluency === "number" ? feedback.fluency : undefined,
    accuracy: typeof feedback.accuracy === "number" ? feedback.accuracy : undefined,
    transcript:
      typeof parsed.transcription === "string"
        ? parsed.transcription
        : typeof parsed.transcript === "string"
          ? parsed.transcript
          : undefined,
    content_match: typeof parsed.content_match === "boolean" ? parsed.content_match : undefined,
    raw: parsed,
  };
}

function orderedAnswerValues(question: QuizQuestion, answer: CoursewareQuizAnswerContent): string[] {
  if (answer.values?.length) {
    return answer.values;
  }
  const keyed = answer.value_by_member_id ?? {};
  if (question.type === "fill_blank") {
    return question.blanks.map((blank) => keyed[blank.blank_id] ?? "");
  }
  return Object.values(keyed);
}

/** Trusted primary language tags for quiz AI feedback prompts. */
export const QUIZ_FEEDBACK_LANGUAGE_BASES = [
  "zh",
  "en",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
] as const;

export type QuizFeedbackLanguageBase = (typeof QUIZ_FEEDBACK_LANGUAGE_BASES)[number];

const QUIZ_FEEDBACK_LANGUAGE_SET = new Set<string>(QUIZ_FEEDBACK_LANGUAGE_BASES);

/** BCP-47-ish tag (primary + optional subtags); rejects newlines/spaces/injection. */
const QUIZ_FEEDBACK_LANGUAGE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/**
 * Normalize client `language` for quiz AI prompts.
 * Returns a trusted base code, or undefined when absent/unsupported.
 * Never returns raw client text (prevents prompt injection via language).
 */
export function normalizeQuizFeedbackLanguage(
  raw: string | null | undefined,
): QuizFeedbackLanguageBase | undefined {
  if (raw == null) return undefined;
  const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized || normalized.length > 32) return undefined;
  if (!QUIZ_FEEDBACK_LANGUAGE_RE.test(normalized)) return undefined;
  const base = normalized.split("-", 1)[0]!;
  if (!QUIZ_FEEDBACK_LANGUAGE_SET.has(base)) return undefined;
  return base as QuizFeedbackLanguageBase;
}

/** True when the raw value is a well-formed locale tag (even if unsupported). */
export function isWellFormedQuizFeedbackLanguageTag(raw: string): boolean {
  const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
  return (
    normalized.length > 0 &&
    normalized.length <= 32 &&
    QUIZ_FEEDBACK_LANGUAGE_RE.test(normalized)
  );
}

/** Human-readable prompt label for a feedback language; falls back to English (issue #749). */
export function languageName(language?: string): string {
  const base = normalizeQuizFeedbackLanguage(language) ?? "en";
  const names: Record<QuizFeedbackLanguageBase, string> = {
    zh: "Chinese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish (Español)",
    fr: "French (Français)",
    de: "German (Deutsch)",
  };
  return names[base];
}

function enhancedSystemPrompt(args: {
  rubric: string;
  maxScore: number;
  isAudio: boolean;
  hasReferenceAudio: boolean;
  language?: string;
}): string {
  const refAudioNote = args.isAudio && args.hasReferenceAudio
    ? "\n- REFERENCE AUDIO: earlier audio clip(s) are benchmark only. The LAST audio clip is the STUDENT submission. Score only the student clip."
    : "";
  const schema = args.isAudio
    ? `{
  "score": <0-${args.maxScore}>,
  "is_correct": <true/false>,
  "confidence": <0-1>,
  "transcription": "what you heard the student say",
  "content_match": <true/false>,
  "feedback": {
    "pronunciation": <0-10>,
    "fluency": <0-10>,
    "accuracy": <0-10>,
    "strengths": [...],
    "improvements": [...],
    "explanation": "..."
  }
}`
    : `{
  "score": <0-${args.maxScore}>,
  "is_correct": <true/false>,
  "confidence": <0-1>,
  "feedback": {
    "strengths": [...],
    "improvements": [...],
    "explanation": "..."
  }
}`;
  return `You are an AI scoring assistant.

Task:
1. Read scoring criteria below
2. Evaluate student answer based on criteria
3. Provide objective assessment
4. Return JSON format result

CRITICAL REQUIREMENTS:
- Maximum possible score is ${args.maxScore} points (NOT 100)
- Your score MUST be between 0 and ${args.maxScore}
- All feedback MUST be in ${languageName(args.language)}
- CONTENT VERIFICATION (Audio only):
  * FIRST: Listen carefully and transcribe what the student said
  * SECOND: Compare the transcription with the reference text
  * If the language is WRONG: Score = 0
  * If the content is COMPLETELY DIFFERENT from reference: Score = 0
  * If the content is PARTIALLY DIFFERENT: Score proportional to correctness
  * Only if content MATCHES can you evaluate pronunciation/fluency${refAudioNote}

[SCORING CRITERIA]
${args.rubric}
[END CRITERIA]

Output Format (JSON only):
${schema}

Rules:
- Follow criteria strictly
- Score range: 0 to ${args.maxScore} only
- Be objective and consistent
- Return valid JSON only`;
}

function buildUserMessage(args: {
  question: QuizQuestion;
  studentAnswer?: string;
  referenceAnswer: string;
  duration?: number | null;
  hasReferenceAudio?: boolean;
}): string {
  const referencePart = args.referenceAnswer ? `Reference: ${args.referenceAnswer}\n\n` : "";
  const audioInstruction = args.hasReferenceAudio
    ? "\n\n[Audio attachments - order matters]\nAfter this text, reference audio clip(s) come first. The final audio clip is the STUDENT SUBMISSION."
    : "";
  const answerPart = args.studentAnswer != null ? `Student Answer: ${args.studentAnswer}\n\n` : "";
  const durationPart = args.duration != null ? `Student submission audio duration: ${args.duration}s` : "";
  return `Question: ${args.question.title}
${referencePart}${answerPart}Max Score: ${maxScore(args.question)}
Threshold: 0.7${audioInstruction}
${durationPart}`.trim();
}

async function runOpenAiJsonScoring(
  modality: ScoringModality,
  prompt: string,
  max: number,
): Promise<ScoringRunResult> {
  const client = openaiClient(modality);
  const response = await client.chat.completions.create({
    model: scoringModel(modality),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You grade answers fairly and output only valid JSON.",
      },
      { role: "user", content: prompt },
    ],
  });
  const content = response.choices[0]?.message?.content ?? "{}";
  const inputTokens = response.usage?.prompt_tokens ?? estimateTokens(prompt);
  const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);
  let parsed: ParsedScore;
  try {
    parsed = parseScoreJson(content, max);
  } catch (error) {
    logScoringParseFailure(
      {
        provider: "openai",
        modality,
        model: scoringModel(modality),
        finishReason: response.choices[0]?.finish_reason ?? null,
        contentLength: content.length,
        contentPreview: content.slice(0, 500),
      },
      error,
    );
    throw error;
  }
  return {
    parsed,
    usage: { inputTokens, outputTokens, cacheTokens: 0 },
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function feedback(parsed: ParsedScore, score: number, max: number): string {
  return parsed.explanation?.trim() || `得分 ${Number(score.toFixed(6))}/${Number(max.toFixed(6))}`;
}

async function consumeScoringCredits(args: {
  session: AinobiAuthorizedSession;
  orgId: string;
  modality: ScoringModality;
  usage: ScoringUsage;
  submissionId: string;
  questionWrapperId: string;
}): Promise<string | null> {
  if (isCreditsConsumptionGloballyDisabled()) {
    return null;
  }
  const serviceCode =
    (args.modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_CREDITS_SERVICE_CODE?.trim()
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_CREDITS_SERVICE_CODE?.trim()) ||
    process.env.COURSEWARE_QUIZ_SCORING_CREDITS_SERVICE_CODE?.trim() ||
    normalizeAinobiServiceCode(scoringModel(args.modality));
  if (!serviceCode) {
    return null;
  }
  const inputTokens = Math.max(0, Math.floor(args.usage.inputTokens));
  const outputTokens = Math.max(0, Math.floor(args.usage.outputTokens));
  const cacheTokens = Math.max(0, Math.floor(args.usage.cacheTokens));
  const amount = Math.max(1, inputTokens + outputTokens + cacheTokens);
  const result = await consumeAinobiCredits(
    args.session.accessToken,
    {
      serviceCode,
      orgId: resolveCreditsOrgId(args.orgId),
      amountUnit: "tokens",
      amount: String(amount),
      inputTokens,
      outputTokens,
      cacheTokens,
      content: `Courseware quiz ${args.modality} scoring ${args.questionWrapperId}`.slice(0, 300),
      idempotencyKey: `courseware-quiz:${args.submissionId}`,
      // Billing feature category: AI grading (quiz scoring)
      usageType: "scoring",
    },
    { phase: "direct", claudeSessionId: args.submissionId },
  );
  return result.ledgerId;
}

async function fetchMediaBytes(locator: string): Promise<{ bytes: Buffer; mime: string; name: string }> {
  const url = locator.startsWith("http://") || locator.startsWith("https://")
    ? locator
    : await signObjectReadUrl(locator.replace(/^\/+/, ""), 60 * 10, {
        // Grayscale transition: bare keys may still live in the legacy bucket.
        backend: storageBackendForStoredObjectUrl(locator),
      });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download media (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("Downloaded media is empty");
  }
  const contentType = response.headers.get("content-type") || guessAudioMime(locator);
  const ext = extensionFromMime(contentType);
  return { bytes, mime: contentType, name: `quiz-answer${ext}` };
}

function guessAudioMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "audio/webm";
}

function extensionFromMime(mime: string): string {
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("flac")) return ".flac";
  return ".webm";
}

async function consumeTranscriptionCredits(args: {
  session: AinobiAuthorizedSession;
  orgId: string;
  submissionId: string;
  questionWrapperId: string;
  durationSec?: number | null;
}): Promise<string | null> {
  if (isCreditsConsumptionGloballyDisabled()) {
    return null;
  }
  const serviceCode =
    process.env.COURSEWARE_QUIZ_TRANSCRIPTION_CREDITS_SERVICE_CODE?.trim() ||
    normalizeAinobiServiceCode(transcriptionModel());
  if (!serviceCode) {
    return null;
  }
  const unitCount = Math.max(1, Math.ceil(args.durationSec ?? 1));
  const result = await consumeAinobiCredits(
    args.session.accessToken,
    {
      serviceCode,
      orgId: resolveCreditsOrgId(args.orgId),
      amountUnit: "tokens",
      amount: String(unitCount),
      unitCount,
      count: 1,
      content: `Courseware quiz transcription ${args.questionWrapperId}`.slice(0, 300),
      idempotencyKey: `courseware-quiz-transcription:${args.submissionId}`,
      // Billing feature category: voice services (answer audio transcription, consistent with the backend's whisper fallback inference)
      usageType: "voice",
    },
    { phase: "direct", claudeSessionId: `${args.submissionId}:transcription` },
  );
  return result.ledgerId;
}

async function transcribe(locator: string): Promise<string> {
  const media = await fetchMediaBytes(locator);
  const client = openaiClient("audio");
  const file = await toFile(media.bytes, media.name, { type: media.mime });
  const response = await client.audio.transcriptions.create({
    model: transcriptionModel(),
    file,
  });
  return String(response.text ?? "").trim();
}

function geminiApiBaseUrl(modality: ScoringModality): string {
  return (
    (modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_BASE_URL?.trim()
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_BASE_URL?.trim()) ||
    process.env.COURSEWARE_QUIZ_SCORING_BASE_URL?.trim() ||
    "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/, "");
}

function vertexLocation(): string {
  return (
    process.env.COURSEWARE_QUIZ_VERTEXAI_LOCATION?.trim() ||
    process.env.VERTEXAI_LOCATION?.trim() ||
    process.env.GOOGLE_CLOUD_LOCATION?.trim() ||
    "us-central1"
  );
}

function vertexProjectId(): string {
  const projectId =
    process.env.COURSEWARE_QUIZ_VERTEXAI_PROJECT_ID?.trim() ||
    process.env.VERTEXAI_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim();
  if (!projectId) {
    throw new Error("Vertex AI project id is not configured");
  }
  return projectId;
}

function vertexBaseUrl(modality: ScoringModality): string {
  const location = vertexLocation();
  return (
    (modality === "audio"
      ? process.env.COURSEWARE_QUIZ_AUDIO_SCORING_BASE_URL?.trim()
      : process.env.COURSEWARE_QUIZ_TEXT_SCORING_BASE_URL?.trim()) ||
    process.env.VERTEXAI_API_BASE?.trim() ||
    `https://${location}-aiplatform.googleapis.com/v1`
  ).replace(/\/$/, "");
}

type ServiceAccountJson = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let vertexTokenCache: { token: string; expiresAt: number } | null = null;

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function serviceAccountJson(): Promise<ServiceAccountJson> {
  const inline = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (inline) {
    return JSON.parse(inline) as ServiceAccountJson;
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!path) {
    throw new Error("Vertex AI requires GOOGLE_APPLICATION_CREDENTIALS_JSON, GOOGLE_APPLICATION_CREDENTIALS, or an access token");
  }
  return JSON.parse(await readFile(path, "utf8")) as ServiceAccountJson;
}

async function vertexAccessToken(): Promise<string> {
  const direct =
    process.env.COURSEWARE_QUIZ_VERTEXAI_ACCESS_TOKEN?.trim() ||
    process.env.VERTEXAI_ACCESS_TOKEN?.trim() ||
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim();
  if (direct) {
    return direct;
  }
  if (vertexTokenCache && vertexTokenCache.expiresAt - Date.now() > 60_000) {
    return vertexTokenCache.token;
  }

  const account = await serviceAccountJson();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(account.private_key))}`;
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error || `Vertex AI token exchange failed (${response.status})`);
  }
  vertexTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
  return payload.access_token;
}

function extractGeminiText(payload: Record<string, unknown>): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content?.parts : [];
  const textFromParts = (includeThoughts: boolean): string =>
    parts
      .map((part) => {
        const p = part as Record<string, unknown>;
        if (!includeThoughts && p.thought === true) {
          return "";
        }
        return typeof p.text === "string" ? p.text : "";
      })
      .join("")
      .trim();

  const withoutThoughts = textFromParts(false);
  if (withoutThoughts) {
    return withoutThoughts;
  }
  return textFromParts(true);
}

function summarizeGeminiPayloadForLog(payload: Record<string, unknown>): Record<string, unknown> {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content?.parts : [];
  const usage = payload.usageMetadata && typeof payload.usageMetadata === "object"
    ? payload.usageMetadata as Record<string, unknown>
    : {};
  const promptFeedback = payload.promptFeedback && typeof payload.promptFeedback === "object"
    ? payload.promptFeedback as Record<string, unknown>
    : {};
  return {
    candidateCount: candidates.length,
    finishReason: first?.finishReason ?? first?.finish_reason ?? null,
    blockReason: first?.blockReason ?? first?.block_reason ?? null,
    promptBlockReason: promptFeedback.blockReason ?? promptFeedback.block_reason ?? null,
    thoughtsTokenCount: usage.thoughtsTokenCount ?? usage.thoughts_token_count ?? null,
    partSummaries: parts.map((part, index) => {
      const p = part as Record<string, unknown>;
      const text = typeof p.text === "string" ? p.text : "";
      return {
        index,
        thought: p.thought === true,
        textLength: text.length,
        textPreview: text.slice(0, 160),
        keys: Object.keys(p),
      };
    }),
  };
}

function logScoringParseFailure(context: Record<string, unknown>, error: unknown): void {
  const detail =
    error instanceof QuizScoringInvalidJsonError
      ? { message: error.message, contentPreview: error.contentPreview }
      : { message: error instanceof Error ? error.message : String(error) };
  console.warn("[courseware-quiz] scoring response parse failed", { ...context, ...detail });
}

function geminiUsage(payload: Record<string, unknown>, fallbackPrompt: string, fallbackResponse: string): ScoringUsage {
  const usage = payload.usageMetadata && typeof payload.usageMetadata === "object"
    ? payload.usageMetadata as Record<string, unknown>
    : {};
  const inputTokens = Number(usage.promptTokenCount ?? usage.prompt_token_count ?? 0);
  const outputTokens = Number(
    usage.candidatesTokenCount ??
      usage.candidates_token_count ??
      0,
  );
  const thoughtsTokens = Number(usage.thoughtsTokenCount ?? usage.thoughts_token_count ?? 0);
  const cacheTokens = Number(usage.cachedContentTokenCount ?? usage.cached_content_token_count ?? 0);
  return {
    inputTokens: Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : estimateTokens(fallbackPrompt),
    outputTokens:
      (Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : estimateTokens(fallbackResponse)) +
      (Number.isFinite(thoughtsTokens) && thoughtsTokens > 0 ? thoughtsTokens : 0),
    cacheTokens: Number.isFinite(cacheTokens) && cacheTokens > 0 ? cacheTokens : 0,
  };
}

async function runGeminiJsonScoring(args: {
  modality: ScoringModality;
  systemPrompt: string;
  userMessage: string;
  max: number;
  audioParts?: { bytes: Buffer; mime: string }[];
}): Promise<ScoringRunResult> {
  const model = scoringModel(args.modality);
  const parts: Record<string, unknown>[] = [{ text: args.userMessage }];
  for (const audio of args.audioParts ?? []) {
    parts.push({
      inlineData: {
        mimeType: audio.mime,
        data: audio.bytes.toString("base64"),
      },
    });
  }
  const response = await fetch(
    `${geminiApiBaseUrl(args.modality)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey(args.modality))}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: geminiScoringGenerationConfig(model),
        safetySettings: [
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
        ],
      }),
    },
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const message = payload && typeof payload.error === "object"
      ? JSON.stringify(payload.error)
      : `Gemini scoring failed (${response.status})`;
    throw new Error(message);
  }
  const content = extractGeminiText(payload);
  let parsed: ParsedScore;
  try {
    parsed = parseScoreJson(content || "{}", args.max);
  } catch (error) {
    logScoringParseFailure(
      {
        provider: "gemini_api",
        modality: args.modality,
        model,
        audioPartCount: args.audioParts?.length ?? 0,
        extractedTextLength: content.length,
        extractedTextPreview: content.slice(0, 500),
        gemini: summarizeGeminiPayloadForLog(payload),
      },
      error,
    );
    throw error;
  }
  return {
    parsed,
    usage: geminiUsage(payload, `${args.systemPrompt}\n${args.userMessage}`, content),
  };
}

async function runVertexJsonScoring(args: {
  modality: ScoringModality;
  systemPrompt: string;
  userMessage: string;
  max: number;
  audioParts?: { bytes: Buffer; mime: string }[];
}): Promise<ScoringRunResult> {
  const model = scoringModel(args.modality);
  const parts: Record<string, unknown>[] = [{ text: args.userMessage }];
  for (const audio of args.audioParts ?? []) {
    parts.push({
      inlineData: {
        mimeType: audio.mime,
        data: audio.bytes.toString("base64"),
      },
    });
  }
  const response = await fetch(
    `${vertexBaseUrl(args.modality)}/projects/${encodeURIComponent(vertexProjectId())}/locations/${encodeURIComponent(vertexLocation())}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await vertexAccessToken()}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: geminiScoringGenerationConfig(model),
      }),
    },
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const message = payload && typeof payload.error === "object"
      ? JSON.stringify(payload.error)
      : `Vertex AI scoring failed (${response.status})`;
    throw new Error(message);
  }
  const content = extractGeminiText(payload);
  let parsed: ParsedScore;
  try {
    parsed = parseScoreJson(content || "{}", args.max);
  } catch (error) {
    logScoringParseFailure(
      {
        provider: "vertexai",
        modality: args.modality,
        model,
        audioPartCount: args.audioParts?.length ?? 0,
        extractedTextLength: content.length,
        extractedTextPreview: content.slice(0, 500),
        gemini: summarizeGeminiPayloadForLog(payload),
      },
      error,
    );
    throw error;
  }
  return {
    parsed,
    usage: geminiUsage(payload, `${args.systemPrompt}\n${args.userMessage}`, content),
  };
}

function audioReferenceText(question: QuizQuestion): string {
  if (question.type === "speech") {
    return question.reference_text?.trim() || question.prompt?.trim() || question.title;
  }
  if (question.type === "shadowing") {
    return question.reference_text?.trim() || question.title;
  }
  return question.title;
}

export async function scoreCoursewareQuizAnswerWithAi(
  args: QuizAiScoringArgs,
): Promise<CoursewareQuizRawScoreResult> {
  const q = args.question;
  const max = maxScore(q);
  let userMessage: string;
  let systemPrompt: string;
  let transcript: string | undefined;
  let audioParts: { bytes: Buffer; mime: string }[] | undefined;
  let modality: ScoringModality = "text";

  if (q.type === "fill_blank" && q.grading === "ai") {
    const values = orderedAnswerValues(q, args.answer);
    const reference = q.blanks
      .map((blank, index) => `Blank ${index + 1} reference answer: ${blank.answer}`)
      .join("\n");
    const student = q.blanks
      .map((blank, index) => `Blank ${index + 1} student answer: ${values[index] ?? ""}`)
      .join("\n");
    userMessage = buildUserMessage({
      question: q,
      studentAnswer: student,
      referenceAnswer: reference,
    });
    systemPrompt = enhancedSystemPrompt({
      rubric: q.grading_criteria?.trim() || DEFAULT_FILL_BLANK_AI_RUBRIC,
      maxScore: max,
      isAudio: false,
      hasReferenceAudio: false,
      language: args.language,
    });
  } else if (q.type === "essay") {
    userMessage = buildUserMessage({
      question: q,
      studentAnswer: orderedAnswerValues(q, args.answer).join("\n"),
      referenceAnswer: q.reference_answer,
    });
    systemPrompt = enhancedSystemPrompt({
      rubric: q.grading_criteria?.trim() || DEFAULT_ESSAY_AI_RUBRIC,
      maxScore: max,
      isAudio: false,
      hasReferenceAudio: false,
      language: args.language,
    });
  } else if (q.type === "shadowing" || q.type === "speech") {
    modality = "audio";
    const locator = args.answer.recording_file_url?.trim() || args.answer.recording_file_path?.trim();
    if (!locator) {
      return {
        rawScore: 0,
        feedbackDetail: { error: "missing_recording" },
        feedbackOverride: "No valid recording was received, so this answer could not be graded.",
      };
    }
    const studentAudio = await fetchMediaBytes(locator);
    audioParts = [];
    if (q.reference_audio_url?.trim()) {
      try {
        const referenceAudio = await fetchMediaBytes(q.reference_audio_url.trim());
        audioParts.push({ bytes: referenceAudio.bytes, mime: referenceAudio.mime });
      } catch (error) {
        console.warn(
          "[courseware-quiz] reference audio load failed; continuing text/reference-only:",
          error instanceof Error ? error.message : error,
        );
      }
    }
    audioParts.push({ bytes: studentAudio.bytes, mime: studentAudio.mime });
    if (scoringProvider("audio") === "openai") {
      transcript = await transcribe(locator);
      await consumeTranscriptionCredits({
        session: args.session,
        orgId: args.orgId,
        submissionId: args.submissionId,
        questionWrapperId: args.questionWrapperId,
        durationSec: args.answer.recording_duration_sec ?? null,
      });
    }
    const rubric =
      q.type === "speech"
        ? q.grading_criteria?.trim() || DEFAULT_SPEECH_RUBRIC
        : DEFAULT_SHADOWING_RUBRIC;
    userMessage = buildUserMessage({
      question: q,
      studentAnswer: transcript,
      referenceAnswer: audioReferenceText(q),
      duration: args.answer.recording_duration_sec ?? null,
      hasReferenceAudio: audioParts.length > 1,
    });
    systemPrompt = enhancedSystemPrompt({
      rubric,
      maxScore: max,
      isAudio: true,
      hasReferenceAudio: audioParts.length > 1,
      language: args.language,
    });
  } else {
    return {
      rawScore: 0,
      feedbackDetail: { error: "unsupported_ai_question_type", type: q.type },
      feedbackOverride: "This question type is not currently supported for grading.",
    };
  }

  const provider = scoringProvider(modality);
  console.info("[courseware-quiz] scoring start", {
    submissionId: args.submissionId,
    questionWrapperId: args.questionWrapperId,
    questionId: q.question_id,
    questionType: q.type,
    modality,
    provider,
    model: scoringModel(modality),
    audioPartCount: audioParts?.length ?? 0,
    audioByteSizes: audioParts?.map((part) => part.bytes.length) ?? [],
    recordingDurationSec: args.answer.recording_duration_sec ?? null,
  });
  const scoringLabel = `quiz-scoring:${args.questionWrapperId}`;
  const { parsed, usage } = await runScoringWithJsonRetries(scoringLabel, () =>
    provider === "openai"
      ? runOpenAiJsonScoring(modality, `${systemPrompt}\n\n${userMessage}`, max)
      : provider === "gemini_api"
        ? runGeminiJsonScoring({ modality, systemPrompt, userMessage, max, audioParts })
        : runVertexJsonScoring({ modality, systemPrompt, userMessage, max, audioParts }),
  );
  const score = clampScore(parsed.score, max);
  const billingTransactionId = await consumeScoringCredits({
    session: args.session,
    orgId: args.orgId,
    modality,
    usage,
    submissionId: args.submissionId,
    questionWrapperId: args.questionWrapperId,
  });
  return {
    rawScore: score,
    feedbackOverride: feedback(parsed, score, max),
    feedbackDetail: {
      ...parsed,
      raw: parsed.raw,
      score,
      max_score: max,
      transcript: parsed.transcript ?? transcript,
      model: scoringModel(modality),
      provider,
      usage,
      billing_transaction_id: billingTransactionId,
    },
  };
}
