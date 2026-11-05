// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  invalidateCachedAgentHandoffToken,
} from './ainobi-agent-api-key.ts';
import {
  COURSE_SECTION_QUERY_PERMISSION,
  hasCourseSectionQueryPermission,
  hasManageLoginPermission,
  isOrgAgentSession,
  MANAGE_LOGIN_PERMISSION,
  cacheTtlSeconds,
  sessionCacheTtlCapSeconds,
} from './ainobi-user-session.ts';

test('hasManageLoginPermission requires user:manage_login', () => {
  assert.equal(hasManageLoginPermission([MANAGE_LOGIN_PERMISSION, 'course:query']), true);
  assert.equal(hasManageLoginPermission(['course:query']), false);
  assert.equal(hasManageLoginPermission(undefined), false);
});

test('hasCourseSectionQueryPermission requires course_section:query', () => {
  assert.equal(
    hasCourseSectionQueryPermission([COURSE_SECTION_QUERY_PERMISSION, 'course:query']),
    true,
  );
  assert.equal(hasCourseSectionQueryPermission(['course:query']), false);
  assert.equal(hasCourseSectionQueryPermission(undefined), false);
});

test('isOrgAgentSession follows isOrgAgent flag', () => {
  assert.equal(isOrgAgentSession({ isOrgAgent: true }), true);
  assert.equal(isOrgAgentSession({ isOrgAgent: false }), false);
  assert.equal(isOrgAgentSession(null), false);
  assert.equal(isOrgAgentSession(undefined), false);
});

test('resolveHandoffAccessToken falls back to the working token without an agent credential', async () => {
  const { resolveHandoffAccessToken } = await import('./ainobi-user-session.ts');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('must not be called for credential-less sessions');
  }) as typeof fetch;
  try {
    const token = await resolveHandoffAccessToken({
      roles: ['agent'],
      user: {
        user_id: 'a1',
        user_name: 'Agent',
        account_name: 'agent@example.com',
        email: null,
        user_status: 'active',
        user_avatar_url: null,
        user_type: 'agent',
      },
      organization: null,
      permissions: [],
      userId: 'a1',
      permissionUserId: 'a1',
      currentOrgId: 'org1',
      accessToken: 'short-working-token',
      expireAt: new Date(Date.now() + 3600_000).toISOString(),
      isOrgAgent: true,
    });
    assert.equal(token, 'short-working-token');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('resolveHandoffAccessToken mints a long token for org-agent credentials', async () => {
  const { resolveHandoffAccessToken } = await import('./ainobi-user-session.ts');
  await invalidateCachedAgentHandoffToken(
    'ainobi_ak_0123456789abcdef_resolve_test_secret_value',
  );
  const calls: Array<{ url: string; body: { expires_in_minutes?: number } }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(
      JSON.stringify({ access_token: 'long-handoff-token', expires_in: 604800 }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const token = await resolveHandoffAccessToken({
      roles: ['agent'],
      user: {
        user_id: 'a1',
        user_name: 'Agent',
        account_name: 'agent@example.com',
        email: null,
        user_status: 'active',
        user_avatar_url: null,
        user_type: 'agent',
      },
      organization: null,
      permissions: [],
      userId: 'a1',
      permissionUserId: 'a1',
      currentOrgId: 'org1',
      accessToken: 'short-working-token',
      expireAt: new Date(Date.now() + 3600_000).toISOString(),
      isOrgAgent: true,
      credential: 'ainobi_ak_0123456789abcdef_resolve_test_secret_value',
    });
    assert.equal(token, 'long-handoff-token');
    assert.equal(calls.length, 1);
    assert.ok(String(calls[0]?.url).endsWith('/agent/token'));
    assert.equal(calls[0]?.body.expires_in_minutes, 10080);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('resolveHandoffAccessToken falls back to the working token when minting fails', async () => {
  const { resolveHandoffAccessToken } = await import('./ainobi-user-session.ts');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
  try {
    const token = await resolveHandoffAccessToken({
      roles: ['agent'],
      user: {
        user_id: 'a1',
        user_name: 'Agent',
        account_name: 'agent@example.com',
        email: null,
        user_status: 'active',
        user_avatar_url: null,
        user_type: 'agent',
      },
      organization: null,
      permissions: [],
      userId: 'a1',
      permissionUserId: 'a1',
      currentOrgId: 'org1',
      accessToken: 'short-working-token',
      expireAt: new Date(Date.now() + 3600_000).toISOString(),
      isOrgAgent: true,
      credential: 'ainobi_ak_0123456789abcdef_resolve_fail_secret_value',
    });
    assert.equal(token, 'short-working-token');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('check_session failure invalidates both short and handoff token caches', async () => {
  const {
    invalidateCachedAgentHandoffToken,
  } = await import('./ainobi-agent-api-key.ts');
  const { resolveValidatedUserSession } = await import('./ainobi-user-session.ts');
  const { exchangeAgentApiKeyForHandoffAccessToken } = await import(
    './ainobi-agent-api-key.ts'
  );

  const key = 'ainobi_ak_0123456789abcdef_p1fix_test_secret_value';
  await invalidateCachedAgentHandoffToken(key);

  let agentTokenCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith('/agent/token')) {
      agentTokenCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        expires_in_minutes?: number;
      };
      // handoff mint carries expires_in_minutes; the working-token exchange does not.
      if (body.expires_in_minutes) {
        return new Response(
          JSON.stringify({ access_token: `long-${agentTokenCalls}`, expires_in: 604800 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ access_token: `short-${agentTokenCalls}`, expires_in: 3600 }),
        { status: 200 },
      );
    }
    if (target.endsWith('/user/check_session')) {
      return new Response('revoked', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    // Failure path 1: the short ticket redeems but check_session returns 500 → the short ticket cache is invalidated (existing behavior).
    assert.equal(await resolveValidatedUserSession(key), null);

    // Mint one long handoff ticket and cache it.
    const minted1 = await exchangeAgentApiKeyForHandoffAccessToken(key, 10080);
    assert.equal(minted1, `long-${agentTokenCalls}`);
    const handoffCallsAfterMint = agentTokenCalls;

    // Failure path 2: resolving fails again → the long ticket cache must be invalidated too (P1 regression).
    assert.equal(await resolveValidatedUserSession(key), null);
    assert.ok(agentTokenCalls > handoffCallsAfterMint, 'short token re-exchanged');

    // Cache cleared: the handoff redemption must hit /agent/token again and get a new token.
    const minted2 = await exchangeAgentApiKeyForHandoffAccessToken(key, 10080);
    assert.equal(minted2, `long-${agentTokenCalls}`);
    assert.notEqual(minted1, minted2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('cacheTtlSeconds caps the revocation window instead of the 7-day token lifetime', () => {
  const cap = sessionCacheTtlCapSeconds();
  const far = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const near = new Date(Date.now() + 30_000).toISOString();
  assert.equal(cacheTtlSeconds(far), cap);
  const nearTtl = cacheTtlSeconds(near);
  assert.ok(nearTtl !== null && nearTtl >= 25 && nearTtl <= 30);
  assert.equal(cacheTtlSeconds('not-a-date'), null);
  assert.equal(cacheTtlSeconds(new Date(Date.now() - 1000).toISOString()), null);
});

test('sessionCacheTtlCapSeconds honors the env override and falls back on bad values', () => {
  const prev = process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS;
  try {
    process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS = '2';
    assert.equal(sessionCacheTtlCapSeconds(), 2);
    const far = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    assert.equal(cacheTtlSeconds(far), 2);
    process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS = 'garbage';
    assert.equal(sessionCacheTtlCapSeconds(), 300);
    process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS = '0';
    assert.equal(sessionCacheTtlCapSeconds(), 300);
    process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS = '0.5';
    assert.equal(sessionCacheTtlCapSeconds(), 300);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS;
    } else {
      process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS = prev;
    }
  }
});
