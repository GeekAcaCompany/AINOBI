// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assessCliSessionVsDatabase,
  clearAgentWorkspaceCliSession,
  patchAgentWorkspaceSessionSyncedAt,
  sceneContentFingerprint,
} from './agent-courseware-scene-sync.ts';
import { agentAinobiStateDir } from './agent-workspace.ts';
import { hasAgentWorkspaceCliSession } from './agent-live-preview-flush.ts';

const baseScene = (name: string) => ({
  scene_id: 'sc_test',
  name,
  slide_elements: [],
  vtuber_elements: [],
});

test('sceneContentFingerprint changes when content changes', () => {
  const a = sceneContentFingerprint(baseScene('A') as Record<string, unknown>);
  const b = sceneContentFingerprint(baseScene('B') as Record<string, unknown>);
  assert.notEqual(a, b);
});

test('assessCliSessionVsDatabase detects newer database updated_at', () => {
  const session = {
    scene: baseScene('Old'),
    dirty: false,
    loaded_at: '2026-05-20T10:00:00.000Z',
    courseware_synced_at: '2026-05-20T10:00:00.000Z',
  };
  const result = assessCliSessionVsDatabase(
    session,
    baseScene('New') as Record<string, unknown>,
    new Date('2026-05-20T12:00:00.000Z'),
  );
  assert.equal(result.status, 'stale');
  if (result.status === 'stale') {
    assert.equal(result.reason, 'db_updated_at');
  }
});

test('assessCliSessionVsDatabase keeps dirty local edits when db is not newer', () => {
  const scene = baseScene('Local edit');
  const session = {
    scene,
    dirty: true,
    loaded_at: '2026-05-20T12:00:00.000Z',
    courseware_synced_at: '2026-05-20T12:00:00.000Z',
  };
  const dbScene = baseScene('Database');
  const result = assessCliSessionVsDatabase(
    session,
    dbScene as Record<string, unknown>,
    new Date('2026-05-20T12:00:00.000Z'),
  );
  assert.equal(result.status, 'in_sync');
});

test('clearAgentWorkspaceCliSession removes bound session files', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ainobi-scene-sync-clear-'));
  const stateDir = agentAinobiStateDir(workspace);
  const sessionId = 'ainobi-sync-clear';
  try {
    mkdirSync(join(stateDir, '.current'), { recursive: true });
    writeFileSync(join(stateDir, '.current', 'shell.txt'), `${sessionId}\n`, 'utf8');
    writeFileSync(
      join(stateDir, `${sessionId}.json`),
      `${JSON.stringify({ version: 1, session_id: sessionId, scene: {} })}\n`,
      'utf8',
    );
    assert.equal(await hasAgentWorkspaceCliSession(workspace), true);
    await clearAgentWorkspaceCliSession(workspace);
    assert.equal(await hasAgentWorkspaceCliSession(workspace), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('patchAgentWorkspaceSessionSyncedAt writes courseware_synced_at', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ainobi-scene-sync-patch-'));
  const stateDir = agentAinobiStateDir(workspace);
  const sessionId = 'ainobi-sync-patch';
  const syncedAt = '2026-05-20T15:00:00.000Z';
  try {
    mkdirSync(join(stateDir, '.current'), { recursive: true });
    writeFileSync(join(stateDir, '.current', 'shell.txt'), `${sessionId}\n`, 'utf8');
    writeFileSync(
      join(stateDir, `${sessionId}.json`),
      `${JSON.stringify({
        version: 1,
        session_id: sessionId,
        scene: {},
        dirty: true,
      })}\n`,
      'utf8',
    );
    await patchAgentWorkspaceSessionSyncedAt(workspace, syncedAt);
    const raw = JSON.parse(
      await readFile(join(stateDir, `${sessionId}.json`), 'utf8'),
    ) as { courseware_synced_at?: string; dirty?: boolean };
    assert.equal(raw.courseware_synced_at, syncedAt);
    assert.equal(raw.dirty, false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
