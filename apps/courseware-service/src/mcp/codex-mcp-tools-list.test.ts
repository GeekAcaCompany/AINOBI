// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { coursewareListTool } from './codex-mcp-tools.ts';

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

describe('coursewareListTool', () => {
  it('errors when neither org_id nor session currentOrgId is set', async () => {
    const result = await coursewareListTool(fakeSession({ currentOrgId: '   ' }), {});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ORG_REQUIRED');
  });
});
