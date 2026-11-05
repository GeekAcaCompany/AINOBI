// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitRenderTaskOrganizationStorage,
  releaseRenderTaskOrganizationStorage,
  resolveRenderTaskStorageBytes,
} from './video-render-org-storage.ts';

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

function withFetch<T>(mock: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.fetch;
  globalThis.fetch = mock;
  return fn().finally(() => {
    globalThis.fetch = prev;
  });
}

function storageOk(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ code: 0, success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('resolveRenderTaskStorageBytes sums video + cover', () => {
  assert.equal(
    resolveRenderTaskStorageBytes({
      id: 't1',
      status: 'completed',
      result: { oss: { sizeBytes: 1000 }, cover: { sizeBytes: 200 } },
    }),
    1200,
  );
  assert.equal(
    resolveRenderTaskStorageBytes({ id: 't2', status: 'completed', result: { oss: { sizeBytes: 500 } } }),
    500,
  );
  assert.equal(resolveRenderTaskStorageBytes({ id: 't3', status: 'completed', result: {} }), 0);
});

test('commitRenderTaskOrganizationStorage skips when org storage disabled', async () => {
  await withEnv({ AINOBI_ORG_STORAGE_DISABLED: 'true' }, async () => {
    const outcome = await commitRenderTaskOrganizationStorage({
      task: {
        id: 't-disabled',
        status: 'completed',
        result: { oss: { sizeBytes: 1000 } },
      },
      accessToken: 'tok',
      orgId: 'org-1',
    });
    assert.equal(outcome.kind, 'skipped');
  });
});

test('commitRenderTaskOrganizationStorage locks then confirms', async () => {
  await withEnv(
    {
      AINOBI_ORG_STORAGE_DISABLED: undefined,
      AINOBI_ORG_STORAGE_QUOTA_CHECK: undefined,
      REDIS_HOST: undefined,
    },
    async () => {
    const urls: string[] = [];
    await withFetch(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/lock')) {
        return storageOk({
          lock_id: 'lock-1',
          org_id: 'org-1',
          size_bytes: 1200,
          created_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-01T00:10:00Z',
          ttl_seconds: 600,
        });
      }
      if (url.includes('/confirm')) {
        assert.equal(JSON.parse(String(init?.body)).actual_size_bytes, 1200);
        return storageOk({
          lock_id: 'lock-1',
          org_id: 'org-1',
          committed_bytes: 1200,
          released_bytes: 0,
          storage: {
            org_id: 'org-1',
            quota_bytes: 1_000_000,
            used_bytes: 1200,
            locked_bytes: 0,
            available_bytes: 998_800,
            unlimited: false,
          },
        });
      }
      throw new Error(`unexpected url ${url}`);
    }, async () => {
      const outcome = await commitRenderTaskOrganizationStorage({
        task: {
          id: 't-commit',
          status: 'completed',
          result: { oss: { sizeBytes: 1000 }, cover: { sizeBytes: 200 } },
        },
        accessToken: 'tok',
        orgId: 'org-1',
      });
      assert.equal(outcome.kind, 'committed');
      if (outcome.kind === 'committed') {
        assert.equal(outcome.sizeBytes, 1200);
      }
      assert.equal(urls.length, 2);
      assert.match(urls[0]!, /\/storage\/lock$/);
      assert.match(urls[1]!, /\/lock\/lock-1\/confirm$/);
    });
  });
});

test('releaseRenderTaskOrganizationStorage skips without committed marker', async () => {
  await withEnv(
    {
      AINOBI_ORG_STORAGE_DISABLED: undefined,
      AINOBI_ORG_STORAGE_QUOTA_CHECK: undefined,
      REDIS_HOST: undefined,
    },
    async () => {
    const outcome = await releaseRenderTaskOrganizationStorage({
      task: {
        id: 't-no-marker',
        status: 'completed',
        result: { oss: { sizeBytes: 1000 } },
      },
      accessToken: 'tok',
      orgId: 'org-1',
    });
    assert.equal(outcome.kind, 'skipped');
  });
});
