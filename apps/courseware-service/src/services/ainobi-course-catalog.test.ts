// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { listAinobiCoursesForOrg } from './ainobi-course-catalog.ts';

test('listAinobiCoursesForOrg maps SuccessWrapped pagination', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          data: [
            {
              course_id: 'c1',
              course_name: ' Intro ',
              course_status: 'published',
              course_description: 'd',
              org_id: 'org-1',
              chapter_count: 2,
              section_count: 5,
              student_count: 10,
            },
          ],
          pagination: {
            page_number: 1,
            page_size: 20,
            total_count: 1,
            total_pages: 1,
            has_next_page: false,
            has_previous_page: false,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

  try {
    const result = await listAinobiCoursesForOrg({
      accessToken: 'tok',
      orgId: 'ORG-1',
      pageNumber: 1,
      pageSize: 20,
    });
    assert.equal(result.org_id, 'ORG-1');
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0], {
      course_id: 'c1',
      course_name: 'Intro',
      course_status: 'published',
      course_description: 'd',
      org_id: 'org-1',
      student_count: 10,
      chapter_count: 2,
      section_count: 5,
    });
    assert.equal(result.pagination.total_count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('listAinobiCoursesForOrg surfaces backend rejection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: 403, success: false, message: 'nope' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => listAinobiCoursesForOrg({ accessToken: 'tok', orgId: 'org-1' }),
      /rejected: nope/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
