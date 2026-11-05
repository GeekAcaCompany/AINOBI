// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AinobiCreditsConsumeError,
  consumeAinobiCreditsOnce,
  isAgentCreditsConsumptionEnabled,
  resolveAgentCreditsServiceCode,
  resolveCreditsConsumeUrl,
} from './ainobi-credits.ts';

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

test('resolveCreditsConsumeUrl uses AINOBI_BACKEND_API_BASE', () => {
  const prev = process.env.AINOBI_BACKEND_API_BASE;
  process.env.AINOBI_BACKEND_API_BASE = 'http://localhost:8000/v1';
  try {
    assert.equal(resolveCreditsConsumeUrl(), 'http://localhost:8000/v1/credits/consume');
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_BACKEND_API_BASE;
    } else {
      process.env.AINOBI_BACKEND_API_BASE = prev;
    }
  }
});

test('resolveCreditsConsumeUrl trims trailing slash on base', () => {
  const prev = process.env.AINOBI_BACKEND_API_BASE;
  process.env.AINOBI_BACKEND_API_BASE = 'https://custom.example/v1/';
  try {
    assert.equal(resolveCreditsConsumeUrl(), 'https://custom.example/v1/credits/consume');
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_BACKEND_API_BASE;
    } else {
      process.env.AINOBI_BACKEND_API_BASE = prev;
    }
  }
});

test('consumeAinobiCreditsOnce sends tokens amount_unit and maps response', async () => {
  const prevFetch = globalThis.fetch;
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
          credits_consumed: '0.46875',
          remaining_credits: '95',
          input_tokens: 0,
          output_tokens: 5000,
          cache_tokens: 0,
          service_id: '11111111-1111-1111-1111-111111111111',
          ledger_id: '22222222-2222-2222-2222-222222222222',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const result = await consumeAinobiCreditsOnce('token-abc', {
      serviceCode: 'deepseek-v4-flash',
      amount: '5000',
      amountUnit: 'tokens',
      content: 'Courseware agent test',
    });
    assert.equal(capturedBody?.service_code, 'deepseek-v4-flash');
    assert.equal(capturedBody?.consumption_type, undefined);
    assert.equal(capturedBody?.amount_unit, 'tokens');
    assert.equal(capturedBody?.amount, '5000');
    // usageType omitted → no usage_type field in the request body
    assert.equal(capturedBody?.usage_type, undefined);
    assert.equal('usage_type' in (capturedBody ?? {}), false);
    assert.equal(result.serviceCode, 'deepseek-v4-flash');
    assert.equal(result.amountUnit, 'tokens');
    assert.equal(result.creditsConsumed, '0.46875');
    assert.equal(result.outputTokens, 5000);
    assert.equal(result.ledgerId, '22222222-2222-2222-2222-222222222222');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('consumeAinobiCreditsOnce forwards usageType as usage_type and skips blank values', async () => {
  const prevFetch = globalThis.fetch;
  const capturedBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          service_code: 'deepseek-v4-flash',
          consumption_type: 'user',
          amount_unit: 'tokens',
          org_id: null,
          credits_consumed: '1',
          remaining_credits: '99',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    await consumeAinobiCreditsOnce('token-abc', {
      serviceCode: 'deepseek-v4-flash',
      amount: '5000',
      content: 'Tagged consume',
      usageType: ' courseware ',
    });
    // Trimmed feature tag lands in the POST body
    assert.equal(capturedBodies[0]?.usage_type, 'courseware');

    await consumeAinobiCreditsOnce('token-abc', {
      serviceCode: 'deepseek-v4-flash',
      amount: '5000',
      content: 'Blank usage type',
      usageType: '   ',
    });
    // Whitespace-only usageType is treated as absent
    assert.equal('usage_type' in (capturedBodies[1] ?? {}), false);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('consumeAinobiCreditsOnce throws on insufficient balance', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 422016,
        success: false,
        message: 'Insufficient credit balance',
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );

  try {
    await assert.rejects(
      () =>
        consumeAinobiCreditsOnce('token-abc', {
          serviceCode: 'deepseek-v4-flash',
          amount: '5000',
          content: 'Overdraw',
        }),
      (error: unknown) => {
        assert.ok(error instanceof AinobiCreditsConsumeError);
        assert.equal(error.status, 402);
        assert.match(error.message, /Insufficient/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('consumeAinobiCreditsOnce sends orgId as billing context only', async () => {
  const prevFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          service_code: 'deepseek-v4-flash',
          consumption_type: 'organization',
          amount_unit: 'tokens',
          org_id: 'org-1',
          credits_consumed: '1',
          remaining_credits: '9',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    await consumeAinobiCreditsOnce('token-abc', {
      serviceCode: 'deepseek-v4-flash',
      orgId: 'org-1',
      amount: '5000',
      content: 'Org context',
    });
    assert.equal(capturedBody?.org_id, 'org-1');
    assert.equal(capturedBody?.consumption_type, undefined);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
