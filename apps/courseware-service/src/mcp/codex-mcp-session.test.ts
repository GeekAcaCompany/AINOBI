// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { buildOAuthProtectedResourceMetadata } from './codex-mcp-oauth.ts';
import {
  buildCodexMcpAinobiEnv,
  codexMcpShellBindingPath,
  createCodexMcpWorkspaceBinding,
  deleteCodexMcpSession,
  getCodexMcpSession,
  isCodexMcpWorkspaceReady,
  isSafeCodexMcpSessionId,
  listCodexMcpSessions,
  registerCodexMcpSession,
  resetCodexMcpSessionsForTests,
  sanitizeCodexMcpShellKey,
  seedCodexMcpSessionLocalCacheForTests,
  syncOpenCodexMcpWorkspaceTitles,
  type CodexMcpWorkspaceSession,
} from './codex-mcp-session.ts';
import { isCodexMcpToolFailure } from './codex-mcp-tools.ts';

function fakeSession(userId = 'u1'): AinobiAuthorizedSession {
  return {
    roles: [],
    user: {
      user_id: userId,
      user_name: 'Test',
      account_name: 'test',
      email: null,
      user_status: 'active',
      user_avatar_url: null,
      user_type: 'normal',
    },
    organization: null,
    permissions: ['user:manage_login'],
    userId,
    permissionUserId: userId,
    currentOrgId: 'org1',
    accessToken: 'token',
    expireAt: new Date(Date.now() + 3600_000).toISOString(),
    isOrgAgent: false,
  };
}

describe('buildOAuthProtectedResourceMetadata', () => {
  it('points resource at /mcp', () => {
    const meta = buildOAuthProtectedResourceMetadata({
      publicBaseUrl: 'https://courseware.example',
      authorizationServer: 'https://backend.example',
    });
    assert.equal(meta.resource, 'https://courseware.example/mcp');
    assert.deepEqual(meta.authorization_servers, ['https://backend.example']);
    assert.ok(meta.bearer_methods_supported.includes('header'));
  });
});

describe('Codex MCP session registry', () => {
  it('registers and deletes sessions with ownerUserId', async () => {
    resetCodexMcpSessionsForTests();
    const binding = createCodexMcpWorkspaceBinding({
      userSession: fakeSession('u1'),
      coursewareId: 'cw-1',
      coursewareKey: 'key-1',
      coursewareOrgId: 'org1',
      actor: { userId: 'u1', accountName: 'test', orgId: 'org1' },
      mcpSessionId: 'sess-test-1',
    });
    assert.equal(binding.ownerUserId, 'u1');
    await registerCodexMcpSession(binding);
    assert.equal((await getCodexMcpSession('sess-test-1'))?.coursewareKey, 'key-1');
    assert.equal(await deleteCodexMcpSession('sess-test-1'), true);
    assert.equal(await getCodexMcpSession('sess-test-1'), undefined);
    resetCodexMcpSessionsForTests();
  });
});

describe('isCodexMcpWorkspaceReady', () => {
  it('requires scene, shell bind, and CLI session file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-mcp-ready-'));
    const session: CodexMcpWorkspaceSession = {
      mcpSessionId: 'ready-1',
      ownerUserId: 'u1',
      coursewareId: 'cw',
      coursewareKey: 'key',
      coursewareOrgId: 'org',
      workspaceDir: root,
      stateDir: join(root, '.ainobi-cli'),
      shellSession: 'codex-mcp-ready-1',
      scenePath: join(root, 'db-courseware.scene.json'),
      actor: { userId: 'u1', accountName: 'test', orgId: 'org' },
      createdAt: new Date().toISOString(),
    };

    assert.equal(await isCodexMcpWorkspaceReady(session), false);

    writeFileSync(session.scenePath, '{}\n');
    assert.equal(await isCodexMcpWorkspaceReady(session), false);

    mkdirSync(join(session.stateDir, '.current'), { recursive: true });
    writeFileSync(codexMcpShellBindingPath(session), 'ainobi-sess-1\n');
    assert.equal(await isCodexMcpWorkspaceReady(session), false);

    const sessionsDir = join(session.stateDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    // findSessionFile looks for session JSON under stateDir — write a minimal session file
    // matching agent-live-preview-flush discovery (sessions/*.json or similar).
    writeFileSync(
      join(session.stateDir, 'ainobi-sess-1.json'),
      JSON.stringify({
        version: 1,
        session_id: 'ainobi-sess-1',
        source_path: null,
        loaded_at: new Date().toISOString(),
        saved_at: null,
        dirty: false,
        scene: { slide_elements: [] },
      }),
    );
    assert.equal(sanitizeCodexMcpShellKey('codex-mcp-ready-1'), 'codex-mcp-ready-1');
    assert.equal(await isCodexMcpWorkspaceReady(session), true);
  });
});

describe('isSafeCodexMcpSessionId / path traversal', () => {
  it('accepts UUID-like ids and rejects path separators', () => {
    assert.equal(isSafeCodexMcpSessionId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), true);
    assert.equal(isSafeCodexMcpSessionId('seed-only'), true);
    assert.equal(isSafeCodexMcpSessionId('../../../../tmp/x'), false);
    assert.equal(isSafeCodexMcpSessionId('foo/bar'), false);
    assert.equal(isSafeCodexMcpSessionId('ab'), false);
  });

  it('rejects traversal ids in createCodexMcpWorkspaceBinding', () => {
    assert.throws(
      () =>
        createCodexMcpWorkspaceBinding({
          userSession: fakeSession('u1'),
          coursewareId: 'cw-1',
          coursewareKey: 'key-1',
          actor: { userId: 'u1', accountName: 'test', orgId: 'org1' },
          mcpSessionId: '../../../../tmp/x',
        }),
      /Invalid mcp_session_id/,
    );
  });

  it('syncOpenCodexMcpWorkspaceTitles updates open scene name', () => {
    resetCodexMcpSessionsForTests();
    const binding = createCodexMcpWorkspaceBinding({
      userSession: fakeSession('u1'),
      coursewareId: 'cw-rename',
      coursewareKey: 'key-rename',
      actor: { userId: 'u1', accountName: 'test', orgId: 'org1' },
      mcpSessionId: 'rename-sync-1',
    });
    writeFileSync(binding.scenePath, `${JSON.stringify({ name: 'Old' }, null, 2)}\n`);
    mkdirSync(join(binding.stateDir, '.current'), { recursive: true });
    writeFileSync(codexMcpShellBindingPath(binding), 'ainobi-sess-rename\n');
    writeFileSync(
      join(binding.stateDir, 'ainobi-sess-rename.json'),
      JSON.stringify({
        version: 1,
        session_id: 'ainobi-sess-rename',
        scene: { name: 'Old Session Title', slide_elements: [] },
      }),
    );
    seedCodexMcpSessionLocalCacheForTests(binding);
    assert.equal(
      syncOpenCodexMcpWorkspaceTitles({
        coursewareId: 'cw-rename',
        coursewareKey: 'key-rename',
        title: 'New Title',
      }),
      1,
    );
    const updated = JSON.parse(readFileSync(binding.scenePath, 'utf8'));
    assert.equal(updated.name, 'New Title');
    const cliSession = JSON.parse(
      readFileSync(join(binding.stateDir, 'ainobi-sess-rename.json'), 'utf8'),
    );
    assert.equal(cliSession.scene.name, 'New Title');
    resetCodexMcpSessionsForTests();
  });

  it('syncOpenCodexMcpWorkspaceTitles keeps only an in-sync session in sync', () => {
    resetCodexMcpSessionsForTests();
    const syncedAtAfterRename = (mcpSessionId: string, syncedAt: string): string => {
      const binding = createCodexMcpWorkspaceBinding({
        userSession: fakeSession('u1'),
        coursewareId: `cw-${mcpSessionId}`,
        coursewareKey: `key-${mcpSessionId}`,
        actor: { userId: 'u1', accountName: 'test', orgId: 'org1' },
        mcpSessionId,
      });
      mkdirSync(join(binding.stateDir, '.current'), { recursive: true });
      writeFileSync(codexMcpShellBindingPath(binding), 'ainobi-sess\n');
      const sessionPath = join(binding.stateDir, 'ainobi-sess.json');
      writeFileSync(
        sessionPath,
        JSON.stringify({ session_id: 'ainobi-sess', courseware_synced_at: syncedAt, scene: { name: 'Old' } }),
      );
      seedCodexMcpSessionLocalCacheForTests(binding);
      syncOpenCodexMcpWorkspaceTitles({
        coursewareId: binding.coursewareId,
        coursewareKey: binding.coursewareKey,
        title: 'New',
        previousUpdatedAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-05T11:00:00.000Z',
      });
      return JSON.parse(readFileSync(sessionPath, 'utf8')).courseware_synced_at;
    };

    assert.equal(syncedAtAfterRename('rename-in-sync', '2026-11-05T10:00:00.000Z'), '2026-11-05T11:00:00.000Z');
    assert.equal(syncedAtAfterRename('rename-behind', '2026-11-05T09:00:00.000Z'), '2026-11-05T09:00:00.000Z');
    resetCodexMcpSessionsForTests();
  });
});

describe('isCodexMcpToolFailure', () => {
  it('detects ok:false and non-zero exit_code', () => {
    assert.equal(isCodexMcpToolFailure({ ok: false, error: 'x' }), true);
    assert.equal(isCodexMcpToolFailure({ ok: true, exit_code: 1 }), true);
    assert.equal(isCodexMcpToolFailure({ ok: true, data: {} }), false);
  });
});

describe('local cache seeding helper', () => {
  it('seeds memory only for tests', () => {
    resetCodexMcpSessionsForTests();
    const binding = createCodexMcpWorkspaceBinding({
      userSession: fakeSession('u2'),
      coursewareId: 'cw-2',
      coursewareKey: 'key-2',
      actor: { userId: 'u2', accountName: 't2', orgId: 'org1' },
      mcpSessionId: 'seed-only',
    });
    seedCodexMcpSessionLocalCacheForTests(binding);
    // Inspect local Map directly — getCodexMcpSession treats Redis as source of truth
    // and would drop a memory-only seed when Redis is configured but empty for this key.
    assert.equal(
      listCodexMcpSessions().find((s) => s.mcpSessionId === 'seed-only')?.ownerUserId,
      'u2',
    );
    resetCodexMcpSessionsForTests();
  });
});

describe('buildCodexMcpAinobiEnv', () => {
  it('sets agent runtime + asset host flush and does not leak host secrets', () => {
    const prevAk = process.env.ALIYUN_ACCESS_KEY_ID;
    const prevOss = process.env.OSS_BUCKET;
    const prevDb = process.env.DB_HOST;
    process.env.ALIYUN_ACCESS_KEY_ID = 'should-not-leak';
    process.env.OSS_BUCKET = 'secret-bucket';
    process.env.DB_HOST = 'db.internal';
    try {
      const binding = createCodexMcpWorkspaceBinding({
        userSession: fakeSession('u3'),
        coursewareId: 'cw-3',
        coursewareKey: 'key-3',
        coursewareOrgId: 'org1',
        actor: { userId: 'u3', accountName: 't3', orgId: 'org1' },
        mcpSessionId: 'env-test',
      });
      const env = buildCodexMcpAinobiEnv(binding, 'caller-token', 5633);
      assert.equal(env.AINOBI_CLI_RUNTIME, 'agent');
      assert.equal(env.AINOBI_ASSET_HOST_FLUSH, '1');
      assert.equal(env.AINOBI_AGENT_API_KEY, 'caller-token');
      assert.equal(env.ALIYUN_ACCESS_KEY_ID, undefined);
      assert.equal(env.OSS_BUCKET, undefined);
      assert.equal(env.DB_HOST, undefined);
      assert.match(env.AINOBI_COURSEWARE_ASSET_UPLOAD_URL ?? '', /\/courseware\/assets\/upload$/);
    } finally {
      if (prevAk === undefined) delete process.env.ALIYUN_ACCESS_KEY_ID;
      else process.env.ALIYUN_ACCESS_KEY_ID = prevAk;
      if (prevOss === undefined) delete process.env.OSS_BUCKET;
      else process.env.OSS_BUCKET = prevOss;
      if (prevDb === undefined) delete process.env.DB_HOST;
      else process.env.DB_HOST = prevDb;
    }
  });

  it('always injects the host-derived asset URL whitelist (MCP validate must not degrade)', () => {
    const prevBackend = process.env.STORAGE_BACKEND;
    const prevEndpoint = process.env.OCI_S3_ENDPOINT;
    const prevBucket = process.env.OCI_S3_BUCKET;
    const prevRegion = process.env.OCI_S3_REGION;
    const prevAk = process.env.OCI_S3_ACCESS_KEY_ID;
    const prevSk = process.env.OCI_S3_SECRET_ACCESS_KEY;
    process.env.STORAGE_BACKEND = 'oci_s3';
    process.env.OCI_S3_ENDPOINT = 'https://nsl.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com';
    process.env.OCI_S3_BUCKET = 'example-storage';
    process.env.OCI_S3_REGION = 'ap-tokyo-1';
    process.env.OCI_S3_ACCESS_KEY_ID = 'ak';
    process.env.OCI_S3_SECRET_ACCESS_KEY = 'sk';
    try {
      const binding = createCodexMcpWorkspaceBinding({
        userSession: fakeSession('u4'),
        coursewareId: 'cw-4',
        coursewareKey: 'key-4',
        coursewareOrgId: 'org1',
        actor: { userId: 'u4', accountName: 't4', orgId: 'org1' },
        mcpSessionId: 'env-whitelist-test',
      });
      const env = buildCodexMcpAinobiEnv(binding, 'caller-token', 5633);
      const whitelist = env.AINOBI_COURSEWARE_ASSET_BASE_URLS ?? '';
      assert.ok(whitelist.length > 0, 'whitelist env must always be present');
      // Both the OCI native and S3-compat forms must be in the table — without either, validate
      // falsely flags the matching form persisted in scenes as External (the 2026-09-07 case of a whole batch of narration
      // regenerated: the MCP subprocess allowlist degraded and every native oraclecloud URL was refused).
      assert.ok(
        whitelist.includes('objectstorage.ap-tokyo-1.oraclecloud.com/n/nsl/b/example-storage/o'),
        `native form missing: ${whitelist}`,
      );
      assert.ok(
        whitelist.includes('nsl.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage'),
        `compat form missing: ${whitelist}`,
      );
      // Credentials are still never handed down
      assert.equal(env.OCI_S3_SECRET_ACCESS_KEY, undefined);
      assert.equal(env.STORAGE_BACKEND, undefined);
    } finally {
      for (const [k, v] of [
        ['STORAGE_BACKEND', prevBackend],
        ['OCI_S3_ENDPOINT', prevEndpoint],
        ['OCI_S3_BUCKET', prevBucket],
        ['OCI_S3_REGION', prevRegion],
        ['OCI_S3_ACCESS_KEY_ID', prevAk],
        ['OCI_S3_SECRET_ACCESS_KEY', prevSk],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
