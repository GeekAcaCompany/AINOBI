// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AinobiAuthorizedSession } from './ainobi-user-session.ts';
import {
  assertBindingOrgMatchesCourseware,
  assertOrgIdAccess,
  assertOrgIdManageAccess,
  canAccessCoursewareOrg,
  canAccessOrgAsMember,
  canManageOrg,
  CoursewareOrgAccessError,
} from './ainobi-org-access.ts';

function session(overrides: Partial<AinobiAuthorizedSession> = {}): AinobiAuthorizedSession {
  return {
    roles: [],
    user: {
      user_id: 'user-1',
      user_name: 'Test User',
      account_name: 'test_user',
      email: null,
      user_status: 'active',
      user_avatar_url: null,
      user_type: 'normal',
    },
    organization: null,
    permissions: ['user:manage_login'],
    userId: 'user-1',
    permissionUserId: 'user-1',
    currentOrgId: 'org-current',
    accessToken: 'token-1',
    expireAt: new Date(Date.now() + 3600_000).toISOString(),
    isOrgAgent: false,
    ...overrides,
  };
}

function agentSession(overrides: Partial<AinobiAuthorizedSession> = {}): AinobiAuthorizedSession {
  return session({
    permissions: [],
    isOrgAgent: true,
    user: {
      user_id: 'agent-1',
      user_name: 'Bot',
      account_name: 'bot',
      email: null,
      user_status: 'active',
      user_avatar_url: null,
      user_type: 'agent',
    },
    userId: 'agent-1',
    permissionUserId: 'owner-1',
    ...overrides,
  });
}

test('canAccessCoursewareOrg / canManageOrg denies without managed_list (unit: no API)', async () => {
  // Without stubbing resolveManagedOrgIds, foreign/same org both fail when API returns empty.
  assert.equal(await canAccessCoursewareOrg(session(), { orgId: 'org-current' }), false);
  assert.equal(await canManageOrg(session(), 'org-current'), false);
});

test('canAccessOrgAsMember denies without membership list (unit: no API)', async () => {
  assert.equal(await canAccessOrgAsMember(session(), 'org-current'), false);
});

test('canAccessCoursewareOrg allows same org for org Agent without manage_login', async () => {
  const allowed = await canAccessCoursewareOrg(agentSession({ permissions: ['course:query'] }), {
    orgId: 'org-current',
  });
  assert.equal(allowed, true);
});

test('canAccessCoursewareOrg denies cross-org for org Agent', async () => {
  const allowed = await canAccessCoursewareOrg(agentSession(), { orgId: 'org-other' });
  assert.equal(allowed, false);
});

test('assertOrgIdAccess allows same org for org Agent without member list', async () => {
  await assert.doesNotReject(() => assertOrgIdAccess(agentSession(), 'org-current'));
  await assert.doesNotReject(() => assertOrgIdAccess(agentSession(), 'ORG-Current'));
});

test('assertOrgIdAccess denies cross-org for org Agent', async () => {
  await assert.rejects(
    () => assertOrgIdAccess(agentSession(), 'org-other'),
    (error: unknown) => {
      assert.ok(error instanceof CoursewareOrgAccessError);
      assert.equal(error.status, 403);
      return true;
    },
  );
});

test('assertOrgIdManageAccess allows same org for org Agent', async () => {
  await assert.doesNotReject(() => assertOrgIdManageAccess(agentSession(), 'org-current'));
});

test('assertOrgIdManageAccess denies cross-org for org Agent', async () => {
  await assert.rejects(
    () => assertOrgIdManageAccess(agentSession(), 'org-other'),
    (error: unknown) => error instanceof CoursewareOrgAccessError,
  );
});

test('assertOrgIdAccess still requires member list for humans (unit: no API)', async () => {
  await assert.rejects(
    () => assertOrgIdAccess(session(), 'org-current'),
    (error: unknown) => error instanceof CoursewareOrgAccessError,
  );
});

test('canAccessCoursewareOrg denies org-less courseware (org is fixed at creation)', async () => {
  const allowed = await canAccessCoursewareOrg(session(), { orgId: null });
  assert.equal(allowed, false);
});

test('canAccessCoursewareOrg does not use currentOrgId as an access gate', async () => {
  // Even with matching currentOrgId + manage_login, access requires managed_list membership.
  const allowed = await canAccessCoursewareOrg(
    session({ currentOrgId: 'org-current', permissions: ['user:manage_login'] }),
    { orgId: 'org-current' },
  );
  assert.equal(allowed, false);
});

test('canAccessCoursewareOrg denies foreign org without managed_list check in unit test', async () => {
  const allowed = await canAccessCoursewareOrg(session(), { orgId: 'org-other' });
  assert.equal(allowed, false);
});

// --- Single-org invariant: the bound org must equal the courseware org; a courseware without an org is always refused (no claim backfill) ---

test('assertBindingOrgMatchesCourseware passes when the binding org equals the courseware org', () => {
  assertBindingOrgMatchesCourseware({ id: 'cw-1', orgId: 'org-a' }, 'org-a');
  assertBindingOrgMatchesCourseware({ id: 'cw-1', orgId: ' org-a ' }, 'org-a  ');
});

test('assertBindingOrgMatchesCourseware accepts the same UUID in a different letter case', () => {
  // Postgres returns uuid columns lowercase while clients may send uppercase;
  // a raw string compare would reject the very same organization with a 403.
  assertBindingOrgMatchesCourseware(
    { id: 'cw-1', orgId: '7C9E6679-7425-40DE-944B-E07FC1F90AE7' },
    '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  );
});

test('assertBindingOrgMatchesCourseware throws 403 naming both orgs on mismatch', () => {
  assert.throws(
    () => assertBindingOrgMatchesCourseware({ id: 'cw-1', orgId: 'org-a' }, 'org-b'),
    (error: unknown) => {
      assert.ok(error instanceof CoursewareOrgAccessError);
      assert.equal(error.status, 403);
      assert.match(error.message, /courseware org mismatch/);
      assert.match(error.message, /org-a/);
      assert.match(error.message, /org-b/);
      return true;
    },
  );
});

test('an org-less courseware cannot be bound at all (no claim-on-first-bind)', () => {
  for (const orgId of [null, '   ']) {
    assert.throws(
      () => assertBindingOrgMatchesCourseware({ id: 'cw-1', orgId }, 'org-a'),
      (error: unknown) => {
        assert.ok(error instanceof CoursewareOrgAccessError);
        assert.equal(error.status, 403);
        assert.match(error.message, /has no organization and cannot be bound/);
        return true;
      },
    );
  }
});

test('assertBindingOrgMatchesCourseware rejects an empty binding org', () => {
  assert.throws(
    () => assertBindingOrgMatchesCourseware({ id: 'cw-1', orgId: 'org-a' }, '   '),
    /binding orgId is required/,
  );
});
