// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/jobs/job-entry.ts"],
  format: ["esm"],
  sourcemap: true,
  dts: true,
  clean: true,
  publicDir: "public",
  /** Workspace component packages export .ts sources and must go into the bundle (Node doesn't strip TS inside node_modules) */
  noExternal: [/^@ainobi\//],
  /** ali-oss is CJS; bundled into ESM it triggers errors like Dynamic require of "tty" at runtime */
  external: ["ali-oss", "openai", "@hyperframes/producer", "@hyperframes/core", "@hyperframes/engine"],
});
