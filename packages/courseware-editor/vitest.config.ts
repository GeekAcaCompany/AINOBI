// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [fileURLToPath(new URL('../courseware-player/tests/setup.ts', import.meta.url))],
    css: true,
    testTimeout: 20_000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
