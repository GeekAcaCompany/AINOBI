// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  DEFAULT_GOOGLE_TTS_CREDITS_SERVICE_CODE,
  isGoogleTtsCreditsConsumptionEnabled,
  resolveGoogleTtsCreditsServiceCode,
} from './ainobi-credits.ts';
import { billGoogleNarrationCredits } from './google-narration-credits.ts';
import { billNarrationTtsCredits } from './narration-tts-billing.ts';

const withEnv = async (
  values: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> => {
  const prev = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const consumeResponse = (serviceCode: string): Response =>
  new Response(
    JSON.stringify({
      code: 0,
      success: true,
      data: {
        service_code: serviceCode,
        consumption_type: 'user',
        amount_unit: 'tokens',
        org_id: null,
        credits_consumed: '0.01',
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

test('Google TTS billing defaults to gemini-3.8-flash-tts and is on unless credits are disabled', async () => {
  await withEnv(
    { AINOBI_GOOGLE_TTS_CREDITS_SERVICE_CODE: undefined, AINOBI_CREDITS_DISABLED: undefined },
    () => {
      assert.equal(resolveGoogleTtsCreditsServiceCode(), DEFAULT_GOOGLE_TTS_CREDITS_SERVICE_CODE);
      assert.equal(DEFAULT_GOOGLE_TTS_CREDITS_SERVICE_CODE, 'gemini-3.8-flash-tts');
      assert.equal(isGoogleTtsCreditsConsumptionEnabled(), true);
    },
  );
  await withEnv({ AINOBI_CREDITS_DISABLED: 'true' }, () => {
    assert.equal(isGoogleTtsCreditsConsumptionEnabled(), false);
  });
});

test('billGoogleNarrationCredits sends count-based unit_count with the Google code', async () => {
  const prevFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return consumeResponse('gemini-3.8-flash-tts');
  };
  const session = { accessToken: 'token-abc', userId: 'u1' } as AinobiAuthorizedSession;
  try {
    await withEnv(
      { AINOBI_GOOGLE_TTS_CREDITS_SERVICE_CODE: undefined, AINOBI_CREDITS_DISABLED: undefined },
      async () => {
        const outcome = await billGoogleNarrationCredits({
          session,
          argv: ['narration', 'insert', '0', '--transcript', '你好'],
        });
        assert.equal(outcome?.kind, 'charged');
        assert.equal(outcome?.provider, 'google');
        assert.equal(capturedBody?.service_code, 'gemini-3.8-flash-tts');
        assert.equal(capturedBody?.amount, '2');
        assert.equal(capturedBody?.unit_count, 2);
        assert.equal(capturedBody?.usage_type, 'voice');
        assert.match(String(capturedBody?.content), /Google TTS/);
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('billNarrationTtsCredits routes each provider to its billing code', async () => {
  const prevFetch = globalThis.fetch;
  const codes: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    codes.push(body.service_code);
    return consumeResponse(String(body.service_code));
  };
  const session = { accessToken: 'token-abc', userId: 'u1' } as AinobiAuthorizedSession;
  try {
    await withEnv(
      {
        AINOBI_GOOGLE_TTS_CREDITS_SERVICE_CODE: undefined,
        AINOBI_MINIMAX_CREDITS_SERVICE_CODE: 'speech-2.8-hd',
        AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE: 'fishaudio-s2.1-pro',
        AINOBI_CREDITS_DISABLED: undefined,
      },
      async () => {
        for (const provider of ['google', 'minimax', 'fishaudio'] as const) {
          const outcome = await billNarrationTtsCredits(provider, { session, characterCount: 3 });
          assert.equal(outcome?.provider, provider);
        }
      },
    );
    assert.deepEqual(codes, ['gemini-3.8-flash-tts', 'speech-2.8-hd', 'fishaudio-s2.1-pro']);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
