// SPDX-License-Identifier: AGPL-3.0-only
// Validates every commit message in a GitHub push or pull_request event range.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import lint from '@commitlint/lint';
import load from '@commitlint/load';

function requireSha(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value) || /^0+$/.test(value)) {
    throw new Error(`Missing or invalid ${label}; expected a nonzero 40-character commit SHA.`);
  }
  return value;
}

export function commitRange(eventName, event) {
  if (eventName === 'pull_request') {
    const base = requireSha(event.pull_request?.base?.sha, 'pull request base SHA');
    const head = requireSha(event.pull_request?.head?.sha, 'pull request head SHA');
    return `${base}..${head}`;
  }
  if (eventName === 'push') {
    const head = requireSha(event.after, 'push after SHA');
    // On the first push, also check the initial commit that has no parent.
    if (event.before === '0'.repeat(40)) return head;
    const base = requireSha(event.before, 'push before SHA');
    return `${base}..${head}`;
  }
  throw new Error(`Unsupported GitHub event: ${eventName || '(missing)'}. Expected pull_request or push.`);
}

function hasCommit(sha, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', sha + '^{commit}'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function commitsForEvent(eventName, event, cwd = process.cwd()) {
  let range = commitRange(eventName, event);
  // A forced push can replace history, so the commit it replaced may no longer exist. Check
  // every commit the new head reaches.
  if (eventName === 'push' && range.includes('..') && !hasCommit(event.before, cwd)) range = event.after;
  return execFileSync('git', ['rev-list', '--reverse', range, '--'], {
    cwd,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);
}

export async function lintMessage(message, config) {
  // commitlint itself ignores empty messages, so reject them explicitly in CI.
  if (!message.trim()) {
    return { valid: false, errors: [{ name: 'header-empty', message: 'Commit message must not be empty.' }] };
  }
  return lint(message, config.rules, {
    parserOpts: config.parserPreset?.parserOpts,
    plugins: config.plugins,
    defaultIgnores: config.defaultIgnores,
    ignores: config.ignores,
  });
}

export async function checkCommits(eventName, event, cwd = process.cwd()) {
  const config = await load({}, { cwd });
  const commits = commitsForEvent(eventName, event, cwd);
  if (commits.length === 0) throw new Error('No commits found in the event range; refusing to report a successful check.');
  let failures = 0;
  for (const sha of commits) {
    const message = execFileSync('git', ['show', '--no-patch', '--format=%B', sha], { cwd, encoding: 'utf8' });
    const result = await lintMessage(message, config);
    if (!result.valid) {
      failures += 1;
      console.error(`Invalid commit ${sha}:`);
      for (const error of result.errors) console.error(`  ${error.name}: ${error.message}`);
    }
  }
  if (failures > 0) throw new Error(`${failures} of ${commits.length} commit messages failed validation. See CONTRIBUTING.md.`);
  console.log(`Validated ${commits.length} commit messages.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH is required to read the GitHub event payload.');
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    await checkCommits(process.env.GITHUB_EVENT_NAME, event);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
