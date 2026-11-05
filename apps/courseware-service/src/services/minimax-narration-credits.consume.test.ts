// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { billMinimaxNarrationCredits } from './minimax-narration-credits.ts';

test('billMinimaxNarrationCredits sends speech-2.8-hd count-based unit_count', async () => {
  const prevService = process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  const prevFetch = globalThis.fetch;

  process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE = 'speech-2.8-hd';
  delete process.env.AINOBI_CREDITS_DISABLED;

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          service_code: 'speech-2.8-hd',
          consumption_type: 'user',
          amount_unit: 'tokens',
          org_id: null,
          credits_consumed: '0.09375',
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
    const outcome = await billMinimaxNarrationCredits({
      session,
      argv: ['narration', 'insert', '0', '--transcript', '你好'],
    });
    assert.equal(outcome?.kind, 'charged');
    assert.equal(outcome?.provider, 'minimax');
    assert.equal(capturedBody?.service_code, 'speech-2.8-hd');
    assert.equal(capturedBody?.amount, '2');
    assert.equal(capturedBody?.unit_count, 2);
    assert.equal(capturedBody?.count, 1);
    assert.equal(capturedBody?.usage_type, 'voice');
    assert.equal(capturedBody?.input_tokens, undefined);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevService === undefined) {
      delete process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE = prevService;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});
