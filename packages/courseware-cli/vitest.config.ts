// SPDX-License-Identifier: AGPL-3.0-only
// The CLI suite is node:test (`*.test.ts`, run by `pnpm test`); the few vitest
// suites use the `*.spec.ts` suffix so the two runners never pick up each other's files.
export default {
  test: {
    name: 'courseware-cli',
    include: ['cli/**/*.spec.ts'],
  },
};
