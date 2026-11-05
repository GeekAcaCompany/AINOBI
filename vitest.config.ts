// SPDX-License-Identifier: AGPL-3.0-only
// Root vitest configuration in projects mode: every workspace directory is a project, and the
// repository checks under scripts/ form the `repo` project. Unit tests live next to the
// source of each workspace; a workspace that needs its own settings adds a vitest config.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { listWorkspaceDirectories } from './scripts/workspaces.mjs';

export default defineConfig({
  test: {
    projects: [
      ...listWorkspaceDirectories(fileURLToPath(new URL('.', import.meta.url))).filter((dir) => !dir.startsWith('apps/')),
      {
        test: {
          name: 'repo',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
  },
});
