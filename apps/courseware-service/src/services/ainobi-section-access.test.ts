// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchSectionReadAccess, type SectionAccessCacheOps } from './ainobi-section-access.ts';

// Unit tests always inject a no-op cache: they never touch a real Redis (without Redis in CI, ioredis would stall commands)
const noCache: SectionAccessCacheOps = {
  read: async () => null,
  write: async () => {},
};

type FetchLike = typeof globalThis.fetch;

async function withFetch<T>(impl: FetchLike, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('fetchSectionReadAccess grants on 200 code=0 and normalizes ids', async () => {
  const access = await withFetch(
    async () =>
      jsonResponse(200, {
        code: 0,
        success: true,
        data: {
          section_id: 'sec-1',
          org_id: '7C9E6679-7425-40DE-944B-E07FC1F90AE7',
          course_id: 'COURSE-1',
          chapter_id: 'Chapter-1',
        },
      }),
    () => fetchSectionReadAccess('token-1', 'sec-1', noCache),
  );

  assert.equal(access.canRead, true);
  assert.equal(access.orgId, '7c9e6679-7425-40de-944b-e07fc1f90ae7');
  assert.equal(access.courseId, 'course-1');
  assert.equal(access.chapterId, 'chapter-1');
});

test('fetchSectionReadAccess ignores can_access/locked/expired fields', async () => {
  // The courseware read gate has the same semantics as the internal student binding check: no lock/expiry check, HTTP 200 means readable
  const access = await withFetch(
    async () =>
      jsonResponse(200, {
        code: 0,
        success: true,
        data: {
          section_id: 'sec-1',
          org_id: 'org-1',
          course_id: 'course-1',
          chapter_id: 'chapter-1',
          can_access: false,
          locked: true,
          expired: true,
        },
      }),
    () => fetchSectionReadAccess('token-1', 'sec-1', noCache),
  );

  assert.equal(access.canRead, true);
});

test('fetchSectionReadAccess denies on 403', async () => {
  const access = await withFetch(
    async () => jsonResponse(403, { code: 403, success: false, message: 'denied' }),
    () => fetchSectionReadAccess('token-1', 'sec-1', noCache),
  );

  assert.equal(access.canRead, false);
  assert.equal(access.orgId, null);
});

test('fetchSectionReadAccess denies on 404', async () => {
  const access = await withFetch(
    async () => jsonResponse(404, { code: 404, success: false, message: 'not found' }),
    () => fetchSectionReadAccess('token-1', 'sec-1', noCache),
  );

  assert.equal(access.canRead, false);
});

test('fetchSectionReadAccess denies on HTTP 200 with non-zero envelope code', async () => {
  const access = await withFetch(
    async () => jsonResponse(200, { code: 500, success: false, message: 'oops' }),
    () => fetchSectionReadAccess('token-1', 'sec-1', noCache),
  );

  assert.equal(access.canRead, false);
});

test('fetchSectionReadAccess denies on network error without throwing', async () => {
  const access = await withFetch(
    async () => {
      throw new Error('connect ECONNREFUSED');
    },
    () => fetchSectionReadAccess('token-1', 'sec-1', noCache),
  );

  assert.equal(access.canRead, false);
});

test('fetchSectionReadAccess denies on 5xx without throwing', async () => {
  const access = await withFetch(
    async () => jsonResponse(502, { message: 'bad gateway' }),
    () => fetchSectionReadAccess('token-1', 'sec-1', noCache),
  );

  assert.equal(access.canRead, false);
});

test('fetchSectionReadAccess short-circuits on empty token or section id', async () => {
  let called = 0;
  const access = await withFetch(
    async () => {
      called += 1;
      return jsonResponse(200, { code: 0, success: true, data: {} });
    },
    async () => {
      const a = await fetchSectionReadAccess('   ', 'sec-1', noCache);
      const b = await fetchSectionReadAccess('token-1', '  ', noCache);
      return { a, b };
    },
  );

  assert.equal(access.a.canRead, false);
  assert.equal(access.b.canRead, false);
  assert.equal(called, 0);
});

test('fetchSectionReadAccess caches settled denials but not transient failures', async () => {
  const writes: Array<{ sectionId: string; canRead: boolean }> = [];
  const spyCache: SectionAccessCacheOps = {
    read: async () => null,
    write: async (_token, sectionId, access) => {
      writes.push({ sectionId, canRead: access.canRead });
    },
  };

  // 5xx / network error → nothing cached
  await withFetch(
    async () => jsonResponse(502, {}),
    () => fetchSectionReadAccess('token-1', 'sec-1', spyCache),
  );
  await withFetch(
    async () => {
      throw new Error('boom');
    },
    () => fetchSectionReadAccess('token-1', 'sec-1', spyCache),
  );
  assert.equal(writes.length, 0);

  // 4xx → negative cache; 200 → positive cache
  await withFetch(
    async () => jsonResponse(403, { code: 403, success: false }),
    () => fetchSectionReadAccess('token-1', 'sec-1', spyCache),
  );
  assert.deepEqual(writes, [{ sectionId: 'sec-1', canRead: false }]);

  await withFetch(
    async () =>
      jsonResponse(200, {
        code: 0,
        success: true,
        data: { org_id: 'org-1', course_id: 'course-1', chapter_id: 'ch-1' },
      }),
    () => fetchSectionReadAccess('token-1', 'sec-1', spyCache),
  );
  assert.deepEqual(writes, [
    { sectionId: 'sec-1', canRead: false },
    { sectionId: 'sec-1', canRead: true },
  ]);
});

test('fetchSectionReadAccess returns the cached value without fetching', async () => {
  let called = 0;
  const cachedAccess = { canRead: true, orgId: 'org-1', courseId: 'course-1', chapterId: 'ch-1' };
  const access = await withFetch(
    async () => {
      called += 1;
      return jsonResponse(200, { code: 0, success: true, data: {} });
    },
    () =>
      fetchSectionReadAccess('token-1', 'sec-1', {
        read: async () => cachedAccess,
        write: async () => {},
      }),
  );

  assert.deepEqual(access, cachedAccess);
  assert.equal(called, 0);
});
