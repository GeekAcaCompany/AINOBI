#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pack `codex-plugins/ainobi-courseware` into `public/ainobi-courseware-codex-plugin.zip`.
 *
 * Keeps `{{MCP_URL}}` placeholders in the zip. The HTTP download handler
 * (`src/services/codex-plugin-zip.ts`) injects the hosted MCP URL at request time
 * from AINOBI_PUBLIC_BASE_URL / AINOBI_COURSEWARE_AGENT_BASE_URL / request Host.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginSrc = resolve(root, 'codex-plugins', 'ainobi-courseware');
const publicDir = resolve(root, 'public');
const zipName = 'ainobi-courseware-codex-plugin.zip';
const zipOut = join(publicDir, zipName);

if (!existsSync(pluginSrc)) {
  throw new Error(`Missing plugin source: ${pluginSrc}`);
}
if (!existsSync(join(pluginSrc, 'INSTALL.md'))) {
  throw new Error('Missing INSTALL.md in codex-plugins/ainobi-courseware (required in zip)');
}
if (!existsSync(join(pluginSrc, '.codex-plugin', 'plugin.json'))) {
  throw new Error('Missing .codex-plugin/plugin.json');
}

/** Everything under dir as fflate entries in sorted order, with forward slashes. */
function zipEntries(dir, prefix) {
  const entries = {};
  const options = { mtime: new Date(2000, 0, 1) };
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const zipPath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(entries, zipEntries(join(dir, entry.name), zipPath));
    else entries[zipPath] = [readFileSync(join(dir, entry.name)), options];
  }
  return entries;
}

mkdirSync(publicDir, { recursive: true });
rmSync(zipOut, { force: true });

const stagingRoot = mkdtempSync(join(tmpdir(), 'ainobi-codex-plugin-'));
const staged = join(stagingRoot, 'ainobi-courseware');
try {
  cpSync(pluginSrc, staged, {
    recursive: true,
    filter: (src) => {
      const base = src.split(/[/\\]/).pop() ?? '';
      if (base === 'node_modules' || base === '.DS_Store' || base === 'agent-workspaces') {
        return false;
      }
      return true;
    },
  });

  try {
    execFileSync('zip', ['-r', '-q', zipOut, 'ainobi-courseware'], {
      cwd: stagingRoot,
      stdio: 'inherit',
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // No system zip (Windows). Entries are sorted and carry a fixed local time, so the result is stable.
    writeFileSync(zipOut, zipSync(zipEntries(staged, 'ainobi-courseware'), { level: 9 }));
  }
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

if (!existsSync(zipOut)) {
  throw new Error(`Failed to create ${zipOut}`);
}

console.log(
  `[pack-codex-plugin] wrote ${zipOut} (MCP URL placeholders kept; injected on download)`,
);
