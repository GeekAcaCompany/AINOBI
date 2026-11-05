#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Wrapper that runs the TypeScript CLI via Node's supported --import hook.
// This keeps the binary self-contained while letting us author the CLI in TS.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const entry = resolve(__dirname, "..", "cli", "index.ts");
// Resolve the tsx loader from this package, not from the caller's cwd: a bare `--import tsx` is resolved
// against the working directory, and agent workspaces live outside the package tree. The file: URL also
// keeps Windows drive paths from being read as a URL scheme.
const tsxLoader = import.meta.resolve("tsx");
const env = {
  ...process.env,
  AINOBI_SHELL_SESSION: process.env.AINOBI_SHELL_SESSION ?? `ppid-${process.ppid}`,
};
const result = spawnSync(
  process.execPath,
  ["--import", tsxLoader, entry, ...process.argv.slice(2)],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env,
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (result.stdout?.length) {
  process.stdout.write(result.stdout);
}
if (result.stderr?.length) {
  process.stderr.write(result.stderr);
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
