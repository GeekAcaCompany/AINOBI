// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The single source of the CLI's configuration. Every module reads its settings through
 * `cliEnv()` instead of `process.env`, so a host that imports the CLI modules as a library
 * (the courseware service runs narration, assets, and TTS in-process) can supply its own
 * settings per call with `runWithCliEnv`, without mutating its process environment and
 * without concurrent calls seeing each other's values.
 *
 * In the CLI process nothing is scoped and `cliEnv()` is `process.env` itself, so reads and
 * writes behave exactly as before. CONFIGURATION.md lists every key.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const scoped = new AsyncLocalStorage<NodeJS.ProcessEnv>();

/** The environment the CLI reads: the innermost `runWithCliEnv` scope, else `process.env`. */
export const cliEnv = (): NodeJS.ProcessEnv => scoped.getStore() ?? process.env;

/**
 * Runs `fn` (and everything it awaits) with `overrides` layered over the current environment.
 * Writes inside the scope stay in the scope; `undefined` removes a key for the scope.
 */
export const runWithCliEnv = <T>(overrides: Readonly<Record<string, string | undefined>>, fn: () => T): T => {
  const env: NodeJS.ProcessEnv = { ...cliEnv() };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return scoped.run(env, fn);
};
