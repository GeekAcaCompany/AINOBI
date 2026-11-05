// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { countTtsTextCharacters } from './narration-tts-credits.ts';
import { mapTtsSynthesizeErrorStatus } from './courseware-tts-service.ts';
import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import type { AITeacherTtsSettings } from '@ainobi/courseware-cli/cli/ai-teachers.ts';
import {
  buildTtsSegments,
  synthesizeAndUploadTtsLine,
} from '@ainobi/courseware-cli/cli/tts.ts';

const stubTtsSettings: AITeacherTtsSettings = {
  provider: 'minimax',
  model: 'speech-2.8-hd',
  voice_id: 'voice-a',
  speed: 1,
  vol: 1,
  pitch: 0,
};

test('countTtsTextCharacters counts Unicode code points', () => {
  assert.equal(countTtsTextCharacters('你好\n世界'), 5);
  assert.equal(countTtsTextCharacters('   '), 0);
});

test('mapTtsSynthesizeErrorStatus maps CLI error codes', () => {
  assert.equal(mapTtsSynthesizeErrorStatus(new AinobiCliError('USAGE', 'bad')), 400);
  assert.equal(mapTtsSynthesizeErrorStatus(new AinobiCliError('NOT_FOUND', 'missing')), 404);
  assert.equal(mapTtsSynthesizeErrorStatus(new Error('You do not have access')), 403);
  assert.equal(mapTtsSynthesizeErrorStatus(new Error('upstream failed')), 502);
});

test('synthesizeAndUploadTtsLine applies only the explicitly passed pronunciation dict', async () => {
  const prevStub = process.env.AINOBI_TTS_STUB;
  const prevDict = process.env.AINOBI_TTS_PRONUNCIATION_DICT_FILE;
  const stale = '/tmp/stale/dict.json';
  process.env.AINOBI_TTS_STUB = '1';
  // A stale host-process value must be ignored: the dict is a per-request argument.
  process.env.AINOBI_TTS_PRONUNCIATION_DICT_FILE = stale;
  try {
    const withDict = await synthesizeAndUploadTtsLine({
      text: '東京の天気',
      settings: stubTtsSettings,
      pronunciationDict: [
        { sourceText: '東京', language: 'ja', pronunciation: 'とうきょう', enabled: true },
      ],
    });
    assert.equal(decodeURIComponent(withDict.object_key), 'stub/tts/とうきょうの天気.mp3');

    const withoutDict = await synthesizeAndUploadTtsLine({
      text: '東京の天気',
      settings: stubTtsSettings,
    });
    assert.equal(decodeURIComponent(withoutDict.object_key), 'stub/tts/東京の天気.mp3');

    assert.equal(process.env.AINOBI_TTS_PRONUNCIATION_DICT_FILE, stale);
  } finally {
    if (prevStub === undefined) {
      delete process.env.AINOBI_TTS_STUB;
    } else {
      process.env.AINOBI_TTS_STUB = prevStub;
    }
    if (prevDict === undefined) {
      delete process.env.AINOBI_TTS_PRONUNCIATION_DICT_FILE;
    } else {
      process.env.AINOBI_TTS_PRONUNCIATION_DICT_FILE = prevDict;
    }
  }
});

/** Set env keys for the duration of `fn`, restoring previous values afterwards. */
async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('synthesizeAndUploadTtsLine sends the host kana rewrite when provided', async () => {
  await withEnv({ AINOBI_TTS_STUB: '1' }, async () => {
    const result = await synthesizeAndUploadTtsLine({
      text: '東京の天気。',
      settings: stubTtsSettings,
      pronunciationDict: [
        { sourceText: '東京', language: 'ja', pronunciation: 'とうきょう', enabled: true },
      ],
      kanaRewrite: 'とうきょうのてんき',
    });
    assert.equal(decodeURIComponent(result.object_key), 'stub/tts/とうきょうのてんき.mp3');
  });
});

test('buildTtsSegments prefers the host kana line file and falls back to the dict file per line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ainobi-kana-lines-test-'));
  const file = join(dir, 'lines.json');
  await writeFile(file, JSON.stringify({ 東京の天気: 'とうきょうのてんき' }), 'utf8');
  const dictFile = join(dir, 'dict.json');
  await writeFile(
    dictFile,
    JSON.stringify([
      { sourceText: '東京', language: 'ja', pronunciation: 'とうきょう', enabled: true },
    ]),
    'utf8',
  );
  const stubUrlText = (audioUrl: string): string =>
    decodeURIComponent(audioUrl.split('/stub/tts/')[1]);
  try {
    await withEnv(
      {
        AINOBI_TTS_STUB: '1',
        AINOBI_TTS_PRONUNCIATION_DICT_FILE: dictFile,
        AINOBI_TTS_JA_KANA_LINES_FILE: file,
      },
      async () => {
        const built = await buildTtsSegments('東京の天気。\n東京タワー\nHello', {
          gapMs: 100,
          settings: stubTtsSettings,
        });
        assert.deepEqual(
          built.segments.map((segment) => segment.text),
          ['東京の天気', '東京タワー', 'Hello'],
        );
        assert.deepEqual(built.segments.map((segment) => stubUrlText(segment.audio_url)), [
          'とうきょうのてんき.mp3',
          'とうきょうタワー.mp3',
          'Hello.mp3',
        ]);
      },
    );

    // Unreadable map file → dictionary-only rewrite, never an error.
    await withEnv(
      {
        AINOBI_TTS_STUB: '1',
        AINOBI_TTS_PRONUNCIATION_DICT_FILE: dictFile,
        AINOBI_TTS_JA_KANA_LINES_FILE: join(dir, 'missing.json'),
      },
      async () => {
        const built = await buildTtsSegments('東京の天気。', {
          gapMs: 100,
          settings: stubTtsSettings,
        });
        assert.equal(stubUrlText(built.segments[0].audio_url), 'とうきょうの天気.mp3');
      },
    );

    // Unreadable dict file as well → original text, never an error.
    await withEnv(
      {
        AINOBI_TTS_STUB: '1',
        AINOBI_TTS_PRONUNCIATION_DICT_FILE: join(dir, 'missing-dict.json'),
        AINOBI_TTS_JA_KANA_LINES_FILE: join(dir, 'missing.json'),
      },
      async () => {
        const built = await buildTtsSegments('東京の天気。', {
          gapMs: 100,
          settings: stubTtsSettings,
        });
        assert.equal(stubUrlText(built.segments[0].audio_url), '東京の天気.mp3');
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
