// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAuthorizationToken,
  isAnonymousCoursewareRoute,
  isLoginRequiredCoursewareRoute,
  isMemberSessionCoursewareRoute,
  isPublicRequest,
} from './api-auth.ts';
import { hasManageLoginPermission } from './auth/ainobi-user-session.ts';

test('extractAuthorizationToken accepts Bearer and raw token', () => {
  assert.equal(extractAuthorizationToken('Bearer secret-key'), 'secret-key');
  assert.equal(extractAuthorizationToken('secret-key'), 'secret-key');
  assert.equal(extractAuthorizationToken(''), null);
  assert.equal(extractAuthorizationToken(undefined), null);
});

test('hasManageLoginPermission gates courseware agent access', () => {
  assert.equal(hasManageLoginPermission(['user:manage_login']), true);
  assert.equal(hasManageLoginPermission(['user:query']), false);
});

test('isPublicRequest allows health and static pages only', () => {
  assert.equal(isPublicRequest('OPTIONS', '/chat'), true);
  assert.equal(isPublicRequest('GET', '/health'), true);
  assert.equal(isPublicRequest('GET', '/health?probe=1'), true);
  assert.equal(isPublicRequest('GET', '/plugins/ainobi-courseware-codex-plugin.zip'), true);
  assert.equal(isPublicRequest('GET', '/'), false);
  assert.equal(isPublicRequest('POST', '/chat'), false);
  assert.equal(isPublicRequest('GET', '/courseware'), false);
  assert.equal(isPublicRequest('POST', '/courseware/assets/upload'), false);
  assert.equal(isPublicRequest('POST', '/courseware/assets/list'), false);
});

test('isAnonymousCoursewareRoute allows courseware paths except stream/sharing gate routes', () => {
  assert.equal(isAnonymousCoursewareRoute('/courseware'), true);
  assert.equal(isAnonymousCoursewareRoute('/courseware/versions'), true);
  assert.equal(isAnonymousCoursewareRoute('/courseware/assets/upload'), true);
  assert.equal(isAnonymousCoursewareRoute('/courseware/narration/run'), true);
  assert.equal(isAnonymousCoursewareRoute('/courseware/search/run'), true);
  assert.equal(isAnonymousCoursewareRoute('/courseware/doc/read'), true);
  assert.equal(isAnonymousCoursewareRoute('/courseware/image/replicate-html'), true);
  // list is gate-open so pure members can reach requireRequestSession + assertOrgIdAccess
  assert.equal(isAnonymousCoursewareRoute('/courseware/list'), true);
  assert.equal(isMemberSessionCoursewareRoute('/courseware/list'), true);
  assert.equal(isLoginRequiredCoursewareRoute('/courseware/sharing'), true);
  assert.equal(isAnonymousCoursewareRoute('/courseware/sharing'), false);
  assert.equal(isAnonymousCoursewareRoute('/courseware/stream'), false);
  assert.equal(isAnonymousCoursewareRoute('/courseware/stream/publish'), false);
  assert.equal(isAnonymousCoursewareRoute('/chat'), false);
});
