// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";

/** Canonical narration language codes used across the AINOBI host + CLI. */
export type NarrationLanguage = "zh" | "ja" | "en";

const LANGUAGE_ALIASES: Record<string, NarrationLanguage> = {
  zh: "zh",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-tw": "zh",
  "zh-hant": "zh",
  chinese: "zh",
  mandarin: "zh",
  cn: "zh",
  ja: "ja",
  "ja-jp": "ja",
  japanese: "ja",
  jp: "ja",
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  english: "en",
  us: "en"
};

const LANGUAGE_NAME: Record<NarrationLanguage, string> = {
  zh: "Chinese",
  ja: "Japanese",
  en: "English"
};

/** Normalize platform/teacher language strings (e.g. `zh`, `zh-CN`, `Japanese`). */
export const normalizeTeacherLanguage = (value: unknown): NarrationLanguage | undefined => {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!key) return undefined;
  return LANGUAGE_ALIASES[key];
};

const HIRAGANA_RE = /[\u3040-\u309F]/g;
const KATAKANA_RE = /[\u30A0-\u30FF\u31F0-\u31FF]/g;
const CJK_IDEOGRAPH_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const LATIN_LETTER_RE = /[A-Za-z]/g;

const countMatches = (text: string, regex: RegExp): number => {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
};

/**
 * Sniff the dominant script of a narration transcript.
 * Returns `undefined` when the input is too short or has no scriptful characters.
 */
export const detectTranscriptLanguage = (text: string): NarrationLanguage | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const hiragana = countMatches(trimmed, HIRAGANA_RE);
  const katakana = countMatches(trimmed, KATAKANA_RE);
  const cjk = countMatches(trimmed, CJK_IDEOGRAPH_RE);
  const latin = countMatches(trimmed, LATIN_LETTER_RE);

  if (hiragana + katakana >= 2) return "ja";
  if (cjk >= 2) return "zh";

  if (latin >= 8) return "en";
  if (cjk >= 1) return "zh";
  if (hiragana + katakana >= 1) return "ja";

  return undefined;
};

const labelFor = (code: NarrationLanguage): string => LANGUAGE_NAME[code];

/**
 * Compare the narration source language with the AI teacher's declared
 * `ai_teacher_language`. Returns a warning when they disagree.
 *
 * The check is intentionally a warning (not a hard error) so bilingual
 * content (e.g. Chinese narration with English code samples) still ships,
 * but the agent receives an explicit signal to confirm with the user.
 */
export const buildTranscriptLanguageMismatchWarning = (args: {
  transcript: string;
  teacherLanguage: string | undefined;
  warningPath: string;
}): CliIssue | null => {
  const teacherLang = normalizeTeacherLanguage(args.teacherLanguage);
  if (!teacherLang) return null;
  const detected = detectTranscriptLanguage(args.transcript);
  if (!detected || detected === teacherLang) return null;

  return {
    path: args.warningPath,
    message:
      `Narration transcript looks like ${labelFor(detected)}, but the selected AI teacher's ` +
      `ai_teacher_language is ${labelFor(teacherLang)}. Rewrite the transcript in ` +
      `${labelFor(teacherLang)} to match the teacher's voice/locale, or switch to a teacher ` +
      `whose ai_teacher_language is "${detected}". Confirm intent with the user before proceeding ` +
      `if mixing languages is required.`,
  };
};
