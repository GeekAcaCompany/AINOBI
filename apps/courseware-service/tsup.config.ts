// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  sourcemap: true,
  dts: true,
  clean: true,
  publicDir: "public",
  /** Workspace component packages export .ts sources and must go into the bundle (Node doesn't strip TS inside node_modules) */
  noExternal: [/^@ainobi\//],
  /** CJS packages must stay external: bundled into ESM they throw "Dynamic require of ..." at
   *  runtime (ali-oss: "tty"; undici via tts-google/tts-fishaudio: "node:assert") */
  external: ["ali-oss", "openai", "undici", "@modelcontextprotocol/sdk", "@the-next-ai/ai-gateway"],
});
