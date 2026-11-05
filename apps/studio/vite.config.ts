// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const publicDir = fileURLToPath(new URL('./public', import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), react()],
  publicDir: existsSync(publicDir) ? publicDir : fileURLToPath(new URL('../student-frontend/public', import.meta.url)),
  build: { outDir: 'dist', chunkSizeWarningLimit: 8000, target: 'es2022' },
});
