// SPDX-License-Identifier: AGPL-3.0-only
// Local secret scan with the gitleaks build CI pins. Later builds silently drop custom rules defined beside
// [extend] useDefault, so they would report a clean result while missing them; this refuses to run those.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PINNED = '8.18.4';
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const gitleaks = process.env.GITLEAKS_BIN || 'gitleaks';

const version = (spawnSync(gitleaks, ['version'], { encoding: 'utf8' }).stdout ?? '').trim();
if (version !== PINNED) {
  console.error(`refusing to run: gitleaks ${version || 'not found'} is installed, but this repository pins ${PINNED}.`);
  console.error(`Get it from https://github.com/gitleaks/gitleaks/releases/tag/v${PINNED}`);
  process.exit(1);
}

// The working tree, then every commit on every ref: the same ground CI covers.
for (const args of [
  ['detect', '--source', '.', '--config', '.gitleaks.toml', '--redact', '--verbose', '--no-git'],
  ['detect', '--source', '.', '--config', '.gitleaks.toml', '--redact', '--verbose', '--log-opts=--all'],
]) {
  console.log(`\ngitleaks ${args.join(' ')}`);
  const result = spawnSync(gitleaks, args, { cwd: repositoryRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('secret scan failed: treat each finding as real until checked, and rotate anything exposed');
    process.exit(result.status ?? 1);
  }
}
console.log('\nno leaks found in the working tree or the commit history');
