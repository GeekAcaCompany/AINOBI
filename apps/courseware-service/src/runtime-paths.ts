// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory containing the running bundle (`dist/` locally, `/code` on FC). */
export const runtimeDir = dirname(fileURLToPath(import.meta.url));

const cliBesideRuntime = resolve(runtimeDir, 'ainobi-courseware-cli');
const cliBin = resolve(cliBesideRuntime, 'bin', 'ainobi.mjs');

/** Repo root in dev (`dist/` parent); deploy root on FC (`/code`). */
export const projectRoot = existsSync(cliBin)
  ? runtimeDir
  : resolve(runtimeDir, '..');

/**
 * AINOBI CLI package root: staged beside the bundle in deploy (prepare-deploy copies it
 * there), otherwise the `@ainobi/courseware-cli` workspace package.
 */
export const coursewareCliRoot = existsSync(cliBin)
  ? cliBesideRuntime
  : dirname(createRequire(import.meta.url).resolve('@ainobi/courseware-cli/package.json'));

/**
 * The CLI entry script. Host-side spawns run it with the current node (`process.execPath`) instead of looking
 * `ainobi` up on PATH: on Windows the `bin/ainobi` symlink checks out as a plain file and the pnpm `.CMD`
 * shim needs a shell, so a PATH lookup fails with ENOENT there.
 */
export const ainobiCliEntry = resolve(coursewareCliRoot, 'bin', 'ainobi.mjs');
