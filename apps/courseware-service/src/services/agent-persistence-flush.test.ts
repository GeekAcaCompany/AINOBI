// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  __setPersistWriterForTests,
  awaitAgentWorkspacePersistenceQueue,
  isAgentSessionSceneEffectivelyEmpty,
  livePreviewPersistenceMaxConcurrent,
  resetAgentPersistenceQueuesForTests,
  scheduleAgentWorkspacePersistenceOnLivePreview,
  shouldFlushPersistenceAfterAinobiBash,
  type AgentPersistenceFlushResult,
} from './agent-persistence-flush.ts';

test('shouldFlushPersistenceAfterAinobiBash matches agent save without path', () => {
  assert.equal(shouldFlushPersistenceAfterAinobiBash('ainobi save'), true);
  assert.equal(shouldFlushPersistenceAfterAinobiBash('ainobi save --pretty=false'), true);
  assert.equal(shouldFlushPersistenceAfterAinobiBash('ainobi save 2>&1'), true);
  assert.equal(
    shouldFlushPersistenceAfterAinobiBash(
      'WORK_DIR="/tmp/x"\nainobi save 2>&1',
    ),
    true,
  );
});

test('shouldFlushPersistenceAfterAinobiBash skips stdout and file targets', () => {
  assert.equal(shouldFlushPersistenceAfterAinobiBash('ainobi save --stdout'), false);
  assert.equal(shouldFlushPersistenceAfterAinobiBash('ainobi save out.scene.json'), false);
  assert.equal(shouldFlushPersistenceAfterAinobiBash('ainobi slide update 0 --set name=Hi'), false);
});

test('isAgentSessionSceneEffectivelyEmpty detects blank vs content', () => {
  assert.equal(isAgentSessionSceneEffectivelyEmpty(null), true);
  assert.equal(
    isAgentSessionSceneEffectivelyEmpty({
      slide_elements: [{ children_elements: [] }],
    }),
    true,
  );
  assert.equal(
    isAgentSessionSceneEffectivelyEmpty({
      slide_elements: [{ children_elements: [{ element_id: 'el_1' }] }],
    }),
    false,
  );
});
test('livePreviewPersistenceMaxConcurrent defaults and parses env', () => {
  const prev = process.env.AINOBI_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT;
  delete process.env.AINOBI_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT;
  assert.equal(livePreviewPersistenceMaxConcurrent(), 2);

  process.env.AINOBI_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT = '4';
  assert.equal(livePreviewPersistenceMaxConcurrent(), 4);

  process.env.AINOBI_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT = 'bad';
  assert.equal(livePreviewPersistenceMaxConcurrent(), 2);

  if (prev === undefined) {
    delete process.env.AINOBI_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT;
  } else {
    process.env.AINOBI_LIVE_PREVIEW_PERSISTENCE_MAX_CONCURRENT = prev;
  }
});

test('scheduleAgentWorkspacePersistenceOnLivePreview coalesces rapid patches', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ainobi-persist-queue-'));
  const coursewareKey = 'cw-coalesce-test';
  resetAgentPersistenceQueuesForTests();

  let calls = 0;
  const saved: AgentPersistenceFlushResult = {
    key: coursewareKey,
    title: 't',
    updatedAt: new Date().toISOString(),
    versionCount: 1,
  };

  __setPersistWriterForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 25));
    return saved;
  });

  for (let i = 0; i < 5; i += 1) {
    scheduleAgentWorkspacePersistenceOnLivePreview(workspace, coursewareKey);
  }
  await awaitAgentWorkspacePersistenceQueue(workspace, coursewareKey);

  assert.ok(calls >= 1 && calls <= 2, `expected 1-2 writes, got ${calls}`);

  __setPersistWriterForTests(null);
  resetAgentPersistenceQueuesForTests();
});
