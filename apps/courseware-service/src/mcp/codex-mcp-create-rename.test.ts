// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { createBlankCoursewareScene, newCoursewareBusinessKey } from './codex-mcp-blank-scene.ts';
import { coursewareCreateTool, coursewareRenameTool } from './codex-mcp-tools.ts';

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

describe('codex-mcp blank scene', () => {
  it('builds a one-slide blank scene', () => {
    const scene = createBlankCoursewareScene('Hello');
    assert.equal(scene.name, 'Hello');
    assert.ok(Array.isArray(scene.slide_elements));
    assert.equal((scene.slide_elements as unknown[]).length, 1);
    assert.match(String(scene.scene_id), /^sc_/);
  });

  it('generates uuid business keys', () => {
    const key = newCoursewareBusinessKey();
    assert.match(key, /^[0-9a-f-]{36}$/i);
  });
});

describe('coursewareCreateTool / coursewareRenameTool validation', () => {
  it('create requires title', async () => {
    const result = await coursewareCreateTool(fakeSession(), { title: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TITLE_REQUIRED');
  });

  it('create requires a confirmed content language (zh / en / ja)', async () => {
    const missing = await coursewareCreateTool(fakeSession(), { title: 'Hello' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'LANGUAGE_REQUIRED');

    const invalid = await coursewareCreateTool(fakeSession(), { title: 'Hello', language: 'fr' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'LANGUAGE_REQUIRED');
  });

  it('create requires org when session has none', async () => {
    const result = await coursewareCreateTool(fakeSession({ currentOrgId: '  ' }), {
      title: 'Hello',
      language: 'en',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ORG_REQUIRED');
  });

  it('rename requires courseware_id and title', async () => {
    const missingId = await coursewareRenameTool(fakeSession(), { title: 'X' });
    assert.equal(missingId.ok, false);
    assert.equal(missingId.code, 'COURSEWARE_REQUIRED');

    const missingTitle = await coursewareRenameTool(fakeSession(), {
      courseware_id: 'cw-1',
      title: '  ',
    });
    assert.equal(missingTitle.ok, false);
    assert.equal(missingTitle.code, 'TITLE_REQUIRED');
  });
});
