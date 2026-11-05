// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  allocateBillableTokenBreakdown,
  computeSettlementBillableTokens,
  extractAgentTurnTokenUsage,
  preauthCreditsForAgentTurn,
  resolveCreditsPreauthTokens,
} from './agent-turn-credits.ts';
import {
  isAgentCreditsConsumptionEnabled,
  resolveAgentCreditsServiceCode,
  resolveCreditsOrgId,
} from './ainobi-credits.ts';

/** Token fields read by extractAgentTurnTokenUsage; full SDK usage has many more required keys. */
type TestResultUsage = Partial<{
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}>;

function resultMessage(usage: TestResultUsage): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 2,
    result: 'ok',
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: usage as unknown as SDKResultMessage['usage'],
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-4000-8000-000000000001',
    session_id: 'sess-1',
  };
}

test('resolveAgentCreditsServiceCode reads AINOBI_MODEL_CREDITS_SERVICE_CODE', () => {
  const prev = process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = 'deepseek-v4-flash';
  delete process.env.AINOBI_CREDITS_DISABLED;
  try {
    assert.equal(resolveAgentCreditsServiceCode(), 'deepseek-v4-flash');
    assert.equal(isAgentCreditsConsumptionEnabled(), true);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = prev;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});

test('extractAgentTurnTokenUsage sums input, output, and cache tokens', () => {
  const usage = extractAgentTurnTokenUsage(
    resultMessage({
      input_tokens: 100,
      output_tokens: 40,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    }),
  );
  assert.equal(usage.totalTokens, 155);
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 40);
});

test('computeSettlementBillableTokens subtracts preauth and skips non-positive remainder', () => {
  const prevPreauth = process.env.AINOBI_CREDITS_PREAUTH_TOKENS;
  process.env.AINOBI_CREDITS_PREAUTH_TOKENS = '5000';
  try {
    assert.equal(resolveCreditsPreauthTokens(), 5000);
    assert.equal(computeSettlementBillableTokens(3000), null);
    assert.equal(computeSettlementBillableTokens(5000), null);
    assert.equal(computeSettlementBillableTokens(5001), 1);
    assert.equal(computeSettlementBillableTokens(12000), 7000);
  } finally {
    if (prevPreauth === undefined) {
      delete process.env.AINOBI_CREDITS_PREAUTH_TOKENS;
    } else {
      process.env.AINOBI_CREDITS_PREAUTH_TOKENS = prevPreauth;
    }
  }
});

test('allocateBillableTokenBreakdown splits incremental tokens by usage mix', () => {
  const usage = extractAgentTurnTokenUsage(
    resultMessage({
      input_tokens: 80_000,
      output_tokens: 19_873,
      cache_read_input_tokens: 5_000,
    }),
  );
  assert.equal(usage.totalTokens, 104_873);
  const breakdown = allocateBillableTokenBreakdown(usage, 99_873);
  assert.equal(
    breakdown.inputTokens + breakdown.outputTokens + breakdown.cacheTokens,
    99_873,
  );
  assert.ok(breakdown.inputTokens > 70_000);
  assert.ok(breakdown.outputTokens > 0 && breakdown.outputTokens < 99_873);
  assert.ok(breakdown.cacheTokens > 0);
});

test('resolveCreditsOrgId returns optional billing context', () => {
  assert.equal(resolveCreditsOrgId('cw-org-1'), 'cw-org-1');
  assert.equal(resolveCreditsOrgId('  cw-org-1  '), 'cw-org-1');
  assert.equal(resolveCreditsOrgId(null), undefined);
  assert.equal(resolveCreditsOrgId(undefined), undefined);
});

test('preauthCreditsForAgentTurn tags the consume body with usage_type=courseware', async () => {
  const prevService = process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  const prevFetch = globalThis.fetch;

  process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = 'deepseek-v4-flash';
  delete process.env.AINOBI_CREDITS_DISABLED;

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          service_code: 'deepseek-v4-flash',
          consumption_type: 'user',
          amount_unit: 'tokens',
          org_id: null,
          credits_consumed: '0.5',
          remaining_credits: '99.5',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const session = { accessToken: 'token-abc', userId: 'u1' } as AinobiAuthorizedSession;

  try {
    const outcome = await preauthCreditsForAgentTurn({
      session,
      conversationId: 'conv-1',
    });
    assert.equal(outcome?.ok, true);
    assert.equal(capturedBody?.service_code, 'deepseek-v4-flash');
    // Courseware agent turns always count toward the 'courseware' feature bucket
    assert.equal(capturedBody?.usage_type, 'courseware');
  } finally {
    globalThis.fetch = prevFetch;
    if (prevService === undefined) {
      delete process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = prevService;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});
