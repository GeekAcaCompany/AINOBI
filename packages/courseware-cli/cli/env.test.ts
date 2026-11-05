// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { cliEnv, runWithCliEnv } from './env.ts';

test('cliEnv is process.env outside any scope', () => {
  assert.equal(cliEnv(), process.env);
});

test('runWithCliEnv layers overrides, removes undefined keys, and keeps writes in the scope', () => {
  process.env.AINOBI_ENV_TEST_KEEP = 'outer';
  process.env.AINOBI_ENV_TEST_DROP = 'outer';
  try {
    runWithCliEnv({ AINOBI_ENV_TEST_SET: 'inner', AINOBI_ENV_TEST_DROP: undefined }, () => {
      assert.equal(cliEnv().AINOBI_ENV_TEST_KEEP, 'outer');
      assert.equal(cliEnv().AINOBI_ENV_TEST_SET, 'inner');
      assert.equal(cliEnv().AINOBI_ENV_TEST_DROP, undefined);
      cliEnv().AINOBI_ENV_TEST_WRITE = 'scoped';
    });
    assert.equal(process.env.AINOBI_ENV_TEST_SET, undefined);
    assert.equal(process.env.AINOBI_ENV_TEST_DROP, 'outer');
    assert.equal(process.env.AINOBI_ENV_TEST_WRITE, undefined);
  } finally {
    delete process.env.AINOBI_ENV_TEST_KEEP;
    delete process.env.AINOBI_ENV_TEST_DROP;
  }
});

test('concurrent scopes do not see each other across awaits', async () => {
  const read = (value: string) =>
    runWithCliEnv({ AINOBI_ENV_TEST_FORMAT: value }, async () => {
      await new Promise((resolve) => setTimeout(resolve, value === 'a' ? 20 : 1));
      return cliEnv().AINOBI_ENV_TEST_FORMAT;
    });
  assert.deepEqual(await Promise.all([read('a'), read('b')]), ['a', 'b']);
  assert.equal(process.env.AINOBI_ENV_TEST_FORMAT, undefined);
});
