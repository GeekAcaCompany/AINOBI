// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  AGENT_BASE_INHERIT_KEYS,
  AGENT_BASE_INJECT_KEYS,
  AGENT_DEFAULT_UTF8_LOCALE,
  createAgentSubprocessEnvPicker,
} from './agent-subprocess-env.ts';

const policy = (utf8LocaleFallback: boolean) => ({
  hostEnv: () => ({ PATH: '/bin', SECRET: 'x', LANG: 'C' }),
  inheritKeys: AGENT_BASE_INHERIT_KEYS,
  injectKeys: AGENT_BASE_INJECT_KEYS,
  hostKeys: ['AINOBI_STATE_DIR'],
  utf8LocaleFallback,
});

describe('createAgentSubprocessEnvPicker', () => {
  it('inherits only allowlisted host keys', () => {
    const env = createAgentSubprocessEnvPicker(policy(false))(undefined, {}, 'linux');
    expect(env).toEqual({ PATH: '/bin', LANG: 'C' });
  });

  it('accepts overrides only for known keys and deletes on undefined', () => {
    const env = createAgentSubprocessEnvPicker(policy(false))(
      undefined,
      { AINOBI_STATE_DIR: '/s', ANTHROPIC_API_KEY: 'k', PATH: undefined },
      'linux',
    );
    expect(env).toEqual({ LANG: 'C', AINOBI_STATE_DIR: '/s' });
  });

  it('forces a UTF-8 locale on Linux only when the host opts in', () => {
    const pick = createAgentSubprocessEnvPicker(policy(true));
    expect(pick(undefined, {}, 'linux')).toMatchObject({
      LANG: AGENT_DEFAULT_UTF8_LOCALE,
      LC_ALL: AGENT_DEFAULT_UTF8_LOCALE,
    });
    expect(pick(undefined, {}, 'darwin').LANG).toBe('C');
  });
});
