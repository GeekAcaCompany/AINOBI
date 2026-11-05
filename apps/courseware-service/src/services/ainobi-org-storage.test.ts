// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AinobiOrgStorageError,
  confirmOrganizationStorage,
  decrementOrganizationStorage,
  isOrgStorageIntegrationEnabled,
  isOrgStorageQuotaCheckEnabled,
  lockOrganizationStorage,
  ORG_STORAGE_QUOTA_EXCEEDED_CODE,
  releaseOrganizationStorageLock,
} from './ainobi-org-storage.ts';

function withOrgStorageEnv(
  overrides: Record<'AINOBI_ORG_STORAGE_DISABLED' | 'AINOBI_ORG_STORAGE_QUOTA_CHECK', string | undefined>,
  fn: () => void,
): void {
  const keys = ['AINOBI_ORG_STORAGE_DISABLED', 'AINOBI_ORG_STORAGE_QUOTA_CHECK'] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]])) as Record<
    (typeof keys)[number],
    string | undefined
  >;
  try {
    for (const key of keys) {
      const value = overrides[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fn();
  } finally {
    for (const key of keys) {
      const value = prev[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('isOrgStorageIntegrationEnabled requires orgId and respects disable flag', () => {
  withOrgStorageEnv({ AINOBI_ORG_STORAGE_DISABLED: undefined, AINOBI_ORG_STORAGE_QUOTA_CHECK: undefined }, () => {
    assert.equal(isOrgStorageIntegrationEnabled('org-1'), true);
    assert.equal(isOrgStorageIntegrationEnabled(null), false);
  });
  withOrgStorageEnv({ AINOBI_ORG_STORAGE_DISABLED: '1', AINOBI_ORG_STORAGE_QUOTA_CHECK: undefined }, () => {
    assert.equal(isOrgStorageIntegrationEnabled('org-1'), false);
  });
});

test('AINOBI_ORG_STORAGE_QUOTA_CHECK=false skips capacity enforcement', () => {
  withOrgStorageEnv({ AINOBI_ORG_STORAGE_DISABLED: undefined, AINOBI_ORG_STORAGE_QUOTA_CHECK: undefined }, () => {
    assert.equal(isOrgStorageQuotaCheckEnabled(), true);
    assert.equal(isOrgStorageIntegrationEnabled('org-1'), true);
  });
  withOrgStorageEnv({ AINOBI_ORG_STORAGE_DISABLED: undefined, AINOBI_ORG_STORAGE_QUOTA_CHECK: 'false' }, () => {
    assert.equal(isOrgStorageQuotaCheckEnabled(), false);
    assert.equal(isOrgStorageIntegrationEnabled('org-1'), false);
  });
  withOrgStorageEnv({ AINOBI_ORG_STORAGE_DISABLED: undefined, AINOBI_ORG_STORAGE_QUOTA_CHECK: '0' }, () => {
    assert.equal(isOrgStorageQuotaCheckEnabled(), false);
  });
});

test('lockOrganizationStorage posts size_bytes and maps response', async () => {
  const prevFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          lock_id: '11111111-1111-4111-8111-111111111111',
          org_id: '22222222-2222-4222-8222-222222222222',
          size_bytes: 4096,
          created_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-01T00:30:00Z',
          ttl_seconds: 1800,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const lock = await lockOrganizationStorage('token', '22222222-2222-4222-8222-222222222222', 4096, 'upload');
    assert.match(capturedUrl, /\/organization\/22222222-2222-4222-8222-222222222222\/storage\/lock$/);
    assert.equal(capturedBody?.size_bytes, 4096);
    assert.equal(lock.lockId, '11111111-1111-4111-8111-111111111111');
    assert.equal(lock.sizeBytes, 4096);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('lockOrganizationStorage maps quota exceeded code and warns', async () => {
  const prevFetch = globalThis.fetch;
  const prevWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: ORG_STORAGE_QUOTA_EXCEEDED_CODE,
        success: false,
        message: 'Storage quota exceeded',
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );
  try {
    await assert.rejects(
      () => lockOrganizationStorage('token', 'org-id', 100),
      (error: unknown) => {
        assert.ok(error instanceof AinobiOrgStorageError);
        assert.equal(error.code, ORG_STORAGE_QUOTA_EXCEEDED_CODE);
        assert.equal(error.isQuotaExceeded, true);
        return true;
      },
    );
    // The low-level client must surface API rejections through console.warn so they
    // are visible even when an upstream caller swallows the thrown error.
    assert.ok(
      warnings.some(
        (line) =>
          line.includes('[org-storage] api rejected') &&
          line.includes(`code=${ORG_STORAGE_QUOTA_EXCEEDED_CODE}`),
      ),
      `expected api-rejected warn, got: ${warnings.join(' | ')}`,
    );
  } finally {
    globalThis.fetch = prevFetch;
    console.warn = prevWarn;
  }
});

test('confirmOrganizationStorage sends actual_size_bytes', async () => {
  const prevFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          lock_id: '11111111-1111-4111-8111-111111111111',
          org_id: 'org-id',
          committed_bytes: 3000,
          released_bytes: 1096,
          storage: {
            org_id: 'org-id',
            quota_bytes: 1000,
            used_bytes: 3000,
            locked_bytes: 0,
            available_bytes: 0,
            unlimited: false,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const result = await confirmOrganizationStorage(
      'token',
      'org-id',
      '11111111-1111-4111-8111-111111111111',
      3000,
    );
    assert.equal(capturedBody?.actual_size_bytes, 3000);
    assert.equal(result.committedBytes, 3000);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('releaseOrganizationStorageLock posts empty body', async () => {
  const prevFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          lock_id: 'lock-id',
          org_id: 'org-id',
          released_bytes: 100,
          storage: {
            org_id: 'org-id',
            quota_bytes: 1000,
            used_bytes: 0,
            locked_bytes: 0,
            available_bytes: 1000,
            unlimited: false,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    await releaseOrganizationStorageLock('token', 'org-id', 'lock-id');
    assert.match(capturedUrl, /\/storage\/lock\/lock-id\/release$/);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('decrementOrganizationStorage posts size_bytes', async () => {
  const prevFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          org_id: 'org-id',
          decremented_bytes: 512,
          storage: {
            org_id: 'org-id',
            quota_bytes: 10000,
            used_bytes: 0,
            locked_bytes: 0,
            available_bytes: 10000,
            unlimited: false,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const result = await decrementOrganizationStorage('token', 'org-id', 512);
    assert.equal(capturedBody?.size_bytes, 512);
    assert.equal(result.decrementedBytes, 512);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
