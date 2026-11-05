// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { writeWorkspaceTextFile } from './codex-mcp-tools.ts';

describe('writeWorkspaceTextFile', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'mcp-workspace-'));
  const outside = mkdtempSync(join(tmpdir(), 'mcp-outside-'));
  const workspace = { workspaceDir, scenePath: join(workspaceDir, 'db-courseware.scene.json') };
  after(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('writes a file in a new directory and returns its relative path', async () => {
    const result = await writeWorkspaceTextFile(workspace, 'batch/plan.json', '{"ops":[]}');

    assert.deepEqual(result, { ok: true, data: { path: 'batch/plan.json', bytes: 10 } });
    assert.equal(readFileSync(join(workspaceDir, 'batch', 'plan.json'), 'utf8'), '{"ops":[]}');
  });

  it('refuses paths that leave the workspace', async () => {
    for (const path of ['../evil.json', 'batch/../../evil.json', join(outside, 'evil.json')]) {
      const result = await writeWorkspaceTextFile(workspace, path, '{}');
      assert.equal(result.ok, false, path);
    }
  });

  it('refuses a directory that links out of the workspace', async () => {
    symlinkSync(outside, join(workspaceDir, 'linked'), 'junction');

    const result = await writeWorkspaceTextFile(workspace, 'linked/evil.json', '{}');

    assert.equal(result.ok, false);
    assert.equal(result.error, 'path resolves outside the workspace');
  });

  it('refuses session state, the loaded scene, and other file types', async () => {
    for (const path of ['.ainobi-cli/session.json', 'db-courseware.scene.json', 'run.sh', 'batch']) {
      const result = await writeWorkspaceTextFile(workspace, path, '{}');
      assert.equal(result.ok, false, path);
    }
  });

  it('refuses content over the limit', async () => {
    const result = await writeWorkspaceTextFile(workspace, 'big.txt', 'x'.repeat(5 * 1024 * 1024 + 1));

    assert.equal(result.ok, false);
  });
});
