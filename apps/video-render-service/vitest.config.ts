// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "vitest/config";

// Two test runners live in this repo:
//   1. `vitest` for a small set of shared serialization / quiz tests under `src/`.
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/deploy/**",
      "**/.git/**",
      // src/**/*.test.ts uses node:test (`node --test`); the whole `src/`
      // tree is owned by the standalone node:test suite, not vitest.
      "src/**",
    ],
  },
});
