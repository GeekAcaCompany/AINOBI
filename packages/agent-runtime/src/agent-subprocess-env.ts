// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Allowlisted environment for Claude Agent SDK subprocesses. The host owns the key lists
 * (they are its security policy: what an LLM-driven shell may see); this module owns the
 * mechanism.
 */

/** Process basics every agent subprocess inherits from the host environment. */
export const AGENT_BASE_INHERIT_KEYS: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'LD_LIBRARY_PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'AINOBI_SHELL_SESSION',
];

/** Keys the host's Claude env builder injects (never inherited). */
export const AGENT_BASE_INJECT_KEYS: readonly string[] = [
  'PATH',
  'AINOBI_SHELL_SESSION',
  'AINOBI_CLI_RUNTIME',
  'AINOBI_AGENT_API_KEY',
  'CLAUDE_AGENT_SDK_CLIENT_APP',
];

/**
 * When the host sets no locale (container base images default to POSIX), fall back to UTF-8 for the agent subprocess: under POSIX
 * awk substr / cut -c / printf %.Ns truncate by byte and split CJK characters in half into the output (�).
 */
export const AGENT_DEFAULT_UTF8_LOCALE = 'C.UTF-8';

const isUtf8Locale = (value: string | undefined): boolean => /utf-?8/i.test(value ?? '');

export type AgentSubprocessEnvPolicy = {
  /** The host environment picked from when no explicit source is given. */
  hostEnv: () => NodeJS.ProcessEnv;
  /** Inherited from the host environment. */
  inheritKeys: Iterable<string>;
  /** Accepted only as overrides from the host's env builder. */
  injectKeys: Iterable<string>;
  /** Host-set tool / persistence / session keys, accepted only as overrides. */
  hostKeys: Iterable<string>;
  /** On Linux, force UTF-8 LANG / LC_ALL when the inherited values are not UTF-8. */
  utf8LocaleFallback: boolean;
};

export type PickAgentSubprocessEnv = (
  source?: NodeJS.ProcessEnv,
  overrides?: Record<string, string | undefined>,
  platform?: NodeJS.Platform,
) => NodeJS.ProcessEnv;

export function createAgentSubprocessEnvPicker(policy: AgentSubprocessEnvPolicy): PickAgentSubprocessEnv {
  const inherit = new Set(policy.inheritKeys);
  const override = new Set([...inherit, ...policy.injectKeys, ...policy.hostKeys]);

  return (source = policy.hostEnv(), overrides = {}, platform = process.platform) => {
    const env: NodeJS.ProcessEnv = {};

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || !inherit.has(key)) {
        continue;
      }
      env[key] = value;
    }

    if (policy.utf8LocaleFallback && platform === 'linux') {
      if (!isUtf8Locale(env.LANG)) env.LANG = AGENT_DEFAULT_UTF8_LOCALE;
      // LC_ALL has the highest priority: a non-UTF-8 LC_ALL (e.g. C / POSIX) overrides LANG, so it gets the same fallback.
      if (!isUtf8Locale(env.LC_ALL)) env.LC_ALL = AGENT_DEFAULT_UTF8_LOCALE;
    }

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else if (override.has(key)) {
        env[key] = value;
      }
    }

    return env;
  };
}
