// SPDX-License-Identifier: AGPL-3.0-only
import { pinyin } from "pinyin-pro";

import type { PronunciationDictLanguage } from "./tts-pronunciation-apply.ts";

type KuroshiroInstance = {
  init: (analyzer: unknown) => Promise<void>;
  convert: (text: string, options: { to: string; mode?: string }) => Promise<string>;
};

type KuroshiroUtil = {
  kanaToHiragna?: (s: string) => string;
};

let kuroshiroPromise: Promise<{
  instance: KuroshiroInstance;
  util: KuroshiroUtil | null;
}> | null = null;

/** Unwrap the CJS/ESM double default (kuroshiro is default.default under NodeNext) */
function resolveConstructor<T>(mod: unknown): new () => T {
  let cur: unknown = mod;
  for (let i = 0; i < 4; i++) {
    if (typeof cur === "function") {
      return cur as new () => T;
    }
    if (cur && typeof cur === "object" && "default" in cur) {
      cur = (cur as { default: unknown }).default;
      continue;
    }
    break;
  }
  throw new Error("Module export is not a constructor");
}

function resolveKuroshiroExport(mod: unknown): {
  Ctor: new () => KuroshiroInstance;
  util: KuroshiroUtil | null;
} {
  let cur: unknown = mod;
  let util: KuroshiroUtil | null = null;
  for (let i = 0; i < 4; i++) {
    if (cur && typeof cur === "object" && "Util" in cur) {
      util = (cur as { Util: KuroshiroUtil }).Util ?? util;
    }
    if (typeof cur === "function") {
      const maybeUtil = (cur as { Util?: KuroshiroUtil }).Util;
      return { Ctor: cur as new () => KuroshiroInstance, util: maybeUtil ?? util };
    }
    if (cur && typeof cur === "object" && "default" in cur) {
      cur = (cur as { default: unknown }).default;
      continue;
    }
    break;
  }
  throw new Error("Module export is not a constructor");
}

async function getKuroshiro(): Promise<{
  instance: KuroshiroInstance;
  util: KuroshiroUtil | null;
}> {
  if (!kuroshiroPromise) {
    kuroshiroPromise = (async () => {
      const KuroshiroMod = await import("kuroshiro");
      const AnalyzerMod = await import("kuroshiro-analyzer-kuromoji");
      const { Ctor: KuroshiroCtor, util } = resolveKuroshiroExport(KuroshiroMod);
      const AnalyzerCtor = resolveConstructor<unknown>(AnalyzerMod);
      const instance = new KuroshiroCtor();
      await instance.init(new AnalyzerCtor());
      return { instance, util };
    })().catch((err) => {
      // Allow a retry next time when initialization fails
      kuroshiroPromise = null;
      throw err;
    });
  }
  return kuroshiroPromise;
}

/** Chinese → MiniMax pinyin (tone digits 1–5, syllables separated by spaces) */
export function convertChineseToPinyin(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parts = pinyin(trimmed, {
    toneType: "num",
    type: "array",
    nonZh: "consecutive",
  }) as string[];
  return parts
    .map((p) => String(p).trim())
    .filter(Boolean)
    // pinyin-pro gives the neutral tone 0; by product convention it maps to the first tone 1
    .map((p) => p.replace(/0\b/g, "1"))
    .join(" ");
}

/**
 * Japanese (including kanji) → hiragana (space-separated by word, so MiniMax segments words correctly).
 * MiniMax's official Japanese pronunciation_dict examples use kana/romaji (e.g. `東京/トウキョウ`),
 * not IPA; IPA is easily misread by the model.
 */
export async function convertJapaneseToKana(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const { instance, util } = await getKuroshiro();
  // mode:spaced inserts spaces by tokenization, so long compounds written together don't make TTS split wrongly
  const kana = await instance.convert(trimmed, { to: "hiragana", mode: "spaced" });
  // kuroshiro often keeps katakana; squash it into hiragana afterwards
  const hiragana =
    util && typeof util.kanaToHiragna === "function"
      ? util.kanaToHiragna(kana)
      : kana;
  return mergeShortKanaTokens(hiragana).trim();
}

/**
 * Japanese (kanji-mixed) text → kana for the TTS request body (full-text auto kana).
 * Unlike `convertJapaneseToKana` (dictionary registration: spaced hiragana, katakana
 * squashed), this keeps the sentence unspaced and leaves katakana loanwords as-is;
 * kana runs already present (e.g. dictionary readings applied beforehand) are not
 * touched by `mode: "normal"`.
 */
export async function convertJapaneseTextToKanaForTts(text: string): Promise<string> {
  if (!text.trim()) return text;
  const { instance } = await getKuroshiro();
  return instance.convert(text, { to: "hiragana", mode: "normal" });
}

/** kuromoji often over-splits word endings; merge them back into the preceding word (事業所 → じぎょう しょ) */
const KANA_MERGE_SUFFIXES = new Set([
  "しょ",
  "じょ",
  "ちょ",
  "りょう",
  "いん",
  "かん",
  "しゃ",
  "しき",
  "てき",
  "ぶ",
  "か",
]);

/**
 * Tokenization occasionally splits off a word ending (e.g. 事業所 → じぎょう しょ);
 * only known short suffixes are merged, so particles like "は/を" are never merged in.
 */
function mergeShortKanaTokens(spaced: string): string {
  const parts = spaced.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts.join(" ");
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && KANA_MERGE_SUFFIXES.has(part)) {
      merged[merged.length - 1] += part;
    } else {
      merged.push(part);
    }
  }
  return merged.join(" ");
}

/** @deprecated Use convertJapaneseToKana; the alias stays so old callers don't break */
export const convertJapaneseToIpa = convertJapaneseToKana;

export async function convertTextToPronunciation(
  text: string,
  language: PronunciationDictLanguage,
): Promise<string> {
  if (language === "zh") {
    return convertChineseToPinyin(text);
  }
  if (language === "ja") {
    return convertJapaneseToKana(text);
  }
  throw new Error(`Unsupported pronunciation language: ${language}`);
}
