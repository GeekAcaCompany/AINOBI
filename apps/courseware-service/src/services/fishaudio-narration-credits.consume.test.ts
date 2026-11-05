// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { billFishAudioNarrationCredits } from './fishaudio-narration-credits.ts';

test('billFishAudioNarrationCredits sends fishaudio-s2.1-pro count-based unit_count', async () => {
  const prevService = process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  const prevFetch = globalThis.fetch;

  process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE = 'fishaudio-s2.1-pro';
  delete process.env.AINOBI_CREDITS_DISABLED;

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          service_code: 'fishaudio-s2.1-pro',
          consumption_type: 'user',
          amount_unit: 'tokens',
          org_id: null,
          credits_consumed: '0.05',
          remaining_credits: '10',
          input_tokens: 0,
          output_tokens: 0,
          cache_tokens: 0,
          service_id: '11111111-1111-1111-1111-111111111111',
          ledger_id: '22222222-2222-2222-2222-222222222222',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const session = { accessToken: 'token-abc', userId: 'u1' } as AinobiAuthorizedSession;

  try {
    const outcome = await billFishAudioNarrationCredits({
      session,
      argv: ['narration', 'insert', '0', '--transcript', '你好'],
    });
    assert.equal(outcome?.kind, 'charged');
    assert.equal(outcome?.provider, 'fishaudio');
    assert.equal(capturedBody?.service_code, 'fishaudio-s2.1-pro');
    assert.equal(capturedBody?.unit_count, 2);
    assert.equal(capturedBody?.usage_type, 'voice');
    assert.match(String(capturedBody?.content), /Fish Audio TTS/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevService === undefined) {
      delete process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE = prevService;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});

test('billFishAudioNarrationCredits returns null when fishaudio service code is not configured', async () => {
  const prevMinimax = process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE;
  const prevFish = process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  const prevFetch = globalThis.fetch;

  process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE = 'speech-2.8-hd';
  delete process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE;
  delete process.env.AINOBI_CREDITS_DISABLED;

  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 500 });
  };

  const session = { accessToken: 'token-abc', userId: 'u1' } as AinobiAuthorizedSession;

  try {
    const outcome = await billFishAudioNarrationCredits({
      session,
      argv: ['narration', 'insert', '0', '--transcript', '你好'],
    });
    assert.equal(outcome, null);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevMinimax === undefined) {
      delete process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE = prevMinimax;
    }
    if (prevFish === undefined) {
      delete process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE = prevFish;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});
