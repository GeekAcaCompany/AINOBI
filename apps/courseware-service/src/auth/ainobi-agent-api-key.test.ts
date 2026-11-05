// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AINOBI_AGENT_API_KEY_PREFIX,
  agentHandoffTokenMinutes,
  exchangeAgentApiKeyForHandoffAccessToken,
  invalidateCachedAgentHandoffToken,
  isAinobiAgentApiKey,
  parseAgentTokenResponse,
  redactAinobiAgentApiKey,
  resolveBearerToAccessToken,
} from './ainobi-agent-api-key.ts';

test('isAinobiAgentApiKey matches education prefix only', () => {
  assert.equal(isAinobiAgentApiKey(`${AINOBI_AGENT_API_KEY_PREFIX}abc_secret`), true);
  assert.equal(isAinobiAgentApiKey('  ainobi_ak_x  '), true);
  assert.equal(isAinobiAgentApiKey('user-access-token'), false);
  assert.equal(isAinobiAgentApiKey(''), false);
  assert.equal(isAinobiAgentApiKey(null), false);
});

test('redactAinobiAgentApiKey never returns the full secret', () => {
  const key = 'ainobi_ak_0123456789abcdef_super_secret_value_zzzz';
  const redacted = redactAinobiAgentApiKey(key);
  assert.equal(redacted.includes('super_secret'), false);
  assert.equal(redacted.startsWith(AINOBI_AGENT_API_KEY_PREFIX), true);
  assert.match(redacted, /…/);
});

test('resolveBearerToAccessToken passes through non-api-key bearers', async () => {
  const token = await resolveBearerToAccessToken('plain-access-token');
  assert.equal(token, 'plain-access-token');
});

test('parseAgentTokenResponse accepts unwrapped education AgentTokenResponse', () => {
  const parsed = parseAgentTokenResponse({
    access_token: ' tok ',
    expires_in: 3600,
    agent_user_id: 'a1',
  });
  assert.deepEqual(parsed, { accessToken: 'tok', expiresIn: 3600 });
});

test('parseAgentTokenResponse accepts SuccessWrapped { data } envelope', () => {
  const parsed = parseAgentTokenResponse({
    code: 0,
    success: true,
    data: { access_token: 'wrapped', expires_in: 1800 },
  });
  assert.deepEqual(parsed, { accessToken: 'wrapped', expiresIn: 1800 });
});

test('parseAgentTokenResponse defaults expires_in and rejects empty token', () => {
  assert.equal(parseAgentTokenResponse({ access_token: 'x' })?.expiresIn, 3600);
  assert.equal(parseAgentTokenResponse({ access_token: '  ' }), null);
  assert.equal(parseAgentTokenResponse({ data: {} }), null);
  assert.equal(parseAgentTokenResponse(null), null);
});

test('agentHandoffTokenMinutes defaults to the human cycle (7 days)', () => {
  const prev = process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES;
  delete process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES;
  try {
    assert.equal(agentHandoffTokenMinutes(), 10080);
  } finally {
    if (prev !== undefined) process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES = prev;
  }
});

test('agentHandoffTokenMinutes floors invalid env overrides to the default', () => {
  const prev = process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES;
  process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES = '-3';
  try {
    assert.equal(agentHandoffTokenMinutes(), 10080);
  } finally {
    if (prev !== undefined) process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES = prev;
    else delete process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES;
  }
});

test('exchangeAgentApiKeyForHandoffAccessToken passes expires_in_minutes and caches per credential', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(
      JSON.stringify({ access_token: 'long-token', expires_in: 604800 }),
      { status: 200 },
    );
  }) as typeof fetch;

  const key = 'ainobi_ak_0123456789abcdef_handoff_test_secret_value';
  await invalidateCachedAgentHandoffToken(key);
  try {
    const first = await exchangeAgentApiKeyForHandoffAccessToken(key, 10080);
    const second = await exchangeAgentApiKeyForHandoffAccessToken(key, 10080);
    assert.equal(first, 'long-token');
    assert.equal(second, 'long-token');
    // Cached: only one HTTP call for the same credential.
    assert.equal(calls.length, 1);
    assert.ok(String(calls[0]?.url).endsWith('/agent/token'));
    assert.equal((calls[0]?.body as { expires_in_minutes?: number }).expires_in_minutes, 10080);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('exchangeAgentApiKeyForHandoffAccessToken returns null on backend rejection', async () => {
  await invalidateCachedAgentHandoffToken('ainobi_ak_0123456789abcdef_handoff_fail_secret_value');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
  try {
    const token = await exchangeAgentApiKeyForHandoffAccessToken(
      'ainobi_ak_0123456789abcdef_handoff_fail_secret_value',
      10080,
    );
    assert.equal(token, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
