// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyJapaneseKanaReplacements,
  applyPronunciationDict,
  buildMinimaxToneRules,
  foldFullWidthDigits,
  formatInlinePronunciation,
  normalizePronunciationSourceKey,
  formatMinimaxToneRule,
  normalizePronunciationMark,
  parseKanaLineRewritesJson,
  resolveKanaLineRewrite,
  shouldApplyPronunciationDict,
} from "./tts-pronunciation-apply.ts";
import { convertChineseToPinyin, convertJapaneseToKana } from "./tts-pronunciation-convert.ts";

test("formats zh per-character and ja as kana replacement", () => {
  assert.equal(formatInlinePronunciation("平", "he2", "zh"), "(he2)平");
  assert.equal(formatInlinePronunciation("作死", "zuo4 si3", "zh"), "(zuo4)作(si3)死");
  assert.equal(
    formatInlinePronunciation("病態メカニズム", "びょうたい めかにずむ", "ja"),
    "びょうたい めかにずむ",
  );
});

test("builds MiniMax tone rules for zh only (ja excluded)", () => {
  assert.equal(formatMinimaxToneRule("作死", "zuo4 si3", "zh"), "作死/(zuo4)(si3)");
  assert.equal(formatMinimaxToneRule("平", "he2", "zh"), "平/(he2)");
  assert.equal(
    formatMinimaxToneRule("病態メカニズム", "びょうたい めかにずむ", "ja"),
    null,
  );
  assert.deepEqual(
    buildMinimaxToneRules([
      { sourceText: "作死", language: "zh", pronunciation: "zuo4 si3" },
      { sourceText: "居宅", language: "ja", pronunciation: "きょたく" },
      { sourceText: "作死", language: "zh", pronunciation: "zuo4 si3" },
    ]),
    ["作死/(zuo4)(si3)"],
  );
});

test("japanese kana rewrite uses longest-match trie", () => {
  const entries = [
    { sourceText: "介護", language: "ja" as const, pronunciation: "かいご" },
    {
      sourceText: "居宅介護支援事業所",
      language: "ja" as const,
      pronunciation: "きょたく かいご しえん じぎょうしょ",
    },
    { sourceText: "支援", language: "ja" as const, pronunciation: "しえん" },
  ];
  assert.equal(
    applyJapaneseKanaReplacements(
      "本日は居宅介護支援事業所について説明します",
      entries,
    ),
    "本日はきょたく かいご しえん じぎょうしょについて説明します",
  );
  // Longest first: the shorter "介護" isn't consumed first
  assert.equal(
    applyJapaneseKanaReplacements("居宅介護支援事業所", entries),
    "きょたく かいご しえん じぎょうしょ",
  );
});

test("normalizes surrounding parentheses on marks", () => {
  assert.equal(normalizePronunciationMark("(he2)"), "he2");
  assert.equal(normalizePronunciationMark("  lɪv  "), "lɪv");
});

test("applies longest match first without overlapping", () => {
  const out = applyPronunciationDict("你好世界你好", [
    { sourceText: "你好", language: "zh", pronunciation: "ni3 hao3" },
    { sourceText: "你好世界", language: "zh", pronunciation: "ni3 hao3 shi4 jie4" },
    { sourceText: "世界", language: "zh", pronunciation: "shi4 jie4" },
  ]);
  assert.equal(out, "(ni3)你(hao3)好(shi4)世(jie4)界(ni3)你(hao3)好");
});

test("skips disabled and empty entries", () => {
  const out = applyPronunciationDict("你好", [
    { sourceText: "你好", language: "zh", pronunciation: "ni3 hao3", enabled: false },
    { sourceText: "", language: "zh", pronunciation: "x" },
    { sourceText: "你好", language: "zh", pronunciation: "" },
  ]);
  assert.equal(out, "你好");
});

test("enables pronunciation dict for MiniMax and FishAudio", () => {
  assert.equal(shouldApplyPronunciationDict("minimax"), true);
  assert.equal(shouldApplyPronunciationDict("MiniMax"), true);
  assert.equal(shouldApplyPronunciationDict("fishaudio"), true);
  assert.equal(shouldApplyPronunciationDict("Fish.Audio"), true);
  assert.equal(shouldApplyPronunciationDict(undefined), false);
});

test("converts Chinese to numbered pinyin", () => {
  const result = convertChineseToPinyin("你好");
  assert.match(result, /ni3/);
  assert.match(result, /hao3/);
});

test("maps pinyin-pro light tone 0 to tone 1", () => {
  const result = convertChineseToPinyin("叽叽喳喳");
  assert.equal(result, "ji1 ji1 zha1 zha1");
  assert.equal(convertChineseToPinyin("妈妈"), "ma1 ma1");
});

test("converts Japanese to spaced hiragana (not IPA)", async () => {
  assert.equal(await convertJapaneseToKana("病態メカニズム"), "びょうたい めかにずむ");
  assert.equal(
    await convertJapaneseToKana("居宅介護支援事業所"),
    "きょたく かいご しえん じぎょうしょ",
  );
  // Particles aren't merged into the preceding word
  assert.equal(await convertJapaneseToKana("今日は"), "きょう は");
});

test("parseKanaLineRewritesJson tolerates malformed input", () => {
  assert.deepEqual({ ...parseKanaLineRewritesJson(undefined) }, {});
  assert.deepEqual({ ...parseKanaLineRewritesJson("   ") }, {});
  assert.deepEqual({ ...parseKanaLineRewritesJson("{not json") }, {});
  assert.deepEqual({ ...parseKanaLineRewritesJson('["東京"]') }, {});
  assert.deepEqual(
    { ...parseKanaLineRewritesJson('{"東京":1,"大阪":" おおさか ","":"x","空":""}') },
    { 大阪: "おおさか" },
  );
});

test("parseKanaLineRewritesJson keeps a JSON __proto__ key as plain data", () => {
  const map = parseKanaLineRewritesJson('{"__proto__":"x","東京":"とうきょう"}');
  assert.equal(map["東京"], "とうきょう");
  assert.equal(Object.getPrototypeOf(map), null);
});

test("resolveKanaLineRewrite matches the trimmed line only", () => {
  const map = parseKanaLineRewritesJson('{"東京の天気":"とうきょうのてんき"}');
  assert.equal(resolveKanaLineRewrite("東京の天気", map), "とうきょうのてんき");
  assert.equal(resolveKanaLineRewrite("  東京の天気 ", map), "とうきょうのてんき");
  assert.equal(resolveKanaLineRewrite("大阪", map), undefined);
  assert.equal(resolveKanaLineRewrite("toString", map), undefined);
  assert.equal(resolveKanaLineRewrite("", map), undefined);
});

const jaEntry = (sourceText: string, pronunciation: string) => ({
  sourceText,
  language: "ja" as const,
  pronunciation,
  enabled: true,
});

test("digit boundary: an entry starting with a digit does not match inside a longer number", () => {
  const entries = [jaEntry("3日", "みっか")];
  assert.equal(applyJapaneseKanaReplacements("13日に会う", entries), "13日に会う");
  assert.equal(applyJapaneseKanaReplacements("3日に会う", entries), "みっかに会う");
  assert.equal(applyJapaneseKanaReplacements("第3日", entries), "第みっか");
});

test("digit boundary: an entry ending with a digit does not match when followed by a digit", () => {
  const entries = [jaEntry("第1", "だいいち")];
  assert.equal(applyJapaneseKanaReplacements("第12回", entries), "第12回");
  assert.equal(applyJapaneseKanaReplacements("第1回", entries), "だいいち回");
});

test("digit boundary: longer digit entries still win and 第1回 matches 1回", () => {
  const entries = [
    jaEntry("3日", "みっか"),
    jaEntry("13日", "じゅうさんにち"),
    jaEntry("1回", "いっかい"),
  ];
  assert.equal(
    applyJapaneseKanaReplacements("13日は第1回", entries),
    "じゅうさんにちは第いっかい",
  );
});

test("full-width digits match half-width entries; unmatched text keeps original characters", () => {
  const entries = [jaEntry("13日", "じゅうさんにち")];
  assert.equal(applyJapaneseKanaReplacements("１３日と２０日", entries), "じゅうさんにちと２０日");
  assert.equal(applyJapaneseKanaReplacements("１２３", []), "１２３");
  assert.equal(applyJapaneseKanaReplacements("１３日", [jaEntry("１３日", "じゅうさんにち")]), "じゅうさんにち");
  assert.equal(applyJapaneseKanaReplacements("13日", [jaEntry("１３日", "じゅうさんにち")]), "じゅうさんにち");
});

test("normalizePronunciationSourceKey folds digits and trims, keeps case (same as the trie path)", () => {
  assert.equal(normalizePronunciationSourceKey(" １３日 "), "13日");
  assert.equal(normalizePronunciationSourceKey("ABC"), "ABC");
  assert.equal(foldFullWidthDigits("０９x"), "09x");
});

test("half-width and full-width spellings of one source: the half-width entry wins regardless of order", () => {
  const halfFirst = [jaEntry("9月", "くがつ"), jaEntry("９月", "きゅうがつ")];
  const fullFirst = [jaEntry("９月", "きゅうがつ"), jaEntry("9月", "くがつ")];
  for (const entries of [halfFirst, fullFirst]) {
    assert.equal(applyJapaneseKanaReplacements("9月", entries), "くがつ");
    assert.equal(applyJapaneseKanaReplacements("９月", entries), "くがつ");
  }
  // Two full-width spellings only: the later one wins, as for any duplicate.
  assert.equal(
    applyJapaneseKanaReplacements("9月", [jaEntry("９月", "a"), jaEntry("９月", "b")]),
    "b",
  );
});

test("digit boundary spans a decimal point: 5日 does not fire inside 1.5日", () => {
  const entries = [jaEntry("5日", "いつか"), jaEntry("5時間", "ごじかん"), jaEntry("第1", "だいいち")];
  assert.equal(applyJapaneseKanaReplacements("1.5日かかります", entries), "1.5日かかります");
  assert.equal(applyJapaneseKanaReplacements("１．５日かかります", entries), "１．５日かかります");
  assert.equal(applyJapaneseKanaReplacements("2.5時間", entries), "2.5時間");
  assert.equal(applyJapaneseKanaReplacements("5日に会う", entries), "いつかに会う");
  assert.equal(applyJapaneseKanaReplacements("第1.5回", entries), "第1.5回");
  assert.equal(applyJapaneseKanaReplacements("第1回", entries), "だいいち回");
  // A trailing period is punctuation, not a decimal point.
  assert.equal(applyJapaneseKanaReplacements("第1.", entries), "だいいち.");
});

test("digit boundary spans a thousands separator: 100人 does not fire inside 1,100人", () => {
  const entries = [jaEntry("100人", "ひゃくにん"), jaEntry("3日", "みっか"), jaEntry("4日", "よっか")];
  assert.equal(applyJapaneseKanaReplacements("1,100人", entries), "1,100人");
  assert.equal(applyJapaneseKanaReplacements("１，１００人", entries), "１，１００人");
  assert.equal(applyJapaneseKanaReplacements("100人", entries), "ひゃくにん");
  assert.equal(applyJapaneseKanaReplacements("1,000人", entries), "1,000人");
  // Enumeration marks are not number separators: the last item keeps its counter reading.
  assert.equal(applyJapaneseKanaReplacements("3・4日", entries), "3・よっか");
  // A comma between digits is read as one number, so `2,3日` is left to auto conversion.
  assert.equal(applyJapaneseKanaReplacements("2,3日", entries), "2,3日");
});
