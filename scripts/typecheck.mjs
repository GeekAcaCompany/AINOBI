// SPDX-License-Identifier: AGPL-3.0-only
// Runs `tsc -p <dir>` for every workspace and for scripts/ from the repository root, so that
// reported paths name the workspace; continues after a failure and lists what failed.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorkspaceDirectories } from './workspaces.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(
  dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin',
  'tsc',
);
// Apps carry their own TypeScript version and check themselves in CI.
const projects = [...listWorkspaceDirectories(repositoryRoot).filter((dir) => !dir.startsWith('apps/')), 'scripts'];
const failed = [];

for (const project of projects) {
  console.log(`tsc -p ${project}`);
  const { status } = spawnSync(process.execPath, [tsc, '-p', project], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (status !== 0) {
    failed.push(project);
  }
}

if (failed.length > 0) {
  console.error(`Type check failed in: ${failed.join(', ')}`);
  process.exit(1);
}
