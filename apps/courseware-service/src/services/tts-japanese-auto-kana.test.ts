// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildJapaneseKanaLineRewrites,
  isJapaneseNarrationLanguage,
  resolveNarrationJaKanaLinesJson,
  resolveNarrationJaKanaLinesJsonForJob,
  resolveNarrationLanguagesForJob,
  rewriteJapaneseTextToKanaForTts,
  spaceJapaneseNumberSpansForTts,
} from './tts-japanese-auto-kana.ts';
import type { PronunciationDictEntry } from './tts-pronunciation-apply.ts';

const nihonDict: PronunciationDictEntry[] = [
  { sourceText: '日本', language: 'ja', pronunciation: 'にほん', enabled: true },
];

/** Deterministic stand-in for kuroshiro: only rewrites 漢 so tests do not depend on IPADic readings. */
const fakeConvert = async (text: string): Promise<string> => text.replace(/漢/g, 'かん');

test('isJapaneseNarrationLanguage: teacher or catalog voice language is ja', () => {
  assert.equal(isJapaneseNarrationLanguage('ja'), true);
  assert.equal(isJapaneseNarrationLanguage('ja-JP'), true);
  assert.equal(isJapaneseNarrationLanguage('Japanese'), true);
  assert.equal(isJapaneseNarrationLanguage('zh', 'ja'), true);
  assert.equal(isJapaneseNarrationLanguage('zh'), false);
  assert.equal(isJapaneseNarrationLanguage(undefined, undefined), false);
  assert.equal(isJapaneseNarrationLanguage('zh', 'en-US'), false);
});

const KANJI_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

// Real kuroshiro smoke test: structural checks only, so IPADic reading changes do not break it.
test('rewriteJapaneseTextToKanaForTts: real converter leaves no kanji, keeps katakana, no spaces', async () => {
  const out = await rewriteJapaneseTextToKanaForTts('コンピュータの説明をします。', []);
  assert.doesNotMatch(out, KANJI_RE);
  assert.match(out, /^コンピュータの/);
  assert.doesNotMatch(out, /\s/);
  assert.match(out, /。$/);
});

test('rewriteJapaneseTextToKanaForTts: dictionary reading wins and stays intact', async () => {
  const out = await rewriteJapaneseTextToKanaForTts('日本の説明', nihonDict);
  assert.match(out, /^にほんの/);
  assert.doesNotMatch(out, KANJI_RE);
});

test('rewriteJapaneseTextToKanaForTts: latin, digits and empty text are unchanged', async () => {
  assert.equal(await rewriteJapaneseTextToKanaForTts('Hello 123', []), 'Hello 123');
  assert.equal(await rewriteJapaneseTextToKanaForTts('', []), '');
});

test('rewriteJapaneseTextToKanaForTts: converter failure falls back to dictionary-only text', async () => {
  const failing = async (): Promise<string> => {
    throw new Error('kuromoji init failed');
  };
  const out = await rewriteJapaneseTextToKanaForTts('日本の説明', nihonDict, failing);
  assert.equal(out, 'にほんの説明');
});

test('buildJapaneseKanaLineRewrites: keys are CLI-trimmed lines, unchanged lines omitted', async () => {
  const map = await buildJapaneseKanaLineRewrites('。漢字。\n\nHello\n漢字。', [], fakeConvert);
  assert.deepEqual({ ...map }, { 漢字: 'かん字' });
});

test('resolveNarrationJaKanaLinesJson: provider / language gating and argv source', async () => {
  const base = { entries: [], convert: fakeConvert };
  const transcriptArgv = ['narration', 'insert', '0', '--transcript', '漢字'];

  assert.equal(
    await resolveNarrationJaKanaLinesJson({
      ...base,
      argv: transcriptArgv,
      teacherLanguage: 'ja',
      ttsProvider: 'openai',
    }),
    undefined,
  );
  assert.equal(
    await resolveNarrationJaKanaLinesJson({
      ...base,
      argv: transcriptArgv,
      teacherLanguage: 'zh',
      ttsProvider: 'minimax',
    }),
    undefined,
  );
  assert.equal(
    await resolveNarrationJaKanaLinesJson({
      ...base,
      argv: ['narration', 'insert', '0', '--transcript', 'Hello'],
      teacherLanguage: 'ja',
      ttsProvider: 'minimax',
    }),
    null,
  );
  // --script is the TTS source when --transcript is absent (same rule as the CLI).
  assert.equal(
    await resolveNarrationJaKanaLinesJson({
      ...base,
      argv: ['narration', 'insert', '0', '--script', '漢字'],
      voiceLanguage: 'ja-JP',
      ttsProvider: 'fishaudio',
    }),
    JSON.stringify({ 漢字: 'かん字' }),
  );
  // Literal `\n` escapes in argv are decoded exactly like the CLI does before splitting.
  assert.equal(
    await resolveNarrationJaKanaLinesJson({
      ...base,
      argv: ['narration', 'insert', '0', '--transcript', '漢字\\n漢'],
      teacherLanguage: 'Japanese',
      ttsProvider: 'minimax',
    }),
    JSON.stringify({ 漢字: 'かん字', 漢: 'かん' }),
  );
});

test('resolveNarrationLanguagesForJob: japanese comes from the session catalog, false when unreadable', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'ainobi-auto-kana-lang-'));
  const sessionId = 'ainobi-test-session-auto-kana';
  const jaTeacher = '33333333-3333-4333-8333-333333333333';
  const zhTeacher = '55555555-5555-4555-8555-555555555555';
  await writeFile(
    join(stateDir, `${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      ai_teachers: [
        {
          ai_teacher_id: jaTeacher,
          ai_teacher_name: 'Sensei',
          ai_teacher_tts_provider: 'minimax',
          ai_teacher_language: 'ja',
        },
        {
          ai_teacher_id: zhTeacher,
          ai_teacher_name: 'Laoshi',
          ai_teacher_tts_provider: 'minimax',
          ai_teacher_language: 'zh',
        },
      ],
      tts_voices: [],
    }),
  );
  const argvFor = (teacherId: string) => [
    'narration',
    'insert',
    '0',
    '--teacher-id',
    teacherId,
    '--transcript',
    '9月3日',
  ];

  const ja = await resolveNarrationLanguagesForJob({ stateDir, sessionId, argv: argvFor(jaTeacher) });
  assert.equal(ja.japanese, true);
  assert.equal(ja.teacherLanguage, 'ja');

  const zh = await resolveNarrationLanguagesForJob({ stateDir, sessionId, argv: argvFor(zhTeacher) });
  assert.equal(zh.japanese, false);
  assert.equal(zh.teacherLanguage, 'zh');

  // No catalog on disk: not Japanese (org dict only, no platform dict, no kana map).
  const missing = await resolveNarrationLanguagesForJob({
    stateDir: join(stateDir, 'missing'),
    sessionId,
    argv: argvFor(jaTeacher),
  });
  assert.equal(missing.japanese, false);
});

test('resolveNarrationJaKanaLinesJsonForJob: kana map only for Japanese jobs on dict providers', async () => {
  const argv = ['narration', 'insert', '0', '--transcript', '日本'];
  const pronunciationDictJson = JSON.stringify(nihonDict);
  assert.equal(
    await resolveNarrationJaKanaLinesJsonForJob({
      argv,
      ttsProvider: 'minimax',
      languages: { teacherLanguage: 'zh', japanese: false },
      pronunciationDictJson,
    }),
    undefined,
  );
  assert.equal(
    await resolveNarrationJaKanaLinesJsonForJob({
      argv,
      ttsProvider: 'openai',
      languages: { teacherLanguage: 'ja', japanese: true },
      pronunciationDictJson,
    }),
    undefined,
  );
  assert.equal(
    await resolveNarrationJaKanaLinesJsonForJob({
      argv,
      ttsProvider: 'minimax',
      languages: { teacherLanguage: 'ja', japanese: true },
      pronunciationDictJson,
    }),
    JSON.stringify({ 日本: 'にほん' }),
  );
});

test('spaceJapaneseNumberSpansForTts: spaces around dates / counters, not next to punctuation', () => {
  const cases: Array<[string, string]> = [
    ['4月1日から30日までの', '4月1日 から 30日 までの'],
    ['2026年4月1日に開始します。', '2026年4月1日 に開始します。'],
    ['毎日3回、1時間30分ずつ練習', '毎日 3回、1時間30分 ずつ練習'],
    ['3日目の授業', '3日目 の授業'],
    ['第1問。次の会話', '第1問。次の会話'],
    ['（4月1日）から', '（4月1日）から'],
    ['データを25%削減', 'データを 25% 削減'],
    ['GPT4oとN2', 'GPT4oとN2'],
    ['4月1日 から', '4月1日 から'],
    ['', ''],
  ];
  for (const [input, expected] of cases) {
    assert.equal(spaceJapaneseNumberSpansForTts(input), expected, input);
  }
});

test('rewriteJapaneseTextToKanaForTts spaces number spans before dictionary + kana', async () => {
  const kana = await rewriteJapaneseTextToKanaForTts(
    '4月1日から30日までの',
    [{ sourceText: '4月1日', language: 'ja', pronunciation: 'しがつついたち', enabled: true }],
    async (text) => text,
  );
  assert.equal(kana, 'しがつついたち から 30日 までの');
});

test('dictionary entries spanning a number boundary still win after TTS spacing', async () => {
  const entries: PronunciationDictEntry[] = [
    { sourceText: '令和6年', language: 'ja', pronunciation: 'れいわろくねん', enabled: true },
    { sourceText: '4月1日から', language: 'ja', pronunciation: 'しがつついたちから', enabled: true },
  ];
  const identity = async (text: string) => text;
  assert.equal(await rewriteJapaneseTextToKanaForTts('令和6年に施行', entries, identity), 'れいわろくねん に施行');
  assert.equal(await rewriteJapaneseTextToKanaForTts('4月1日から開始', entries, identity), 'しがつついたちから開始');
});
