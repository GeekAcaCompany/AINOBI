// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __setRenderTaskBillingRedisForTests,
  savePendingRenderTaskBilling,
} from '../models/render-task-billing.ts';
import {
  computeVideoRenderBillableMinutes,
  maybeBillCompletedRenderTask,
  resolveVideoRenderBillableTakesMs,
} from './video-render-credits.ts';

function createInMemoryBillingRedis() {
  const store = new Map<string, string>();
  return {
    status: 'ready',
    async connect() {},
    async set(key: string, value: string) {
      store.set(key, value);
    },
    async eval(_script: string, _numKeys: number, key: string) {
      const value = store.get(key) ?? null;
      if (value !== null) store.delete(key);
      return value;
    },
  };
}

__setRenderTaskBillingRedisForTests(createInMemoryBillingRedis());

function withEnv<T>(entries: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(entries)) {
    previous[key] = process.env[key];
    const value = entries[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('computeVideoRenderBillableMinutes ceils computeTakes to minutes (min 1)', () => {
  assert.equal(computeVideoRenderBillableMinutes(330_000), 6);
  assert.equal(computeVideoRenderBillableMinutes(300_000), 5);
  assert.equal(computeVideoRenderBillableMinutes(12_345), 1);
});

test('resolveVideoRenderBillableTakesMs prefers computeTakes over wall takes', () => {
  assert.equal(
    resolveVideoRenderBillableTakesMs({
      id: 't',
      status: 'completed',
      result: { render: { takes: 60_000, computeTakes: 900_000 } },
    }),
    900_000,
  );
  assert.equal(
    resolveVideoRenderBillableTakesMs({
      id: 't',
      status: 'completed',
      result: { render: { takes: 90_000 } },
    }),
    90_000,
  );
  assert.equal(
    resolveVideoRenderBillableTakesMs({ id: 't', status: 'completed', result: {} }),
    null,
  );
});

test('maybeBillCompletedRenderTask skips non-completed tasks', async () => {
  const outcome = await maybeBillCompletedRenderTask({ id: 'task-1', status: 'failed' });
  assert.equal(outcome.kind, 'skipped');
});

test('maybeBillCompletedRenderTask skips when billing is disabled (no service code configured)', async () => {
  await withEnv({ AINOBI_VIDEO_RENDER_CREDITS_SERVICE_CODE: undefined, REDIS_HOST: 'localhost' }, async () => {
    const outcome = await maybeBillCompletedRenderTask({
      id: 'task-2',
      status: 'completed',
      result: { render: { computeTakes: 5000 } },
    });
    assert.equal(outcome.kind, 'skipped');
  });
});

test('maybeBillCompletedRenderTask skips when there is no pending billing record', async () => {
  await withEnv(
    { AINOBI_VIDEO_RENDER_CREDITS_SERVICE_CODE: 'video-render-1080p', REDIS_HOST: 'localhost' },
    async () => {
      const outcome = await maybeBillCompletedRenderTask({
        id: 'task-without-pending-record',
        status: 'completed',
        result: { render: { computeTakes: 5000 } },
      });
      assert.equal(outcome.kind, 'skipped');
    },
  );
});

test('maybeBillCompletedRenderTask charges ceil(computeTakes/60000), min 1, and is idempotent', async () => {
  await withEnv(
    { AINOBI_VIDEO_RENDER_CREDITS_SERVICE_CODE: 'video-render-1080p', REDIS_HOST: 'localhost' },
    async () => {
      const taskId = `task-${Date.now()}`;
      await savePendingRenderTaskBilling(taskId, {
        accessToken: 'token-abc',
        orgId: 'org-1',
        coursewareId: 'cw-1',
        userId: 'user-1',
      });

      const capturedBodies: Record<string, unknown>[] = [];
      const prevFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            code: 0,
            success: true,
            data: {
              service_code: 'video-render-1080p',
              consumption_type: 'organization',
              amount_unit: 'tokens',
              org_id: 'org-1',
              credits_consumed: '6',
              remaining_credits: '94',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch;

      try {
        const task = {
          id: taskId,
          status: 'completed',
          // Short wall clock (parallel), long summed instance compute
          result: { render: { takes: 20 * 60_000, computeTakes: 330_000 } },
        };
        const first = await maybeBillCompletedRenderTask(task);
        assert.equal(first.kind, 'charged');
        if (first.kind === 'charged') {
          assert.equal(first.minutes, 6);
          assert.equal(first.billableTakesMs, 330_000);
        }
        assert.equal(capturedBodies.length, 1);
        assert.equal(capturedBodies[0]?.unit_count, 6);
        assert.equal(capturedBodies[0]?.usage_type, 'courseware');

        const second = await maybeBillCompletedRenderTask(task);
        assert.equal(second.kind, 'skipped');
        assert.equal(capturedBodies.length, 1);
      } finally {
        globalThis.fetch = prevFetch;
      }
    },
  );
});

test('maybeBillCompletedRenderTask falls back to takes when computeTakes missing', async () => {
  await withEnv(
    { AINOBI_VIDEO_RENDER_CREDITS_SERVICE_CODE: 'video-render-1080p', REDIS_HOST: 'localhost' },
    async () => {
      const taskId = `task-legacy-takes-${Date.now()}`;
      await savePendingRenderTaskBilling(taskId, {
        accessToken: 'token-abc',
        orgId: 'org-1',
        coursewareId: 'cw-1',
        userId: 'user-1',
      });

      const capturedBodies: Record<string, unknown>[] = [];
      const prevFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            code: 0,
            success: true,
            data: {
              service_code: 'video-render-1080p',
              consumption_type: 'organization',
              amount_unit: 'tokens',
              org_id: 'org-1',
              credits_consumed: '2',
              remaining_credits: '98',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch;

      try {
        const outcome = await maybeBillCompletedRenderTask({
          id: taskId,
          status: 'completed',
          result: { render: { duration: 30_000, takes: 90_000 } },
        });
        assert.equal(outcome.kind, 'charged');
        if (outcome.kind === 'charged') {
          assert.equal(outcome.minutes, 2);
        }
        assert.equal(capturedBodies[0]?.unit_count, 2);
      } finally {
        globalThis.fetch = prevFetch;
      }
    },
  );
});

test('maybeBillCompletedRenderTask skips when computeTakes and takes are missing', async () => {
  await withEnv(
    { AINOBI_VIDEO_RENDER_CREDITS_SERVICE_CODE: 'video-render-1080p', REDIS_HOST: 'localhost' },
    async () => {
      const taskId = `task-missing-takes-${Date.now()}`;
      await savePendingRenderTaskBilling(taskId, {
        accessToken: 'token-abc',
        orgId: undefined,
        coursewareId: 'cw-1',
        userId: undefined,
      });
      const outcome = await maybeBillCompletedRenderTask({ id: taskId, status: 'completed', result: {} });
      assert.equal(outcome.kind, 'skipped');
    },
  );
});
