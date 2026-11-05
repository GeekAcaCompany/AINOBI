// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { pickAgentSubprocessEnv } from './agent-subprocess-env.ts';
import {
  buildHostNarrationEnv,
  pickNarrationHostSubprocessEnv,
} from './agent-narration-host-env.ts';
import { AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV } from '@ainobi/courseware-cli/cli/tts-pronunciation-apply.ts';

test('pickAgentSubprocessEnv excludes secrets and Anthropic keys (set in buildClaudeEnv)', () => {
  const env = pickAgentSubprocessEnv({
    PATH: '/bin',
    ANTHROPIC_API_KEY: 'sk-test',
    ANTHROPIC_BASE_URL: 'https://api.example.com',
    DB_HOST: 'db.internal',
    MINIMAX_API_KEY: 'mm-key',
    OSS_BUCKET: 'bucket',
    AINOBI_COURSEWARE_KEY: 'cw-key',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'other-app',
  });

  assert.equal(env.PATH, '/bin');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.AINOBI_COURSEWARE_KEY, undefined);
  assert.equal(env.CLAUDE_AGENT_SDK_CLIENT_APP, undefined);
  assert.equal(env.DB_HOST, undefined);
  assert.equal(env.MINIMAX_API_KEY, undefined);
  assert.equal(env.OSS_BUCKET, undefined);
});

test('pickAgentSubprocessEnv defaults a UTF-8 locale on Linux so shell tools count characters', () => {
  // The container base image sets no LANG (POSIX): awk substr / cut -c would cut Chinese/Japanese by byte.
  const bare = pickAgentSubprocessEnv({ PATH: '/bin' }, {}, 'linux');
  assert.equal(bare.LANG, 'C.UTF-8');
  assert.equal(bare.LC_ALL, 'C.UTF-8');

  const posix = pickAgentSubprocessEnv({ PATH: '/bin', LANG: 'en_US.UTF-8', LC_ALL: 'C' }, {}, 'linux');
  assert.equal(posix.LANG, 'en_US.UTF-8');
  assert.equal(posix.LC_ALL, 'C.UTF-8');

  const utf8 = pickAgentSubprocessEnv({ PATH: '/bin', LANG: 'ja_JP.utf8', LC_ALL: 'ja_JP.utf8' }, {}, 'linux');
  assert.equal(utf8.LANG, 'ja_JP.utf8');
  assert.equal(utf8.LC_ALL, 'ja_JP.utf8');

  const mac = pickAgentSubprocessEnv({ PATH: '/bin' }, {}, 'darwin');
  assert.equal(mac.LANG, undefined);
  assert.equal(mac.LC_ALL, undefined);
});

test('pickNarrationHostSubprocessEnv forwards TTS/OSS keys only', () => {
  const env = pickNarrationHostSubprocessEnv({
    PATH: '/bin',
    OSS_BUCKET: 'bucket',
    MINIMAX_API_KEY: 'mm-key',
    FISH_AUDIO_API_KEY: 'fish-key',
    ALIYUN_ACCESS_KEY_ID: 'ak',
    AINOBI_TTS_STUB: '1',
    ANTHROPIC_API_KEY: 'sk-test',
  });

  assert.equal(env.OSS_BUCKET, 'bucket');
  assert.equal(env.MINIMAX_API_KEY, 'mm-key');
  assert.equal(env.FISH_AUDIO_API_KEY, 'fish-key');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

test('buildHostNarrationEnv scopes the pronunciation dict file path to the child env', () => {
  const prev = process.env[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV];
  try {
    process.env[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV] = '/tmp/stale/dict.json';
    const withDict = buildHostNarrationEnv({
      workspace_dir: '/tmp/ws',
      state_dir: '/tmp/ws/.ainobi-cli',
      argv: ['narration', 'insert', '0'],
      pretty: true,
      pronunciation_dict_file: '/tmp/ainobi-tts-dict-xyz/dict.json',
    });
    assert.equal(
      withDict[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV],
      '/tmp/ainobi-tts-dict-xyz/dict.json',
    );

    const cleared = buildHostNarrationEnv({
      workspace_dir: '/tmp/ws',
      state_dir: '/tmp/ws/.ainobi-cli',
      argv: ['narration', 'insert', '0'],
      pretty: true,
      pronunciation_dict_file: null,
    });
    assert.equal(cleared[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV], undefined);

    // Host process.env must stay unchanged by child scoping.
    assert.equal(process.env[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV], '/tmp/stale/dict.json');
  } finally {
    if (prev === undefined) delete process.env[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV];
    else process.env[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV] = prev;
  }
});

test('pickAgentSubprocessEnv applies ainobi override keys only', () => {
  const env = pickAgentSubprocessEnv(
    { AINOBI_SHELL_SESSION: 'old' },
    {
      AINOBI_SHELL_SESSION: 'shell-1',
      AINOBI_CLI_RUNTIME: 'agent',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      OSS_BUCKET: 'should-not-apply',
    },
  );

  assert.equal(env.AINOBI_SHELL_SESSION, 'shell-1');
  assert.equal(env.AINOBI_CLI_RUNTIME, 'agent');
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.OSS_BUCKET, undefined);
});

test('pickAgentSubprocessEnv forwards host courseware and asset URL overrides', () => {
  const env = pickAgentSubprocessEnv(
    {},
    {
      AINOBI_COURSEWARE_ID: 'f584b861-a2a4-4790-92f2-a2d190fc8de4',
      AINOBI_COURSEWARE_ASSET_GET_URL: 'http://127.0.0.1:5633/courseware/assets/get',
    },
  );

  assert.equal(env.AINOBI_COURSEWARE_ID, 'f584b861-a2a4-4790-92f2-a2d190fc8de4');
  assert.equal(env.AINOBI_COURSEWARE_ASSET_GET_URL, 'http://127.0.0.1:5633/courseware/assets/get');
});
