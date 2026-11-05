// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TTS pronunciation dictionary rules and text rewriting.
 * - Japanese: replace source keywords with kana before synthesis (Google / MiniMax / FishAudio)
 * - Chinese: MiniMax's official `pronunciation_dict.tone` (`处理/(chu3)(li3)`); FishAudio gets no tone injection
 */

export type PronunciationDictLanguage = "ja" | "zh";

export type PronunciationDictEntry = {
  sourceText: string;
  language: PronunciationDictLanguage;
  pronunciation: string;
  enabled?: boolean;
};

export function normalizePronunciationMark(mark: string): string {
  return mark.trim().replace(/^\(+|\)+$/g, "").trim();
}

/** Split pinyin syllables (spaces / consecutive parentheses) */
export function splitPronunciationSyllables(pronunciation: string): string[] {
  const mark = normalizePronunciationMark(pronunciation);
  if (!mark) return [];
  const fromParens = [...mark.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim()).filter(Boolean);
  if (fromParens.length > 0) return fromParens;
  return mark.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Chinese inline: per character `(zuo4)作(si3)死` (never `(zuo4 si3)作死`).
 * Japanese inline: replaced directly with the kana reading.
 */
export function formatInlinePronunciation(
  sourceText: string,
  pronunciation: string,
  language: PronunciationDictLanguage,
): string {
  const mark = normalizePronunciationMark(pronunciation);
  if (!mark || !sourceText) return sourceText;

  if (language === "zh") {
    const syllables = splitPronunciationSyllables(mark);
    const chars = Array.from(sourceText);
    if (syllables.length === chars.length && syllables.length > 0) {
      return chars.map((ch, i) => `(${syllables[i]})${ch}`).join("");
    }
    if (syllables.length > 0) {
      return `${syllables.map((s) => `(${s})`).join("")}${sourceText}`;
    }
    return `(${mark})${sourceText}`;
  }

  return mark;
}

/**
 * A single MiniMax `pronunciation_dict.tone` entry (Chinese only).
 * Japanese returns null: it goes through kana text replacement instead, with no tone injection.
 */
export function formatMinimaxToneRule(
  sourceText: string,
  pronunciation: string,
  language: PronunciationDictLanguage,
): string | null {
  if (language === "ja") return null;

  const source = sourceText.trim();
  const mark = normalizePronunciationMark(pronunciation);
  if (!source || !mark) return null;

  const syllables = splitPronunciationSyllables(mark);
  if (syllables.length === 0) return null;
  return `${source}/${syllables.map((s) => `(${s})`).join("")}`;
}

export function buildMinimaxToneRules(
  entries: readonly PronunciationDictEntry[],
): string[] {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    if (entry.language !== "zh") continue;
    const rule = formatMinimaxToneRule(
      entry.sourceText,
      entry.pronunciation,
      entry.language,
    );
    if (!rule) continue;
    const key = rule.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return rules;
}

const FULLWIDTH_DIGIT_RE = /[\uFF10-\uFF19]/g;

/**
 * Fold full-width digits (０-９) to ASCII so dictionary sources written with
 * half-width digits match narration typed with full-width ones. Used for the
 * matching view and dedupe keys only; unmatched output keeps the original text.
 */
export function foldFullWidthDigits(text: string): string {
  return text.replace(FULLWIDTH_DIGIT_RE, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
}

const isAsciiDigit = (ch: string | undefined): boolean =>
  ch !== undefined && ch.length === 1 && ch >= "0" && ch <= "9";

/**
 * Decimal point or thousands separator (half- or full-width). Between two digits
 * they join one number, so `5日` must not fire inside `1.5日` and `100人` not inside
 * `1,100人`. Enumeration marks (`・`, `、`, `／`) are deliberately NOT included:
 * in `3・4日` the last item keeps its counter reading.
 */
const isNumberSeparator = (ch: string | undefined): boolean =>
  ch === "." || ch === "．" || ch === "," || ch === "，";

/** Position `i` continues a number written before it (`3|`, `3.|`, `1,|`). */
const isInsideNumberBefore = (folded: readonly string[], i: number): boolean =>
  isAsciiDigit(folded[i - 1]) ||
  (isNumberSeparator(folded[i - 1]) && isAsciiDigit(folded[i - 2]));

/** Position `j` continues a number after it (`|5`, `|.5`, `|,5`): `第1` in `第1.5回`. */
const isInsideNumberAfter = (folded: readonly string[], j: number): boolean =>
  isAsciiDigit(folded[j]) ||
  (isNumberSeparator(folded[j]) && isAsciiDigit(folded[j + 1]));

/**
 * Dedupe key for dictionary sources: trim + digit fold, case-sensitive — exactly the
 * trie path used for matching, so an entry that shadows another can also match for it.
 */
export function normalizePronunciationSourceKey(sourceText: string): string {
  return foldFullWidthDigits(sourceText.trim());
}

type JaTrieTerminal = {
  replacement: string;
  /** Code point count of the source text (Array.from length) */
  sourceLen: number;
  /** Digit-boundary rule: a source starting with a digit must not match right after a digit. */
  startsWithDigit: boolean;
  /** Digit-boundary rule: a source ending with a digit must not match right before a digit. */
  endsWithDigit: boolean;
  /** The raw source contained full-width digits (folded away for the trie path). */
  fromFullWidth: boolean;
};

type JaTrieNode = {
  children: Map<string, JaTrieNode>;
  terminal: JaTrieTerminal | null;
};

function createJaTrieNode(): JaTrieNode {
  return { children: new Map(), terminal: null };
}

/**
 * Build the Japanese kana replacement trie.
 * When the same source appears more than once, the later entry overwrites the earlier one (callers should deduplicate first).
 */
function buildJapaneseKanaTrie(
  entries: readonly PronunciationDictEntry[],
): JaTrieNode {
  const root = createJaTrieNode();
  for (const entry of entries) {
    if (entry.enabled === false || entry.language !== "ja") continue;
    // Sources are folded so half-width and full-width digits share one trie path.
    const rawSource = entry.sourceText.trim();
    const source = foldFullWidthDigits(rawSource);
    const fromFullWidth = source !== rawSource;
    const replacement = normalizePronunciationMark(entry.pronunciation);
    if (!source || !replacement) continue;
    const chars = Array.from(source);
    let node = root;
    for (const ch of chars) {
      let next = node.children.get(ch);
      if (!next) {
        next = createJaTrieNode();
        node.children.set(ch, next);
      }
      node = next;
    }
    // Longer words win through the "deepest terminal" during the scan; at equal length the later entry overwrites.
    // Exception: when a half-width source and its full-width spelling both exist
    // (org rows are unique on the raw text), the half-width one is canonical and a
    // full-width variant never overrides it, whatever the order.
    if (node.terminal && fromFullWidth && !node.terminal.fromFullWidth) continue;
    node.terminal = {
      replacement,
      sourceLen: chars.length,
      startsWithDigit: isAsciiDigit(chars[0]),
      endsWithDigit: isAsciiDigit(chars[chars.length - 1]),
      fromFullWidth,
    };
  }
  return root;
}

/**
 * Japanese: longest-match trie scan replacing source keywords with kana.
 * Roughly O(n + match depth), suited to short narration lines + organization-level dictionaries.
 */
export function applyJapaneseKanaReplacements(
  text: string,
  entries: readonly PronunciationDictEntry[],
): string {
  if (!text) return text;
  const hasJa = entries.some(
    (e) =>
      e.enabled !== false &&
      e.language === "ja" &&
      e.sourceText.trim() &&
      normalizePronunciationMark(e.pronunciation),
  );
  if (!hasJa) return text;

  const root = buildJapaneseKanaTrie(entries);
  if (root.children.size === 0) return text;

  const chars = Array.from(text);
  // Matching view: full-width digits folded to ASCII (1:1 code points, index-aligned
  // with `chars`), so unmatched output can still emit the original characters.
  const folded = Array.from(foldFullWidthDigits(text));
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    let node: JaTrieNode = root;
    let best: JaTrieTerminal | null = null;
    const precededByDigit = i > 0 && isInsideNumberBefore(folded, i);
    let j = i;
    while (j < chars.length) {
      const next = node.children.get(folded[j]!);
      if (!next) break;
      node = next;
      j += 1;
      const terminal = node.terminal;
      if (!terminal) continue;
      // Digit-boundary rule: `3日` must not fire inside `13日`, `1.3日` or `1,300日`,
      // `第1` not inside `第12` or `第1.5`. A rejected terminal does not stop the walk:
      // a longer entry may still qualify.
      const followedByDigit = j < chars.length && isInsideNumberAfter(folded, j);
      if (
        (terminal.startsWithDigit && precededByDigit) ||
        (terminal.endsWithDigit && followedByDigit)
      ) {
        continue;
      }
      best = terminal;
    }
    if (best) {
      out.push(best.replacement);
      i += best.sourceLen;
    } else {
      out.push(chars[i]!);
      i += 1;
    }
  }
  return out.join("");
}

/**
 * Legacy-compatible path: Chinese inline pinyin markers + Japanese kana replacement (longest match).
 * The main MiniMax synthesis path: tone for Chinese, applyJapaneseKanaReplacements for Japanese.
 */
export function applyPronunciationDict(
  text: string,
  entries: readonly PronunciationDictEntry[],
): string {
  if (!text) return text;

  // Japanese kana replacement first, then Chinese inline markers on the remaining text (safest when the two never compete for the same token)
  const afterJa = applyJapaneseKanaReplacements(text, entries);

  const usableZh = entries
    .filter((e) => e.enabled !== false && e.language === "zh")
    .map((e) => ({
      sourceText: e.sourceText.trim(),
      language: e.language,
      pronunciation: normalizePronunciationMark(e.pronunciation),
    }))
    .filter((e) => e.sourceText.length > 0 && e.pronunciation.length > 0)
    .sort(
      (a, b) =>
        b.sourceText.length - a.sourceText.length ||
        a.sourceText.localeCompare(b.sourceText),
    );

  if (usableZh.length === 0) return afterJa;

  let result = "";
  let i = 0;
  while (i < afterJa.length) {
    let matched: (typeof usableZh)[number] | null = null;
    for (const entry of usableZh) {
      if (afterJa.startsWith(entry.sourceText, i)) {
        matched = entry;
        break;
      }
    }
    if (matched) {
      result += formatInlinePronunciation(
        matched.sourceText,
        matched.pronunciation,
        matched.language,
      );
      i += matched.sourceText.length;
    } else {
      result += afterJa[i];
      i += 1;
    }
  }
  return result;
}

export function shouldApplyPronunciationDict(provider: string | null | undefined): boolean {
  const p = provider?.trim().toLowerCase() ?? "";
  // Japanese kana rewriting: supported by Google / MiniMax / FishAudio; Chinese tone only by MiniMax
  return (
    p === "google" ||
    p === "minimax" ||
    p === "fishaudio" ||
    p === "fish.audio" ||
    p === "fish_audio"
  );
}

/** Chinese pronunciation_dict.tone is officially supported only by MiniMax */
export function shouldApplyMinimaxToneDict(provider: string | null | undefined): boolean {
  const p = provider?.trim().toLowerCase() ?? "";
  return p === "minimax";
}

/**
 * Path of a host-written JSON file with the merged pronunciation dict entries for the
 * narration child (child env only, see agent-narration-host-run.ts). The dict travels
 * as a file, not as an env value: a single env string is capped at 128 KiB on Linux.
 */
export const AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV = "AINOBI_TTS_PRONUNCIATION_DICT_FILE";

/** Parse dict entries JSON (host-written file / job field). Malformed input yields `[]`. */
export function parsePronunciationDictJson(
  json: string | undefined,
): PronunciationDictEntry[] {
  const raw = json?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row): PronunciationDictEntry | null => {
        if (!row || typeof row !== "object") return null;
        const sourceText = String((row as { sourceText?: unknown }).sourceText ?? "").trim();
        const languageRaw = String((row as { language?: unknown }).language ?? "")
          .trim()
          .toLowerCase();
        const pronunciation = String(
          (row as { pronunciation?: unknown }).pronunciation ?? "",
        ).trim();
        if (!sourceText || !pronunciation) return null;
        if (languageRaw !== "ja" && languageRaw !== "zh") return null;
        return {
          sourceText,
          language: languageRaw as PronunciationDictLanguage,
          pronunciation,
          enabled: true,
        };
      })
      .filter((row): row is PronunciationDictEntry => row != null);
  } catch {
    return [];
  }
}

/**
 * Path of a host-written JSON file `{ [line]: kana }` with the Japanese kana rewrites for
 * the narration TTS lines (child env only). The map travels as a file, not as an env
 * value: a single env string is capped at 128 KiB on Linux.
 */
export const AINOBI_TTS_JA_KANA_LINES_FILE_ENV = "AINOBI_TTS_JA_KANA_LINES_FILE";

/**
 * Parse the kana line map JSON written by the host. Anything malformed yields an empty
 * map so the CLI falls back to dictionary-only rewriting. The result has a null
 * prototype: keys come straight from JSON, so `__proto__` must stay plain data.
 */
export function parseKanaLineRewritesJson(json: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const raw = json?.trim();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [line, kana] of Object.entries(parsed as Record<string, unknown>)) {
    const key = line.trim();
    if (!key || typeof kana !== "string") continue;
    const value = kana.trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

/** Kana rewrite for one TTS line (`undefined` when the host did not rewrite it). */
export function resolveKanaLineRewrite(
  line: string,
  rewrites: Readonly<Record<string, string>>,
): string | undefined {
  const key = line.trim();
  if (!key) return undefined;
  return Object.prototype.hasOwnProperty.call(rewrites, key) ? rewrites[key] : undefined;
}
