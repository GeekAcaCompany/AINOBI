// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'] } });
