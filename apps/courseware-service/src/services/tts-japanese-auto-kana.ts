// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeMultilineCliText } from '@ainobi/courseware-cli/cli/cli-text.ts';
import { normalizeTeacherLanguage } from '@ainobi/courseware-cli/cli/narration-language-detect.ts';
import { splitTranscriptForTts } from '@ainobi/courseware-cli/cli/tts.ts';
import { resolveNarrationTtsSourceFromArgv } from './narration-tts-credits.ts';
import { resolveNarrationTtsLanguagesForPreauth } from './narration-tts-preauth.ts';
import {
  applyJapaneseKanaReplacements,
  parsePronunciationDictJson,
  shouldApplyPronunciationDict,
  type PronunciationDictEntry,
} from './tts-pronunciation-apply.ts';
import { convertJapaneseTextToKanaForTts } from './tts-pronunciation-convert.ts';

/** Text → kana converter (kuroshiro in production; injectable for tests). */
export type JapaneseKanaConverter = (text: string) => Promise<string>;

/** Japanese narration: the AI teacher language or the selected catalog voice language is `ja`. */
export function isJapaneseNarrationLanguage(
  teacherLanguage: unknown,
  voiceLanguage?: unknown,
): boolean {
  return (
    normalizeTeacherLanguage(teacherLanguage) === 'ja' ||
    normalizeTeacherLanguage(voiceLanguage) === 'ja'
  );
}

// Counters / units that follow a number in Japanese narration (longest first so
// `時間` wins over `時`, `日間` over `日`).
const JA_COUNTERS = [
  'ヶ月', 'か月', 'カ月', 'ケ月', '週間', '時間', '日間', '年間', '年生', '人前', 'ページ',
  '年', '月', '日', '時', '分', '秒', '週', '回', '番', '問', '人', '個', '本', '枚', '冊',
  '匹', '杯', '階', '歳', '才', '円', '点', '度', '倍', '割', '位', '級', '課', '章', '節', '頁',
  'つ', '%', '％',
];
// Optional tail after the counter that still belongs to the number phrase (3日目, 2日後).
const JA_COUNTER_TAILS = ['以上', '以下', '以内', '目', '間', '中', '後', '前', '半'];
const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DIGITS = '[0-9０-９]+(?:[.,．，][0-9０-９]+)*';
const NUMBER_UNIT = `${DIGITS}(?:${JA_COUNTERS.map(escapeRe).join('|')})(?:${JA_COUNTER_TAILS.map(escapeRe).join('|')})?`;
// `第` prefix and chained units (2026年4月1日, 1時間30分) form one span.
const JA_NUMBER_SPAN_RE = new RegExp(`第?${NUMBER_UNIT}(?:${NUMBER_UNIT})*`, 'g');
// No space is inserted next to whitespace or punctuation / brackets.
const JA_SPACING_BOUNDARY_RE = /[\s、。，．,.!?！？:：;；「」『』（）()【】［］\[\]〈〉《》・…〜~\-—/／"'“”‘’]/;

/**
 * TTS-only: put a half-width space between a number phrase (dates, counters, 第N問)
 * and the neighbouring words — `4月1日から30日までの` → `4月1日 から 30日 までの` —
 * so MiniMax / FishAudio phrase it as one unit. Subtitles keep the original line.
 */
export function spaceJapaneseNumberSpansForTts(text: string): string {
  return text.replace(JA_NUMBER_SPAN_RE, (span: string, offset: number, whole: string) => {
    const before = offset > 0 ? whole[offset - 1]! : '';
    const after = whole[offset + span.length] ?? '';
    const lead = before && !JA_SPACING_BOUNDARY_RE.test(before) ? ' ' : '';
    const trail = after && !JA_SPACING_BOUNDARY_RE.test(after) ? ' ' : '';
    return `${lead}${span}${trail}`;
  });
}

/**
 * Full-text kana rewrite for one TTS line: the org dictionary is applied first (its
 * readings win), then kuroshiro converts the remaining kanji. Never throws: when the
 * converter fails the dictionary-only text is returned so synthesis still proceeds.
 */
export async function rewriteJapaneseTextToKanaForTts(
  text: string,
  entries: readonly PronunciationDictEntry[],
  convert: JapaneseKanaConverter = convertJapaneseTextToKanaForTts,
): Promise<string> {
  // Keys get the same TTS-only spacing as the text, so entries spanning a number boundary
  // (`令和6年`, `4月1日から`) still match exactly and keep dictionary precedence.
  const spacedEntries = entries.map((entry) => ({
    ...entry,
    sourceText: spaceJapaneseNumberSpansForTts(entry.sourceText),
  }));
  const afterDict = applyJapaneseKanaReplacements(spaceJapaneseNumberSpansForTts(text), spacedEntries);
  if (!afterDict.trim()) return afterDict;
  try {
    const kana = await convert(afterDict);
    return kana.trim() ? kana : afterDict;
  } catch (error) {
    console.warn(
      '[tts-auto-kana] kana conversion failed, using dictionary-only text:',
      error instanceof Error ? error.message : String(error),
    );
    return afterDict;
  }
}

/**
 * `{ [line]: kana }` for every transcript line the rewrite changes. Keys are the lines
 * exactly as the CLI splits/trims them (`splitTranscriptForTts`), so the child process
 * can look them up per line.
 */
export async function buildJapaneseKanaLineRewrites(
  source: string,
  entries: readonly PronunciationDictEntry[],
  convert?: JapaneseKanaConverter,
): Promise<Record<string, string>> {
  const out: Record<string, string> = Object.create(null);
  for (const line of splitTranscriptForTts(source)) {
    if (Object.prototype.hasOwnProperty.call(out, line)) continue;
    const kana = await rewriteJapaneseTextToKanaForTts(line, entries, convert);
    if (kana !== line) {
      out[line] = kana;
    }
  }
  return out;
}

/**
 * Kana line map for an `ainobi narration insert` argv.
 * - `undefined`: not applicable (provider without dict support, or not Japanese)
 * - `null`: applicable but nothing to rewrite (clears an explicitly set env key)
 * - string: JSON for the child (runHostNarration stages it as a temp file, path in env)
 */
export async function resolveNarrationJaKanaLinesJson(args: {
  argv: string[];
  entries: readonly PronunciationDictEntry[];
  teacherLanguage?: unknown;
  voiceLanguage?: unknown;
  ttsProvider?: string | null;
  convert?: JapaneseKanaConverter;
}): Promise<string | null | undefined> {
  if (!shouldApplyPronunciationDict(args.ttsProvider)) return undefined;
  if (!isJapaneseNarrationLanguage(args.teacherLanguage, args.voiceLanguage)) return undefined;
  // Same normalization as the CLI (`narration insert` decodes `\n` escapes before splitting).
  const source = normalizeMultilineCliText(resolveNarrationTtsSourceFromArgv(args.argv));
  if (!source.trim()) return null;
  const rewrites = await buildJapaneseKanaLineRewrites(source, args.entries, args.convert);
  return Object.keys(rewrites).length > 0 ? JSON.stringify(rewrites) : null;
}

/** Teacher / voice languages of one narration job plus the derived Japanese flag. */
export type NarrationJobLanguages = {
  teacherLanguage?: string;
  voiceLanguage?: string;
  /** `isJapaneseNarrationLanguage(teacherLanguage, voiceLanguage)` */
  japanese: boolean;
};

/**
 * Narration host path (HTTP callback + Codex MCP): resolve the teacher / voice
 * languages of an `ainobi narration insert` job from the CLI session catalog.
 * Call it ONCE per job, before the pronunciation dict: `japanese` gates both the
 * platform dict merge (`includePlatform`) and the kana line map. Never throws:
 * an unreadable catalog means "not Japanese" (org dict only, no kana rewrite).
 */
export async function resolveNarrationLanguagesForJob(args: {
  stateDir: string;
  sessionId?: string;
  shellSession?: string;
  argv: string[];
}): Promise<NarrationJobLanguages> {
  try {
    const languages = await resolveNarrationTtsLanguagesForPreauth(args);
    return {
      ...languages,
      japanese: isJapaneseNarrationLanguage(languages.teacherLanguage, languages.voiceLanguage),
    };
  } catch (error) {
    console.warn(
      '[tts-auto-kana] failed to resolve narration languages; treating the job as non-Japanese:',
      error instanceof Error ? error.message : String(error),
    );
    return { japanese: false };
  }
}

/**
 * Narration host path (HTTP callback + Codex MCP): build `ja_kana_lines_json` for the
 * child process. `languages` comes from `resolveNarrationLanguagesForJob` (same catalog
 * read as the dict decision); `pronunciationDictJson` is the merged dict JSON already
 * resolved for the same job (no second DB query). Never throws: any failure disables
 * the rewrite for this job.
 */
export async function resolveNarrationJaKanaLinesJsonForJob(args: {
  argv: string[];
  ttsProvider?: string | null;
  languages: NarrationJobLanguages;
  pronunciationDictJson?: string | null;
}): Promise<string | null | undefined> {
  if (!shouldApplyPronunciationDict(args.ttsProvider)) return undefined;
  if (!args.languages.japanese) return undefined;
  try {
    return await resolveNarrationJaKanaLinesJson({
      argv: args.argv,
      entries: parsePronunciationDictJson(args.pronunciationDictJson ?? undefined),
      teacherLanguage: args.languages.teacherLanguage,
      voiceLanguage: args.languages.voiceLanguage,
      ttsProvider: args.ttsProvider,
    });
  } catch (error) {
    console.warn(
      '[tts-auto-kana] failed to build kana line map for narration host:',
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}
