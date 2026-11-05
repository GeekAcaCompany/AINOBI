// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  courseCreateTool,
  courseUpdateTool,
  coursewareExportFromCourseTool,
  coursewareImportToCourseTool,
} from './codex-mcp-tools.ts';

function fakeSession(overrides: Partial<AinobiAuthorizedSession> = {}): AinobiAuthorizedSession {
  return {
    roles: ['agent'],
    user: {
      user_id: 'agent-1',
      user_name: 'Bot',
      account_name: 'bot',
      email: null,
      user_status: 'active',
      user_avatar_url: null,
      user_type: 'agent',
    },
    organization: null,
    permissions: [],
    userId: 'agent-1',
    permissionUserId: 'owner-1',
    currentOrgId: 'org-current',
    accessToken: 'token-1',
    expireAt: new Date(Date.now() + 3600_000).toISOString(),
    isOrgAgent: true,
    ...overrides,
  };
}

describe('course domain tools (validation branches)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('courseCreateTool', () => {
    it('requires a title', async () => {
      const result = await courseCreateTool(fakeSession(), { title: '   ' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'TITLE_REQUIRED');
    });

    it('rejects unknown status values', async () => {
      const result = await courseCreateTool(fakeSession(), { title: 'X', status: 'bogus' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'USAGE');
    });

    it('creates a course via the backend and reports the container semantics', async () => {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            code: 0,
            success: true,
            data: {
              course_id: 'course-9',
              course_name: 'E2E课程',
              course_status: 'draft',
              course_description: null,
              org_id: 'org-current',
            },
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const result = await courseCreateTool(fakeSession(), {
        title: 'E2E课程',
        description: '测试',
      });
      assert.equal(result.ok, true);
      const data = result.data as { course_id: string; next: string };
      assert.equal(data.course_id, 'course-9');
      // The "course ≠ courseware" meaning is pinned in the next-step guidance
      assert.ok(data.next.includes('courseware_create'));
      assert.ok(data.next.includes('course container, not courseware'));

      const call = calls[0]!;
      assert.ok(call.url.includes('/organization/org-current/course/create'));
      const body = JSON.parse(String(call.init.body));
      assert.equal(body.course_name, 'E2E课程');
      assert.equal(body.course_status, 'draft');
    });
  });

  describe('courseUpdateTool', () => {
    it('requires course_id', async () => {
      const result = await courseUpdateTool(fakeSession(), { title: 'X' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'COURSE_REQUIRED');
    });

    it('requires at least one mutable field', async () => {
      const result = await courseUpdateTool(fakeSession(), { course_id: 'c1' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'USAGE');
    });

    it('updates via the backend', async () => {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            code: 0,
            success: true,
            data: {
              course_id: 'c1',
              course_name: '新名',
              course_status: 'draft',
              course_description: null,
              org_id: 'org-current',
            },
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const result = await courseUpdateTool(fakeSession(), {
        course_id: 'c1',
        title: '新名',
      });
      assert.equal(result.ok, true);
      const call = calls[0]!;
      assert.ok(call.url.includes('/course/c1/update'));
      assert.equal(JSON.parse(String(call.init.body)).course_name, '新名');
    });
  });

  describe('import/export', () => {
    it('requires courseware_id and course_id', async () => {
      const missingCourse = await coursewareImportToCourseTool(fakeSession(), {
        courseware_id: 'cw-1',
      });
      assert.equal(missingCourse.ok, false);
      assert.equal(missingCourse.code, 'USAGE');

      const missingCourseware = await coursewareExportFromCourseTool(fakeSession(), {
        course_id: 'c1',
      });
      assert.equal(missingCourseware.ok, false);
      assert.equal(missingCourseware.code, 'USAGE');
    });
  });
});
