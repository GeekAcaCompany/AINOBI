// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { chatStreamKeyForSession, resolveRedisConfig } from './redis-stream.ts';

test('chat stream key uses interaction namespace', () => {
  assert.equal(chatStreamKeyForSession('cs-1'), 'ainobi:interaction:session:chat:cs-1:events');
});

test('resolveRedisConfig uses REDIS_HOST and related vars, not REDIS_URL', () => {
  const keys = [
    'REDIS_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_DB',
    'REDIS_LAZY_CONNECT',
    'REDIS_USER',
    'REDIS_PASSWORD',
  ] as const;
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<
    (typeof keys)[number],
    string | undefined
  >;

  try {
    process.env.REDIS_URL = 'redis://ignored:6399/9';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_DB = '0';
    process.env.REDIS_LAZY_CONNECT = 'false';
    delete process.env.REDIS_USER;
    delete process.env.REDIS_PASSWORD;

    const config = resolveRedisConfig();
    assert.ok(config);
    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 6379);
    assert.equal(config.db, 0);
    assert.equal(config.lazyConnect, false);
  } finally {
    for (const key of keys) {
      const value = prior[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
