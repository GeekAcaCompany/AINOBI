#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The one command a new user runs. Needs only Node.js: npm comes with it and fetches the package manager, so nothing
// else has to be installed first. Installs dependencies and builds on the first run, then starts Studio.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../..');
const PNPM = 'pnpm@10.5.0';

/** Node releases the toolchain supports: an even major from 22 on, and 22 itself from 22.12. */
export function isSupportedNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (major === 22) return minor >= 12;
  return major >= 24 && major % 2 === 0;
}

// What must exist before Studio can start, and the package that builds it.
export const BUILD_STEPS = [
  { output: 'packages/lite-stores/dist/index.js', filter: '@ainobi/lite-stores' },
  { output: 'packages/avatar-generator/dist/index.js', filter: '@ainobi/avatar-generator' },
  { output: 'packages/tts/dist/styles.js', filter: '@ainobi/tts' },
  { output: 'apps/courseware-service/dist/index.js', filter: 'ainobi-courseware-service' },
  { output: 'apps/studio/dist/index.html', filter: '@ainobi/studio' },
];

export const stepsToRun = (steps, exists, force = false) => steps.filter((step) => force || !exists(step.output));

function pnpm(args) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const { status, error } = spawnSync(npx, ['--yes', PNPM, ...args], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (error) throw error;
  if (status !== 0) throw new Error(`pnpm ${args.join(' ')} failed`);
}

function main(argv) {
  if (!isSupportedNode(process.version)) {
    console.error(`AINOBI needs Node.js 22.12 or later on an even-numbered line (22, 24, 26, ...); this is ${process.version}.`);
    return 1;
  }
  const rebuild = argv.includes('--rebuild');
  if (!existsSync(join(repositoryRoot, 'node_modules/.modules.yaml'))) {
    console.log('[ainobi] installing dependencies (first run only)');
    pnpm(['install', '--frozen-lockfile']);
  }
  for (const step of stepsToRun(BUILD_STEPS, (path) => existsSync(join(repositoryRoot, path)), rebuild)) {
    console.log(`[ainobi] building ${step.filter}`);
    pnpm(['--filter', step.filter, 'build']);
  }
  const child = spawn(process.execPath, [join(here, 'start.mjs')], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const code = main(process.argv.slice(2));
    if (code !== undefined) process.exit(code);
  } catch (error) {
    console.error(`[ainobi] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
