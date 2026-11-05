// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireCoursewareCloneStorageLock,
  acquireCoursewareUploadStorageLock,
  confirmCoursewareCloneStorageLock,
  confirmCoursewareUploadStorageLock,
  decrementCoursewareAssetStorageIfUnreferenced,
  decrementCoursewareObjectStorage,
  isOrgStorageFileUploadPermissionError,
  orgStorageErrorMessage,
  releaseCoursewareCloneStorageLock,
  releaseCoursewareUploadStorageLock,
} from './courseware-asset-org-storage.ts';
import { AinobiOrgStorageError } from './ainobi-org-storage.ts';

type ConsoleCapture = {
  infos: string[];
  warns: string[];
  restore: () => void;
};

function captureConsole(): ConsoleCapture {
  const infos: string[] = [];
  const warns: string[] = [];
  const prevInfo = console.info;
  const prevWarn = console.warn;
  console.info = (...args: unknown[]) => {
    infos.push(args.map((a) => String(a)).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(' '));
  };
  return {
    infos,
    warns,
    restore: () => {
      console.info = prevInfo;
      console.warn = prevWarn;
    },
  };
}

function withFetch<T>(handler: typeof fetch, run: () => Promise<T>): Promise<T> {
  const prev = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => {
    globalThis.fetch = prev;
  });
}

/** Ensure quota check / storage integration is on regardless of local `.env`. */
function withOrgStorageOn<T>(run: () => Promise<T>): Promise<T> {
  const prevDisabled = process.env.AINOBI_ORG_STORAGE_DISABLED;
  const prevQuota = process.env.AINOBI_ORG_STORAGE_QUOTA_CHECK;
  delete process.env.AINOBI_ORG_STORAGE_DISABLED;
  delete process.env.AINOBI_ORG_STORAGE_QUOTA_CHECK;
  return run().finally(() => {
    if (prevDisabled === undefined) delete process.env.AINOBI_ORG_STORAGE_DISABLED;
    else process.env.AINOBI_ORG_STORAGE_DISABLED = prevDisabled;
    if (prevQuota === undefined) delete process.env.AINOBI_ORG_STORAGE_QUOTA_CHECK;
    else process.env.AINOBI_ORG_STORAGE_QUOTA_CHECK = prevQuota;
  });
}

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const LOCK_ID = '11111111-1111-4111-8111-111111111111';

function lockOk(): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          lock_id: LOCK_ID,
          org_id: ORG_ID,
          size_bytes: 4096,
          created_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-01T00:30:00Z',
          ttl_seconds: 1800,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

function confirmOk(): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          lock_id: LOCK_ID,
          org_id: ORG_ID,
          committed_bytes: 4096,
          released_bytes: 0,
          storage: {
            org_id: ORG_ID,
            quota_bytes: 100000,
            used_bytes: 4096,
            locked_bytes: 0,
            available_bytes: 95904,
            unlimited: false,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

function releaseOk(): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          lock_id: LOCK_ID,
          org_id: ORG_ID,
          released_bytes: 4096,
          storage: {
            org_id: ORG_ID,
            quota_bytes: 100000,
            used_bytes: 0,
            locked_bytes: 0,
            available_bytes: 100000,
            unlimited: false,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

function quotaExceeded(): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        code: 422030,
        success: false,
        message: 'Storage quota exceeded',
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );
}

test('acquireCoursewareUploadStorageLock logs success with orgId/size/lockId/ttl/remark', async () => {
  const capture = captureConsole();
  try {
    const handle = await withOrgStorageOn(() =>
      withFetch(lockOk(), () =>
        acquireCoursewareUploadStorageLock('token', ORG_ID, 4096, 'courseware:abc'),
      ),
    );
    assert.ok(handle);
    assert.equal(handle?.lockId, LOCK_ID);
    const line = capture.infos.find((l) => l.includes('lock acquired'));
    assert.ok(line, `expected lock-acquired info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes(`orgId=${ORG_ID}`));
    assert.ok(line!.includes('sizeBytes=4096'));
    assert.ok(line!.includes(`lockId=${LOCK_ID}`));
    assert.ok(line!.includes('ttlSeconds=1800'));
    assert.ok(line!.includes('remark=courseware:abc'));
  } finally {
    capture.restore();
  }
});

test('acquireCoursewareUploadStorageLock warns on quota exceeded and rethrows', async () => {
  const capture = captureConsole();
  try {
    await assert.rejects(() =>
      withOrgStorageOn(() =>
        withFetch(quotaExceeded(), () =>
          acquireCoursewareUploadStorageLock('token', ORG_ID, 4096, 'courseware:abc'),
        ),
      ),
    );
    const line = capture.warns.find((l) => l.includes('lock acquire failed'));
    assert.ok(line, `expected lock-acquire-failed warn, got: ${capture.warns.join(' | ')}`);
    assert.ok(line!.includes(`orgId=${ORG_ID}`));
    assert.ok(line!.includes('status=422'));
    assert.ok(line!.includes('code=422030'));
  } finally {
    capture.restore();
  }
});

test('acquireCoursewareUploadStorageLock skips silently when integration is off', async () => {
  const capture = captureConsole();
  try {
    const handle = await acquireCoursewareUploadStorageLock('token', null, 4096);
    assert.equal(handle, null);
    // No backend call, no log noise: caller flow stays clean for non-org uploads.
    assert.equal(capture.infos.length, 0);
    assert.equal(capture.warns.length, 0);
  } finally {
    capture.restore();
  }
});

test('acquireCoursewareCloneStorageLock logs success with orgId/size/lockId/ttl/remark', async () => {
  const capture = captureConsole();
  try {
    const handle = await withOrgStorageOn(() =>
      withFetch(lockOk(), () =>
        acquireCoursewareCloneStorageLock('token', ORG_ID, 8192, 'courseware-clone:src->dst'),
      ),
    );
    assert.ok(handle);
    assert.equal(handle?.lockId, LOCK_ID);
    const line = capture.infos.find((l) => l.includes('clone lock acquired'));
    assert.ok(line, `expected clone lock-acquired info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes(`orgId=${ORG_ID}`));
    assert.ok(line!.includes('sizeBytes=4096') || line!.includes('sizeBytes=8192'));
    assert.ok(line!.includes(`lockId=${LOCK_ID}`));
    assert.ok(line!.includes('remark=courseware-clone:src->dst'));
  } finally {
    capture.restore();
  }
});

test('acquireCoursewareCloneStorageLock skips silently when total bytes are zero', async () => {
  const capture = captureConsole();
  try {
    const handle = await withOrgStorageOn(() =>
      acquireCoursewareCloneStorageLock('token', ORG_ID, 0, 'courseware-clone:none'),
    );
    assert.equal(handle, null);
    assert.equal(capture.infos.length, 0);
    assert.equal(capture.warns.length, 0);
  } finally {
    capture.restore();
  }
});

test('confirmCoursewareUploadStorageLock logs committed/released/used/available', async () => {
  const capture = captureConsole();
  try {
    await withFetch(confirmOk(), () =>
      confirmCoursewareUploadStorageLock('token', { lockId: LOCK_ID, orgId: ORG_ID }, 4096),
    );
    const line = capture.infos.find((l) => l.includes('consumption confirmed'));
    assert.ok(line, `expected confirm info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes('committedBytes=4096'));
    assert.ok(line!.includes('releasedBytes=0'));
    assert.ok(line!.includes('used=4096'));
    assert.ok(line!.includes('available=95904'));
  } finally {
    capture.restore();
  }
});

test('confirmCoursewareUploadStorageLock retries then throws on persistent failure', async () => {
  const capture = captureConsole();
  try {
    await assert.rejects(() =>
      withFetch(quotaExceeded(), () =>
        confirmCoursewareUploadStorageLock('token', { lockId: LOCK_ID, orgId: ORG_ID }, 4096),
      ),
    );
    const attempts = capture.warns.filter((l) => l.includes('confirm failed'));
    assert.equal(attempts.length, 3, `expected 3 retry warns, got: ${capture.warns.join(' | ')}`);
    assert.ok(attempts[0]!.includes('attempt 1/3'));
    assert.ok(attempts[2]!.includes('attempt 3/3'));
    assert.ok(attempts[2]!.includes(`lockId=${LOCK_ID}`));
  } finally {
    capture.restore();
  }
});

test('confirmCoursewareUploadStorageLock succeeds on a later retry attempt', async () => {
  const capture = captureConsole();
  let calls = 0;
  try {
    await withFetch(
      (...args: Parameters<typeof fetch>) => {
        calls += 1;
        return calls < 2 ? quotaExceeded()(...args) : confirmOk()(...args);
      },
      () =>
        confirmCoursewareUploadStorageLock('token', { lockId: LOCK_ID, orgId: ORG_ID }, 4096),
    );
    const line = capture.infos.find((l) => l.includes('consumption confirmed'));
    assert.ok(line, `expected confirm info, got: ${capture.infos.join(' | ')}`);
    assert.equal(calls, 2);
  } finally {
    capture.restore();
  }
});

test('confirmCoursewareCloneStorageLock logs committed/released/used/available', async () => {
  const capture = captureConsole();
  try {
    await withFetch(confirmOk(), () =>
      confirmCoursewareCloneStorageLock('token', { lockId: LOCK_ID, orgId: ORG_ID }, 4096),
    );
    const line = capture.infos.find((l) => l.includes('clone consumption confirmed'));
    assert.ok(line, `expected clone confirm info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes('committedBytes=4096'));
    assert.ok(line!.includes('releasedBytes=0'));
  } finally {
    capture.restore();
  }
});

test('confirmCoursewareCloneStorageLock warns and throws on failure', async () => {
  const capture = captureConsole();
  try {
    await assert.rejects(() =>
      withFetch(quotaExceeded(), () =>
        confirmCoursewareCloneStorageLock('token', { lockId: LOCK_ID, orgId: ORG_ID }, 4096),
      ),
    );
    const line = capture.warns.find((l) => l.includes('clone confirm failed'));
    assert.ok(line, `expected clone confirm warn, got: ${capture.warns.join(' | ')}`);
    assert.ok(line!.includes(`lockId=${LOCK_ID}`));
  } finally {
    capture.restore();
  }
});

test('releaseCoursewareUploadStorageLock logs success with orgId/lockId', async () => {
  const capture = captureConsole();
  try {
    await withFetch(releaseOk(), () =>
      releaseCoursewareUploadStorageLock('token', { lockId: LOCK_ID, orgId: ORG_ID }),
    );
    const line = capture.infos.find((l) => l.includes('pre-lock released'));
    assert.ok(line, `expected release info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes(`orgId=${ORG_ID}`));
    assert.ok(line!.includes(`lockId=${LOCK_ID}`));
  } finally {
    capture.restore();
  }
});

test('releaseCoursewareCloneStorageLock logs success with orgId/lockId', async () => {
  const capture = captureConsole();
  try {
    await withFetch(releaseOk(), () =>
      releaseCoursewareCloneStorageLock('token', { lockId: LOCK_ID, orgId: ORG_ID }),
    );
    const line = capture.infos.find((l) => l.includes('clone pre-lock released'));
    assert.ok(line, `expected clone release info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes(`orgId=${ORG_ID}`));
    assert.ok(line!.includes(`lockId=${LOCK_ID}`));
  } finally {
    capture.restore();
  }
});

test('decrementCoursewareAssetStorageIfUnreferenced logs skip reason when orgId is missing', async () => {
  const capture = captureConsole();
  try {
    await decrementCoursewareAssetStorageIfUnreferenced('token', null, {
      fileId: 'asset-1',
      contentMd5: 'abc',
      fileSize: 4096,
    });
    // Visible reason is required so deletes don't look mysteriously silent in logs.
    const line = capture.infos.find((l) => l.includes('decrement skip'));
    assert.ok(line, `expected decrement-skip info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes('reason=no-org'));
    assert.ok(line!.includes('fileId=asset-1'));
    assert.equal(capture.warns.length, 0);
  } finally {
    capture.restore();
  }
});

test('decrementCoursewareAssetStorageIfUnreferenced logs skip reason when access token is missing', async () => {
  const capture = captureConsole();
  try {
    await withOrgStorageOn(() =>
      decrementCoursewareAssetStorageIfUnreferenced('', 'org-id', {
        fileId: 'asset-1',
        contentMd5: 'abc',
        fileSize: 4096,
      }),
    );
    const line = capture.infos.find((l) => l.includes('decrement skip'));
    assert.ok(line, `expected decrement-skip info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes('reason=no-token'));
  } finally {
    capture.restore();
  }
});

test('orgStorageErrorMessage remaps organization:file_upload denials', () => {
  const error = new AinobiOrgStorageError(
    "Agent sessions are not permitted to invoke 'organization:file_upload'",
    403,
    403004,
  );
  assert.equal(isOrgStorageFileUploadPermissionError(error), true);
  const message = orgStorageErrorMessage(error);
  assert.match(message, /organization:file_upload/);
  assert.match(message, /ainobi_ak_/);
  assert.match(message, /courseware-agent locks/);
});

test('orgStorageErrorMessage leaves quota messages unchanged', () => {
  const error = new AinobiOrgStorageError('Storage quota exceeded', 422, 422030);
  assert.equal(isOrgStorageFileUploadPermissionError(error), false);
  assert.equal(orgStorageErrorMessage(error), 'Storage quota exceeded');
});

test('decrementCoursewareObjectStorage skips invalid size and no-token cases', async () => {
  const capture = captureConsole();
  try {
    await withOrgStorageOn(async () => {
      await decrementCoursewareObjectStorage('token', ORG_ID, 0, 'label');
      await decrementCoursewareObjectStorage('', ORG_ID, 100, 'label');
      await decrementCoursewareObjectStorage('token', null, 100, 'label');
    });
    const skips = capture.infos.filter((l) => l.includes('object decrement skip'));
    assert.equal(skips.length, 3, `expected 3 skip logs, got: ${capture.infos.join(' | ')}`);
  } finally {
    capture.restore();
  }
});

test('decrementCoursewareObjectStorage decrements raw bytes', async () => {
  const capture = captureConsole();
  let called = '';
  try {
    await withOrgStorageOn(() =>
      withFetch(
        (async () =>
          new Response(
            JSON.stringify({
              code: 0,
              success: true,
              data: {
                org_id: ORG_ID,
                decremented_bytes: 4096,
                storage: {
                  org_id: ORG_ID,
                  quota_bytes: 1048576,
                  used_bytes: 0,
                  locked_bytes: 0,
                  available_bytes: 1048576,
                  unlimited: false,
                },
              },
            }),
            { status: 200 },
          )) as typeof fetch,
        async () => {
          await decrementCoursewareObjectStorage('token', ORG_ID, 4096, 'quiz-recording:r1');
          called = 'ok';
        },
      ),
    );
    const line = capture.infos.find((l) => l.includes('object storage decremented'));
    assert.ok(line, `expected decrement info, got: ${capture.infos.join(' | ')}`);
    assert.ok(line!.includes('label=quiz-recording:r1'));
    assert.equal(called, 'ok');
  } finally {
    capture.restore();
  }
});
