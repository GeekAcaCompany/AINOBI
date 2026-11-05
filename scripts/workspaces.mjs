// SPDX-License-Identifier: AGPL-3.0-only
// Lists the workspace directories declared in pnpm-workspace.yaml the way pnpm resolves them:
// every directory that matches a `<group>/*` glob and contains a package.json. Shared by the
// root vitest configuration, the type-check runner, and the repository checks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} repositoryRoot Absolute path of the repository root.
 * @returns {string[]} Workspace directories relative to the root, with `/` separators, sorted.
 */
export function listWorkspaceDirectories(repositoryRoot) {
  return readWorkspacePatterns(join(repositoryRoot, 'pnpm-workspace.yaml')).flatMap((pattern) => {
    if (!pattern.endsWith('/*')) {
      throw new Error(`workspace pattern ${pattern} is not of the form <group>/*`);
    }
    const group = pattern.slice(0, -2);
    if (!existsSync(join(repositoryRoot, group))) {
      return [];
    }
    return readdirSync(join(repositoryRoot, group), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(repositoryRoot, group, entry.name, 'package.json')),
      )
      .map((entry) => `${group}/${entry.name}`)
      .sort();
  });
}

// Reads the `packages:` list from pnpm-workspace.yaml. The file is kept to comments plus that
// one list of glob strings; any other YAML shape is a configuration error for this repository.
export function readWorkspacePatterns(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const patterns = [];
  let inPackages = false;
  for (const line of lines) {
    const content = line.replace(/#.*$/, '').trim();
    if (content === '') {
      continue;
    }
    if (!inPackages) {
      if (content === 'packages:') {
        inPackages = true;
      }
      continue;
    }
    if (!content.startsWith('-')) {
      break;
    }
    patterns.push(content.slice(1).trim().replace(/^['"]|['"]$/g, ''));
  }
  if (!inPackages) {
    throw new Error(`${path} must declare a packages: list`);
  }
  return patterns;
}
