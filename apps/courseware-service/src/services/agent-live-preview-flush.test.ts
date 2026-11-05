// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  flushAgentWorkspaceLivePreview,
  hasAgentWorkspaceCliSession,
  readAgentWorkspaceCliWorkDir,
  readAgentWorkspaceSession,
  seedLivePreviewSceneCache,
  shouldFlushLivePreviewAfterAinobiBash,
  syncLivePreviewSessionInWorkspace,
} from './agent-live-preview-flush.ts';
import { agentAinobiStateDir, isManagedCliWorkDir, managedCliWorkRoot } from './agent-workspace.ts';

test('shouldFlushLivePreviewAfterAinobiBash skips readonly ainobi commands', () => {
  assert.equal(shouldFlushLivePreviewAfterAinobiBash('ainobi status'), false);
  assert.equal(shouldFlushLivePreviewAfterAinobiBash('ainobi slide get 0'), false);
  assert.equal(shouldFlushLivePreviewAfterAinobiBash('ainobi slide update 0 --set name=Hi'), true);
  assert.equal(shouldFlushLivePreviewAfterAinobiBash('ainobi load scene.json'), false);
});

test('shouldFlushLivePreviewAfterAinobiBash includes animation commands', () => {
  assert.equal(shouldFlushLivePreviewAfterAinobiBash('ainobi animation preset 0 el_x --kind fade_in'), true);
});

test('syncLivePreviewSessionInWorkspace updates session stream id', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ainobi-lp-sync-'));
  const stateDir = agentAinobiStateDir(workspace);
  try {
    mkdirSync(join(stateDir, '.current'), { recursive: true });
    writeFileSync(join(stateDir, '.current', 'agent-cw-x.txt'), 'ainobi-abc\n', 'utf8');
    writeFileSync(
      join(stateDir, 'ainobi-abc.json'),
      `${JSON.stringify({
        version: 1,
        session_id: 'ainobi-abc',
        live_preview_session_id: 'old-session',
        live_preview_stream_key: 'ainobi:courseware:session:old-session:events',
        scene: { scene_id: 'sc_1', name: 'T', slide_elements: [], vtuber_elements: [] },
      })}\n`,
      'utf8',
    );
    assert.equal(await syncLivePreviewSessionInWorkspace(workspace, 'new-session'), true);
    const session = await readAgentWorkspaceSession(workspace);
    assert.equal(session?.live_preview_session_id, 'new-session');
    assert.equal(await syncLivePreviewSessionInWorkspace(workspace, 'new-session'), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('readAgentWorkspaceCliWorkDir returns managed work_dir from session file', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ainobi-lp-workdir-'));
  const stateDir = agentAinobiStateDir(workspace);
  const workDir = join(managedCliWorkRoot(), 'ainobi-abc');
  try {
    mkdirSync(join(stateDir, '.current'), { recursive: true });
    writeFileSync(join(stateDir, '.current', 'agent-cw-x.txt'), 'ainobi-abc\n', 'utf8');
    writeFileSync(
      join(stateDir, 'ainobi-abc.json'),
      `${JSON.stringify({
        version: 1,
        session_id: 'ainobi-abc',
        work_dir: workDir,
        scene: { scene_id: 'sc_1', name: 'T', slide_elements: [], vtuber_elements: [] },
      })}\n`,
      'utf8',
    );
    assert.ok(isManagedCliWorkDir(workDir));
    assert.equal(await readAgentWorkspaceCliWorkDir(workspace), resolve(workDir));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('hasAgentWorkspaceCliSession detects bound ainobi session files', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ainobi-lp-has-session-'));
  try {
    assert.equal(await hasAgentWorkspaceCliSession(workspace), false);
    const stateDir = agentAinobiStateDir(workspace);
    mkdirSync(join(stateDir, '.current'), { recursive: true });
    writeFileSync(join(stateDir, '.current', 'agent-cw-x.txt'), 'ainobi-abc\n', 'utf8');
    writeFileSync(
      join(stateDir, 'ainobi-abc.json'),
      `${JSON.stringify({ version: 1, session_id: 'ainobi-abc', scene: {} })}\n`,
      'utf8',
    );
    assert.equal(await hasAgentWorkspaceCliSession(workspace), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('flushAgentWorkspaceLivePreview publishes diff after scene mutation', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'ainobi-lp-flush-'));
  const stateDir = agentAinobiStateDir(workspace);
  const sessionId = 'ainobi-test-session';
  const liveId = 'live-preview-test';

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  mkdirSync(join(stateDir, '.current'), { recursive: true });
  writeFileSync(join(stateDir, '.current', 'agent-cw-test.txt'), `${sessionId}\n`, 'utf8');

  const baseScene = {
    scene_id: 'sc_flush',
    name: 'Before',
    slide_elements: [],
    vtuber_elements: [],
  };
  writeFileSync(
    join(stateDir, `${sessionId}.json`),
    `${JSON.stringify({
      version: 1,
      session_id: sessionId,
      live_preview_session_id: liveId,
      scene: baseScene,
    })}\n`,
    'utf8',
  );

  seedLivePreviewSceneCache(workspace, baseScene, liveId);

  const priorKeys = process.env.REDIS_HOST;
  if (!priorKeys?.trim()) {
    t.skip('REDIS_HOST not configured');
    return;
  }

  writeFileSync(
    join(stateDir, `${sessionId}.json`),
    `${JSON.stringify({
      version: 1,
      session_id: sessionId,
      live_preview_session_id: liveId,
      scene: { ...baseScene, name: 'After' },
    })}\n`,
    'utf8',
  );

  const published = await flushAgentWorkspaceLivePreview(workspace);
  assert.equal(published, true);
});
