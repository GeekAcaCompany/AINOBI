// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countNarrationTtsCharacters,
  findBlockedNarrationCatalogFileFlag,
  normalizeNarrationTtsProvider,
  resolveNarrationTtsBillingFailureResponse,
  resolveNarrationTtsProviderFromHostStdout,
  resolveNarrationTtsSourceFromArgv,
} from './narration-tts-credits.ts';

test('countNarrationTtsCharacters prefers --transcript over --script', () => {
  const argv = [
    'narration',
    'insert',
    '0',
    '--script',
    '脚本',
    '--transcript',
    '你好\n世界',
  ];
  assert.equal(resolveNarrationTtsSourceFromArgv(argv), '你好\n世界');
  assert.equal(countNarrationTtsCharacters(argv), 5);
});

test('countNarrationTtsCharacters falls back to --script', () => {
  const argv = ['narration', 'insert', '1', '--script', '仅脚本'];
  assert.equal(countNarrationTtsCharacters(argv), 3);
});

test('normalizeNarrationTtsProvider accepts fishaudio aliases', () => {
  assert.equal(normalizeNarrationTtsProvider('fishaudio'), 'fishaudio');
  assert.equal(normalizeNarrationTtsProvider('Fish.Audio'), 'fishaudio');
  assert.equal(normalizeNarrationTtsProvider('minimax'), 'minimax');
  assert.equal(normalizeNarrationTtsProvider('google'), 'google');
  assert.equal(normalizeNarrationTtsProvider(undefined), 'google');
  assert.equal(normalizeNarrationTtsProvider('unknown'), 'google');
});

test('resolveNarrationTtsProviderFromHostStdout reads data.tts_provider', () => {
  const stdout = JSON.stringify({
    ok: true,
    data: { tts_provider: 'fishaudio', tts_segments: 1 },
  });
  assert.equal(resolveNarrationTtsProviderFromHostStdout(stdout), 'fishaudio');
  assert.equal(resolveNarrationTtsProviderFromHostStdout('not json'), null);
});

test('resolveNarrationTtsBillingFailureResponse blocks success payload', () => {
  const withStatus = resolveNarrationTtsBillingFailureResponse({
    kind: 'failed',
    error: 'insufficient credit balance',
    status: 402,
    characterCount: 12,
    provider: 'minimax',
  });
  assert.equal(withStatus.status, 402);
  assert.deepEqual(withStatus.body, {
    ok: false,
    error: 'insufficient credit balance',
    creditsTtsError: 'insufficient credit balance',
  });

  const withoutStatus = resolveNarrationTtsBillingFailureResponse({
    kind: 'failed',
    error: 'credits upstream timeout',
    characterCount: 3,
    provider: 'fishaudio',
  });
  assert.equal(withoutStatus.status, 503);
  assert.equal(withoutStatus.body.ok, false);
  assert.equal(withoutStatus.body.error, 'credits upstream timeout');
});

test('findBlockedNarrationCatalogFileFlag catches catalog-file flags in both argv forms', () => {
  const base = ['narration', 'insert', '0', '--teacher-id', 't1', '--transcript', 'こんにちは'];
  assert.equal(findBlockedNarrationCatalogFileFlag(base), null);
  assert.equal(findBlockedNarrationCatalogFileFlag([...base, '--teacher-file', 'x.json']), '--teacher-file');
  assert.equal(findBlockedNarrationCatalogFileFlag([...base, '--teachers=x.json']), '--teachers');
  assert.equal(findBlockedNarrationCatalogFileFlag([...base, '--TTS-File=x.json']), '--tts-file');
});
