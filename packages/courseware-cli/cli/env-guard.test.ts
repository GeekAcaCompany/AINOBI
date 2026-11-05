// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('.', import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(name) ? [path] : [];
  });

// Configuration is read through cli/env.ts only, so hosts can scope it per call (see CONFIGURATION.md).
test('CLI modules read the environment only through cliEnv()', () => {
  const offenders = sources(cliDir)
    .filter((file) => relative(cliDir, file) !== 'env.ts')
    .filter((file) => /process\.env\b/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(cliDir, file));
  assert.deepEqual(offenders, []);
});
