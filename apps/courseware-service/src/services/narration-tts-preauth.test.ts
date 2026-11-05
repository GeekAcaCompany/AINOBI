// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  patchSessionNarrationCatalogs,
  resolveNarrationTtsLanguagesForPreauth,
  resolveNarrationTtsProviderForPreauth,
} from './narration-tts-preauth.ts';

test('resolveNarrationTtsProviderForPreauth reads fishaudio teacher from session', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'ainobi-tts-preauth-'));
  const sessionId = 'ainobi-test-session';
  await writeFile(
    join(stateDir, `${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      ai_teachers: [
        {
          ai_teacher_id: '11111111-1111-4111-8111-111111111111',
          ai_teacher_name: 'Fish',
          ai_teacher_tts_provider: 'fishaudio',
          runtime: 'live2d',
          model_url: 'https://example.com/model.json',
          ai_teacher_avatar_url: 'https://example.com/a.png',
          ai_teacher_live2d_model_url: 'https://example.com/model.json',
          ai_teacher_live2d_model_image_url: 'https://example.com/a.png',
        },
      ],
    }),
  );

  const provider = await resolveNarrationTtsProviderForPreauth({
    stateDir,
    sessionId,
    argv: [
      'narration',
      'insert',
      '0',
      '--teacher-id',
      '11111111-1111-4111-8111-111111111111',
      '--transcript',
      '你好',
    ],
  });
  assert.equal(provider, 'fishaudio');
});

test('resolveNarrationTtsProviderForPreauth prefers --tts-id voice provider', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'ainobi-tts-preauth-'));
  const sessionId = 'ainobi-test-session-voice';
  await writeFile(
    join(stateDir, `${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      ai_teachers: [
        {
          ai_teacher_id: '22222222-2222-4222-8222-222222222222',
          ai_teacher_name: 'Mini',
          ai_teacher_tts_provider: 'minimax',
          runtime: 'live2d',
          model_url: 'https://example.com/model.json',
          ai_teacher_avatar_url: 'https://example.com/a.png',
          ai_teacher_live2d_model_url: 'https://example.com/model.json',
          ai_teacher_live2d_model_image_url: 'https://example.com/a.png',
        },
      ],
      tts_voices: [
        {
          tts_id: '33333333-3333-4333-8333-333333333333',
          tts_name: 'Fish Voice',
          tts_provider: 'fishaudio',
          tts_model: 's1',
          tts_voice: 'voice-a',
        },
      ],
    }),
  );

  const provider = await resolveNarrationTtsProviderForPreauth({
    stateDir,
    sessionId,
    argv: [
      'narration',
      'insert',
      '0',
      '--teacher-id',
      '22222222-2222-4222-8222-222222222222',
      '--tts-id',
      '33333333-3333-4333-8333-333333333333',
      '--transcript',
      'hi',
    ],
  });
  assert.equal(provider, 'fishaudio');
});

test('resolveNarrationTtsProviderForPreauth falls back to google without catalog', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'ainobi-tts-preauth-'));
  await mkdir(join(stateDir, '.current'), { recursive: true });
  const provider = await resolveNarrationTtsProviderForPreauth({
    stateDir,
    argv: ['narration', 'insert', '0', '--transcript', 'hi'],
  });
  assert.equal(provider, 'google');
});

test('patchSessionNarrationCatalogs writes teachers and voices', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'ainobi-tts-patch-'));
  const sessionId = 'ainobi-patch-session';
  await writeFile(
    join(stateDir, `${sessionId}.json`),
    JSON.stringify({ session_id: sessionId, scene: { name: 'x' } }),
  );
  const ok = await patchSessionNarrationCatalogs({
    stateDir,
    sessionId,
    aiTeachers: [{ ai_teacher_id: 't1', ai_teacher_tts_provider: 'fishaudio' }],
    ttsVoices: [{ tts_id: 'v1', tts_provider: 'fishaudio', tts_voice: 'x' }],
  });
  assert.equal(ok, true);
  const saved = JSON.parse(await readFile(join(stateDir, `${sessionId}.json`), 'utf8'));
  assert.equal(saved.ai_teachers[0].ai_teacher_id, 't1');
  assert.equal(saved.tts_voices[0].tts_voice, 'x');
});

test('resolveNarrationTtsLanguagesForPreauth reads teacher and --tts-id voice languages', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'ainobi-tts-preauth-lang-'));
  const sessionId = 'ainobi-test-session-lang';
  const teacherId = '33333333-3333-4333-8333-333333333333';
  const voiceId = '44444444-4444-4444-8444-444444444444';
  await writeFile(
    join(stateDir, `${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      ai_teachers: [
        {
          ai_teacher_id: teacherId,
          ai_teacher_name: 'Sensei',
          ai_teacher_tts_provider: 'minimax',
          ai_teacher_language: 'ja',
        },
      ],
      tts_voices: [
        {
          tts_id: voiceId,
          tts_name: 'Voice',
          tts_provider: 'fishaudio',
          tts_model: 's1',
          tts_voice: 'ref-1',
          tts_language: 'ja-JP',
        },
      ],
    }),
  );

  const teacherOnly = await resolveNarrationTtsLanguagesForPreauth({
    stateDir,
    sessionId,
    argv: ['narration', 'insert', '0', '--teacher-id', teacherId, '--transcript', '漢字'],
  });
  assert.deepEqual(teacherOnly, { teacherLanguage: 'ja' });

  const withVoice = await resolveNarrationTtsLanguagesForPreauth({
    stateDir,
    sessionId,
    argv: [
      'narration',
      'insert',
      '0',
      '--teacher-id',
      teacherId,
      '--tts-id',
      voiceId,
      '--transcript',
      '漢字',
    ],
  });
  assert.deepEqual(withVoice, { teacherLanguage: 'ja', voiceLanguage: 'ja-JP' });

  const unknownIds = await resolveNarrationTtsLanguagesForPreauth({
    stateDir,
    sessionId,
    argv: ['narration', 'insert', '0', '--teacher-id', 'nope', '--tts-id', 'nope'],
  });
  assert.deepEqual(unknownIds, {});
});

test('resolveNarrationTtsLanguagesForPreauth returns an empty result without a catalog', async () => {
  const languages = await resolveNarrationTtsLanguagesForPreauth({
    stateDir: join(tmpdir(), 'ainobi-tts-preauth-missing-dir'),
    sessionId: 'missing',
    argv: ['narration', 'insert', '0', '--teacher-id', 'x'],
  });
  assert.deepEqual(languages, {});
});
