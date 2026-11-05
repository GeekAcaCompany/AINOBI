// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHostNarrationEnv,
  pickNarrationHostSubprocessEnv,
} from './agent-narration-host-env.ts';

const DICT_FILE_ENV = 'AINOBI_TTS_PRONUNCIATION_DICT_FILE';
const KANA_FILE_ENV = 'AINOBI_TTS_JA_KANA_LINES_FILE';

const baseJob = {
  workspace_dir: '/tmp/ainobi-ws',
  state_dir: '/tmp/ainobi-state',
  argv: ['narration', 'insert', '0'],
  pretty: false,
};

/** Run `fn` with the given host env keys set, restoring the previous values afterwards. */
async function withHostEnv(
  values: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('pickNarrationHostSubprocessEnv never forwards host dict-file / kana-line-file values', () => {
  const env = pickNarrationHostSubprocessEnv({
    PATH: '/usr/bin',
    MINIMAX_API_KEY: 'k',
    [DICT_FILE_ENV]: '/tmp/stale/dict.json',
    [KANA_FILE_ENV]: '/tmp/stale/lines.json',
    DB_HOST: 'db',
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.MINIMAX_API_KEY, 'k');
  assert.equal(DICT_FILE_ENV in env, false);
  assert.equal(KANA_FILE_ENV in env, false);
  assert.equal('DB_HOST' in env, false);
});

test('buildHostNarrationEnv: dict file path comes only from the job, never from a stale host env', async () => {
  await withHostEnv({ [DICT_FILE_ENV]: '/tmp/stale/dict.json' }, () => {
    const inherited = buildHostNarrationEnv({ ...baseJob });
    assert.equal(DICT_FILE_ENV in inherited, false);

    const cleared = buildHostNarrationEnv({ ...baseJob, pronunciation_dict_file: null });
    assert.equal(DICT_FILE_ENV in cleared, false);

    const file = '/tmp/ainobi-tts-dict-abc123/dict.json';
    const injected = buildHostNarrationEnv({ ...baseJob, pronunciation_dict_file: file });
    assert.equal(injected[DICT_FILE_ENV], file);
  });
});

test('buildHostNarrationEnv: kana line map file path comes only from the job', async () => {
  await withHostEnv({ [KANA_FILE_ENV]: '/tmp/stale/lines.json' }, () => {
    const inherited = buildHostNarrationEnv({ ...baseJob });
    assert.equal(KANA_FILE_ENV in inherited, false);

    const cleared = buildHostNarrationEnv({ ...baseJob, ja_kana_lines_file: null });
    assert.equal(KANA_FILE_ENV in cleared, false);

    const file = '/tmp/ainobi-ja-kana-abc123/lines.json';
    const injected = buildHostNarrationEnv({ ...baseJob, ja_kana_lines_file: file });
    assert.equal(injected[KANA_FILE_ENV], file);
  });
});
