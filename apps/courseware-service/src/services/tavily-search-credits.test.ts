// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  DEFAULT_TAVILY_CREDITS_SERVICE_CODE,
  isTavilyCreditsConsumptionEnabled,
  normalizeAinobiServiceCode,
  resolveTavilyCreditsServiceCode,
} from './ainobi-credits.ts';
import { billTavilySearchCredits, TAVILY_SEARCH_BILLABLE_COUNT } from './tavily-search-credits.ts';

test('resolveTavilyCreditsServiceCode reads AINOBI_TAVILY_CREDITS_SERVICE_CODE', () => {
  const prev = process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE = DEFAULT_TAVILY_CREDITS_SERVICE_CODE;
  delete process.env.AINOBI_CREDITS_DISABLED;
  try {
    assert.equal(resolveTavilyCreditsServiceCode(), 'tavily-search');
    assert.equal(
      normalizeAinobiServiceCode(DEFAULT_TAVILY_CREDITS_SERVICE_CODE),
      'tavily-search',
    );
    assert.equal(isTavilyCreditsConsumptionEnabled(), true);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE = prev;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});

test('billTavilySearchCredits sends tavily-search count-based amount and count', async () => {
  const prevService = process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  const prevFetch = globalThis.fetch;

  process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE = 'tavily-search';
  delete process.env.AINOBI_CREDITS_DISABLED;

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          service_code: 'tavily-search',
          consumption_type: 'user',
          amount_unit: 'tokens',
          org_id: null,
          credits_consumed: '1',
          remaining_credits: '99',
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
    const outcome = await billTavilySearchCredits({
      session,
      query: 'who is Leo Messi?',
    });
    assert.equal(outcome?.kind, 'charged');
    assert.equal(capturedBody?.service_code, 'tavily-search');
    assert.equal(capturedBody?.amount, String(TAVILY_SEARCH_BILLABLE_COUNT));
    assert.equal(capturedBody?.unit_count, TAVILY_SEARCH_BILLABLE_COUNT);
    assert.equal(capturedBody?.count, TAVILY_SEARCH_BILLABLE_COUNT);
    assert.equal(capturedBody?.usage_type, 'courseware');
    assert.match(String(capturedBody?.content), /Tavily search/i);
    assert.match(String(capturedBody?.content), /Leo Messi/i);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevService === undefined) {
      delete process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE = prevService;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});
