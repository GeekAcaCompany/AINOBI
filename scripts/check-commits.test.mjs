// SPDX-License-Identifier: AGPL-3.0-only
// Regression tests for the commit message rules and the CI range checker.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import load from '@commitlint/load';
import { commitRange, commitsForEvent, lintMessage } from './check-commits.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = await load({}, { cwd: root });
const sha = (digit) => digit.repeat(40);

test('accepts scoped commits, breaking changes, and the 72-character boundary', async () => {
  const messages = [
    'docs(readme): make English the default language',
    'fix(courseware-core): preserve element ids when saving',
    'feat(api)!: change course enrollment response\n\nReturn enrollment details instead of a boolean.',
    'feat(api)!: change response\n\nBREAKING CHANGE: Return enrollment details.',
    'revert(player): restore the previous playback behavior',
    'feat(cli): ' + 'a'.repeat(61),
  ];
  for (const message of messages) {
    const result = await lintMessage(message, config);
    assert.equal(result.valid, true, JSON.stringify({ message, errors: result.errors }));
  }
});

test('rejects malformed, ignored-by-default, empty, and attributed messages', async () => {
  const messages = [
    'feat: add validation',
    'style(cli): reformat code',
    'feat(): add validation',
    'feat(CLI): add validation',
    'feat(cli/core): add validation',
    'feat(cli): Add validation',
    'feat(cli): 添加校验',
    'feat(cli): add validation.',
    'feat(cli): add validation ',
    'feat(cli): ' + 'a'.repeat(62),
    'Merge pull request #1 from example/feature',
    'Revert "feat(cli): add validation"',
    'v1.0.0',
    'fixup! feat(cli): add validation',
    '',
    ' \n ',
    '# comment',
    '# comment\nfeat(cli): add validation',
    'feat(cli): add validation\n\nCo-Authored-By: Someone <test@example.com>',
    'feat(cli): add validation\n\ncO-aUtHoReD-bY: Someone <test@example.com>',
    'feat(cli): add validation\n\n🤖 Generated with [Claude Code](https://example.com)',
    'feat(cli): add validation\n\nAI-assisted implementation',
    'fix(cli): preserve parsing\n\n# Generated with Codex',
    'fix(cli): preserve parsing\n\n# Co-Authored-By: Someone <test@example.com>',
  ];
  for (const message of messages) {
    assert.equal((await lintMessage(message, config)).valid, false, JSON.stringify(message));
  }
});

test('rejects missing or unsafe event ranges instead of silently checking HEAD', () => {
  assert.throws(() => commitRange('push', { after: sha('a') }), /before SHA/);
  assert.throws(() => commitRange('push', { before: sha('b'), after: '--all' }), /after SHA/);
  assert.throws(() => commitRange('pull_request', { pull_request: { head: { sha: sha('a') } } }), /base SHA/);
  assert.throws(() => commitRange('push', { before: sha('b'), after: sha('0') }), /after SHA/);
  assert.throws(() => commitRange('workflow_dispatch', {}), /Unsupported GitHub event/);
});

test('checks the root commit and all PR/push commits, not only the final valid commit', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ainobi-commits-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Commit test',
    GIT_AUTHOR_EMAIL: 'commit-test@example.com',
    GIT_COMMITTER_NAME: 'Commit test',
    GIT_COMMITTER_EMAIL: 'commit-test@example.com',
  };
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_WORK_TREE;
  const git = (...args) => execFileSync('git', args, { cwd: directory, env: gitEnv, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  const commit = (message) => {
    git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const first = commit('chore(repo): initialize repository');
  const invalid = commit('update files');
  const last = commit('docs(readme): describe the project');
  const firstPush = { before: sha('0'), after: last };
  const push = { before: first, after: last };
  const pr = { pull_request: { base: { sha: first }, head: { sha: last } } };
  assert.deepEqual(commitsForEvent('push', firstPush, directory), [first, invalid, last]);
  assert.deepEqual(commitsForEvent('push', push, directory), [invalid, last]);
  assert.deepEqual(commitsForEvent('pull_request', pr, directory), [invalid, last]);

  const run = (eventName, event) => {
    const eventPath = join(directory, 'event.json');
    writeFileSync(eventPath, JSON.stringify(event));
    return spawnSync(process.execPath, [join(root, 'scripts/check-commits.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...gitEnv,
        GIT_DIR: join(directory, '.git'),
        GIT_WORK_TREE: directory,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
      },
    });
  };
  for (const [eventName, event] of [['push', firstPush], ['push', push], ['pull_request', pr]]) {
    const result = run(eventName, event);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(invalid));
  }
  const result = run('push', { before: sha('0'), after: first });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 commit messages/);
});

test('local --edit accepts a filled template and ignores its comment lines', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ainobi-message-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'COMMIT_EDIT_MSG');
  writeFileSync(file, 'docs(readme): describe the project\n' + readFileSync(join(root, '.gitmessage'), 'utf8'));
  const result = spawnSync(process.execPath, [join(root, 'node_modules/@commitlint/cli/cli.js'), '--edit', file], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
