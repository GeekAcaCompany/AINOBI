// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRenderTaskBillingRedisAvailable,
  savePendingRenderTaskBilling,
  takePendingRenderTaskBilling,
} from './render-task-billing.ts';

async function withEnv<T>(name: string, value: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('isRenderTaskBillingRedisAvailable reflects REDIS_HOST presence', async () => {
  await withEnv('REDIS_HOST', undefined, () => {
    assert.equal(isRenderTaskBillingRedisAvailable(), false);
  });
  await withEnv('REDIS_HOST', 'localhost', () => {
    assert.equal(isRenderTaskBillingRedisAvailable(), true);
  });
});

test('savePendingRenderTaskBilling / takePendingRenderTaskBilling no-op safely without Redis configured', async () => {
  await withEnv('REDIS_HOST', undefined, async (): Promise<void> => {
    await savePendingRenderTaskBilling('task-without-redis', {
      accessToken: 'token',
      orgId: 'org-1',
      coursewareId: 'cw-1',
      userId: 'user-1',
    });
    const result = await takePendingRenderTaskBilling('task-without-redis');
    assert.equal(result, null);
  });
});
