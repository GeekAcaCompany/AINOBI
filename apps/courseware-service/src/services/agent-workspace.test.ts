// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  agentAinobiStateDir,
  agentScenePath,
  AGENT_SCENE_FILENAME,
  AGENT_SKILL_MD_READ_MARKER,
  ensureAgentWorkspaceLayout,
  hasAgentReadSkillMd,
  markAgentReadSkillMd,
  readAgentSkillMdForPrompt,
  resolveAgentWorkspaceDir,
} from './agent-workspace.ts';
import { coursewareCliRoot } from '../runtime-paths.ts';

const root = coursewareCliRoot;
const projectRoot = resolve(import.meta.dirname, '../..');

test('resolveAgentWorkspaceDir prefers conversation over preload', () => {
  assert.equal(
    resolveAgentWorkspaceDir({
      coursewareCliRoot: root,
      conversationId: 'conv-1',
      preloadCoursewareId: 'cw-1',
    }),
    resolve(root, 'agent-workspaces', 'conv-1'),
  );
});

test('ensureAgentWorkspaceLayout copies the CLI skill tree into the workspace', () => {
  const workspace = resolve(root, 'agent-preload', '_test_workspace_layout');
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });

  try {
    ensureAgentWorkspaceLayout({ workspaceDir: workspace, projectRoot });
    const skillDir = join(workspace, '.claude', 'skills', 'ainobi-courseware-cli');
    const skillMd = join(skillDir, 'SKILL.md');
    const workflows = join(skillDir, 'references', 'workflows.md');
    const canonical = join(root, 'SKILL.md');

    assert.ok(existsSync(skillMd));
    assert.ok(statSync(skillMd).isFile());
    assert.ok(existsSync(workflows));
    assert.equal(readFileSync(skillMd, 'utf8'), readFileSync(canonical, 'utf8'));
    assert.ok(!existsSync(join(workspace, 'SKILL.md')));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('agentAinobiStateDir lives inside the workspace', () => {
  const workspace = resolve(root, 'agent-workspaces', '_test_state_dir');
  try {
    assert.equal(agentAinobiStateDir(workspace), resolve(workspace, '.ainobi-cli'));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('skill-md-read marker persists in workspace state dir', () => {
  const workspace = resolve(root, 'agent-preload', '_test_skill_read_marker');
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });

  try {
    assert.equal(hasAgentReadSkillMd(workspace), false);
    markAgentReadSkillMd(workspace);
    assert.equal(hasAgentReadSkillMd(workspace), true);
    assert.ok(
      existsSync(join(agentAinobiStateDir(workspace), AGENT_SKILL_MD_READ_MARKER)),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('agentScenePath points at db-courseware.scene.json in workspace', () => {
  const workspace = resolve(root, 'agent-workspaces', '_test_scene_path');
  mkdirSync(workspace, { recursive: true });
  try {
    assert.equal(agentScenePath(workspace), resolve(workspace, AGENT_SCENE_FILENAME));
    writeFileSync(agentScenePath(workspace), '{}', 'utf8');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('readAgentSkillMdForPrompt returns the workspace SKILL.md body without frontmatter', () => {
  const workspace = join(root, 'agent-workspaces', `skill-inline-${process.pid}-${Date.now()}`);
  mkdirSync(workspace, { recursive: true });
  try {
    assert.equal(readAgentSkillMdForPrompt(workspace), null);
    ensureAgentWorkspaceLayout({ workspaceDir: workspace, projectRoot });
    const body = readAgentSkillMdForPrompt(workspace);
    assert.ok(body);
    assert.ok(body.startsWith('# AINOBI Courseware CLI'));
    assert.doesNotMatch(body, /^---/);
    assert.doesNotMatch(body, /^description:/m);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
