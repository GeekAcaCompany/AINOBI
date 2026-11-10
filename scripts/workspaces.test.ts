// SPDX-License-Identifier: AGPL-3.0-only
// Repository rules: the license on every workspace and source file, a catalog that matches the packages, and
// the third-party material that must stay outside the AGPL.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packageClosure, readPackageManifests } from './add.mjs';
import { listWorkspaceDirectories } from './workspaces.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const LICENSE = 'AGPL-3.0-only';
// Vendored third-party material keeps its own license; THIRD_PARTY_NOTICES.md records each of these.
const VENDORED = ['packages/inochi2d/', 'apps/video-render-service/runtime/'];
const SOURCE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SPDX = new RegExp(`^(?:#![^\\n]*\\n)?// SPDX-License-Identifier: ${LICENSE}\\n`);

const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file && existsSync(join(root, file)));
const isVendored = (file: string) => VENDORED.some((prefix) => file.startsWith(prefix));
const manifests = readPackageManifests(root);
const catalog = JSON.parse(readFileSync(join(root, 'components.json'), 'utf8'));

describe('licensing', () => {
  it('declares the project license on every workspace written for AINOBI', () => {
    const wrong = listWorkspaceDirectories(root)
      .filter((dir) => !isVendored(`${dir}/`))
      .map((dir) => [dir, JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).license])
      .filter(([, license]) => license !== LICENSE);
    expect(wrong).toEqual([]);
  });

  it('starts every source file written for AINOBI with the SPDX header', () => {
    const missing = tracked
      .filter((file) => SOURCE.has(extname(file)) && !isVendored(file) && !file.endsWith('.d.ts'))
      .filter((file) => !SPDX.test(readFileSync(join(root, file), 'utf8')));
    expect(missing).toEqual([]);
  });

  it('records each piece of vendored material in the notices', () => {
    const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('Inochi2D');
  });
});

describe('component catalog', () => {
  it('names only packages and services that exist', () => {
    for (const profile of Object.values<{ packages: string[]; services: string[] }>(catalog.profiles)) {
      for (const name of profile.packages) expect(manifests.has(name), name).toBe(true);
      for (const name of profile.services) expect(catalog.services[name], name).toBeDefined();
    }
    for (const { directory } of Object.values<{ directory: string }>(catalog.services)) {
      expect(existsSync(join(root, directory, 'package.json')), directory).toBe(true);
    }
  });

  it('keeps the avatar profile free of the player and the service', () => {
    const closure = packageClosure(catalog.profiles.avatar.packages, manifests);
    expect(closure).toContain('@ainobi/avatar');
    expect(closure).not.toContain('@ainobi/courseware-player');
    expect(catalog.profiles.avatar.services).toEqual([]);
  });
});

describe('packageClosure', () => {
  const graph = new Map<string, { dependencies?: Record<string, string> }>([
    ['a', { dependencies: { b: 'workspace:0.1.0', lodash: '^4' } }],
    ['b', { dependencies: { c: 'workspace:*' } }],
    ['c', {}],
  ]);

  it('lists dependencies first and leaves registry packages out', () => {
    expect(packageClosure(['a'], graph as never)).toEqual(['c', 'b', 'a']);
  });

  it('refuses a name that does not exist', () => {
    expect(() => packageClosure(['nope'], graph as never)).toThrow(/not a package/);
  });
});
