// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { agentSetNameTool } from './codex-mcp-tools.ts';

function fakeSession(overrides: Partial<AinobiAuthorizedSession> = {}): AinobiAuthorizedSession {
  return {
    roles: ['agent'],
    user: {
      user_id: 'agent-1',
      user_name: 'Bot',
      account_name: 'bot',
      email: null,
      user_status: 'active',
      user_avatar_url: null,
      user_type: 'agent',
    },
    organization: null,
    permissions: [],
    userId: 'agent-1',
    permissionUserId: 'owner-1',
    currentOrgId: 'org-current',
    accessToken: 'token-1',
    expireAt: new Date(Date.now() + 3600_000).toISOString(),
    isOrgAgent: true,
    ...overrides,
  };
}

describe('agentSetNameTool', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('requires a non-empty name', async () => {
    const result = await agentSetNameTool(fakeSession(), { name: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NAME_REQUIRED');
  });

  it('rejects human sessions with guidance', async () => {
    const session = fakeSession({
      user: {
        user_id: 'u1',
        user_name: 'Teacher',
        account_name: 'teacher',
        email: null,
        user_status: 'active',
        user_avatar_url: null,
        user_type: 'normal',
      },
      isOrgAgent: false,
    });
    const result = await agentSetNameTool(session, { name: '教研组' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'AGENT_ONLY');
  });

  it('renames the calling agent via backend PATCH /agent/me', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          agent_user_id: 'agent-1',
          name: '备课助手',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await agentSetNameTool(fakeSession(), { name: '备课助手' });
    assert.equal(result.ok, true);
    const data = result.data as { agent_user_id: string; name: string; next: string };
    assert.equal(data.agent_user_id, 'agent-1');
    assert.equal(data.name, '备课助手');
    assert.equal(typeof data.next, 'string');
    const call = calls[0]!;
    assert.ok(call.url.endsWith('/agent/me'));
    assert.equal(call.init.method, 'PATCH');
    assert.equal(JSON.parse(String(call.init.body)).name, '备课助手');
  });

  it('maps backend 403 to FORBIDDEN', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'nope' }), { status: 403 })) as typeof fetch;
    const result = await agentSetNameTool(fakeSession(), { name: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FORBIDDEN');
  });
});
