// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AinobiCreditsConsumeError, consumeCreditsOnce } from './credits.ts';

const URL = 'http://backend.test/v1/credits/consume';

function mockFetch(status: number, payload: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), { status });
  });
  return calls;
}

describe('consumeCreditsOnce', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the platform body and maps the result', async () => {
    const calls = mockFetch(200, {
      code: 0,
      success: true,
      data: { service_code: 'tavily-search', consumption_type: 'organization', org_id: 'o1', credits_consumed: 2 },
    });
    const result = await consumeCreditsOnce(URL, ' tok ', {
      serviceCode: ' tavily-search ',
      amount: 1,
      content: ' search ',
      orgId: 'o1',
      count: 1.9,
      idempotencyKey: 'k1',
      usageType: 'chat',
    });
    expect(calls[0]?.url).toBe(URL);
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      service_code: 'tavily-search',
      amount_unit: 'tokens',
      amount: '1',
      content: 'search',
      org_id: 'o1',
      idempotency_key: 'k1',
      usage_type: 'chat',
      count: 1,
    });
    expect(result).toMatchObject({ serviceCode: 'tavily-search', consumptionType: 'organization', creditsConsumed: '2' });
  });

  it('surfaces platform rejections with status and code', async () => {
    mockFetch(402, { code: 422016, success: false, message: 'Insufficient asset balance' });
    const error = await consumeCreditsOnce(URL, 't', { serviceCode: 's', amount: '5', content: 'c' }).catch((e) => e);
    expect(error).toBeInstanceOf(AinobiCreditsConsumeError);
    expect(error).toMatchObject({ status: 402, code: 422016, message: 'Insufficient asset balance' });
  });

  it('validates before calling the platform', async () => {
    const calls = mockFetch(200, {});
    await expect(consumeCreditsOnce(URL, ' ', { serviceCode: 's', amount: 1, content: 'c' })).rejects.toMatchObject({ status: 401 });
    await expect(consumeCreditsOnce(URL, 't', { serviceCode: 's', amount: 0, content: 'c' })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
});
