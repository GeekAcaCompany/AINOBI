// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { COURSE_SECTION_QUERY_PERMISSION } from '../auth/ainobi-user-session.ts';
import type { SectionReadAccess } from './ainobi-section-access.ts';
import {
  allowsAnonymousCoursewareRead,
  allowsAnonymousCoursewareWrite,
  canListSectionBindingsViaEnrolledSection,
  canReadCoursewareViaEnrolledSection,
  canReadCoursewareViaSectionBinding,
  resolveRequestSectionId,
} from './courseware-org-guard.ts';

test('allowsAnonymousCoursewareRead when is_share or is_public', () => {
  assert.equal(allowsAnonymousCoursewareRead({ isShare: true, isPublic: false }), true);
  assert.equal(allowsAnonymousCoursewareRead({ isShare: false, isPublic: true }), true);
  assert.equal(allowsAnonymousCoursewareRead({ isShare: false, isPublic: false }), false);
});

test('allowsAnonymousCoursewareWrite only when is_public', () => {
  assert.equal(allowsAnonymousCoursewareWrite({ isPublic: true }), true);
  assert.equal(allowsAnonymousCoursewareWrite({ isPublic: false }), false);
});

test('canReadCoursewareViaSectionBinding requires course_section:query and section binding', () => {
  const session = {
    permissions: [COURSE_SECTION_QUERY_PERMISSION],
  };
  assert.equal(canReadCoursewareViaSectionBinding(session, true), true);
  assert.equal(canReadCoursewareViaSectionBinding(session, false), false);
  assert.equal(
    canReadCoursewareViaSectionBinding({ permissions: ['course:query'] }, true),
    false,
  );
  // Whether the binding holds is decided by the caller from membership of the courseware's org + the section binding.
  assert.equal(
    canReadCoursewareViaSectionBinding(
      { permissions: [COURSE_SECTION_QUERY_PERMISSION] },
      true,
    ),
    true,
  );
});

// --- Step ④: enrolled students (including external students of public courses) pass through the backend's section readability check (issue #825) ---

test('resolveRequestSectionId reads sectionId or section_id from the request query', () => {
  const req = (url: string) => ({ url }) as Parameters<typeof resolveRequestSectionId>[0];
  const secA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const secB = '1B671A64-40D5-491E-99B0-DA01FF1F3341';

  assert.equal(resolveRequestSectionId(req(`/courseware?key=k&sectionId=${secA}`)), secA);
  assert.equal(resolveRequestSectionId(req(`/courseware/quiz/answers?section_id=${secB}`)), secB);
  assert.equal(resolveRequestSectionId(req('/courseware?key=k')), null);
  assert.equal(resolveRequestSectionId(req('/courseware?sectionId=%20%20')), null);
  // uuid column guard (R9): non-UUIDs always count as undeclared and never reach the DB query
  assert.equal(resolveRequestSectionId(req('/courseware?sectionId=bad')), null);
  assert.equal(resolveRequestSectionId(req("/courseware?sectionId=1'or'1'='1")), null);
});

const ENROLLED_SESSION = { accessToken: 'token-1' };

function binding(sectionId: string, orgId = 'org-a', courseId = 'course-a') {
  return { sectionId, orgId, courseId };
}

function granted(orgId = 'org-a', courseId = 'course-a'): SectionReadAccess {
  return { canRead: true, orgId, courseId, chapterId: 'chapter-a' };
}

const DENIED: SectionReadAccess = { canRead: false, orgId: null, courseId: null, chapterId: null };

test('canReadCoursewareViaEnrolledSection grants when the claimed section is bound, readable, and org/course match', async () => {
  const lookedUp: Array<[string, string]> = [];
  const probed: string[] = [];
  const allowed = await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', 'sec-1', {
    findBinding: async (coursewareId, sectionId) => {
      lookedUp.push([coursewareId, sectionId]);
      return binding('sec-1');
    },
    fetchAccess: async (_token, sectionId) => {
      probed.push(sectionId);
      return granted();
    },
  });

  assert.equal(allowed, true);
  assert.deepEqual(lookedUp, [['cw-1', 'sec-1']]);
  assert.deepEqual(probed, ['sec-1']);
});

test('canReadCoursewareViaEnrolledSection matches org/course across UUID letter case', async () => {
  const allowed = await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', 'sec-1', {
    findBinding: async () => binding('sec-1', 'ORG-A', 'COURSE-A'),
    fetchAccess: async () => granted('org-a', 'course-a'),
  });

  assert.equal(allowed, true);
});

test('canReadCoursewareViaEnrolledSection denies without a claimed sectionId and touches nothing', async () => {
  let bindingLookups = 0;
  let probeCount = 0;
  const deps = {
    findBinding: async () => {
      bindingLookups += 1;
      return binding('sec-1');
    },
    fetchAccess: async () => {
      probeCount += 1;
      return granted();
    },
  };

  assert.equal(await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', null, deps), false);
  assert.equal(await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', '   ', deps), false);
  assert.equal(bindingLookups, 0);
  assert.equal(probeCount, 0);
});

test('canReadCoursewareViaEnrolledSection denies when the claimed section is not bound to the courseware', async () => {
  // sectionId is client input: without a binding row it must not be probed, or any section with rights could claim any courseware
  let probeCount = 0;
  const allowed = await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', 'sec-x', {
    findBinding: async () => null,
    fetchAccess: async () => {
      probeCount += 1;
      return granted();
    },
  });

  assert.equal(allowed, false);
  assert.equal(probeCount, 0);
});

test('canReadCoursewareViaEnrolledSection denies when the probe denies', async () => {
  const allowed = await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', 'sec-1', {
    findBinding: async () => binding('sec-1'),
    fetchAccess: async () => DENIED,
  });

  assert.equal(allowed, false);
});

test('canReadCoursewareViaEnrolledSection denies on org or course mismatch even when readable', async () => {
  const orgMismatch = await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', 'sec-1', {
    findBinding: async () => binding('sec-1', 'org-a'),
    fetchAccess: async () => granted('org-other'),
  });
  const courseMismatch = await canReadCoursewareViaEnrolledSection(ENROLLED_SESSION, 'cw-1', 'sec-1', {
    findBinding: async () => binding('sec-1', 'org-a', 'course-a'),
    fetchAccess: async () => granted('org-a', 'course-other'),
  });

  assert.equal(orgMismatch, false);
  assert.equal(courseMismatch, false);
});

// --- Enrollment fallback of binding-list (issue #825) ---

test('canListSectionBindingsViaEnrolledSection grants when section readable and org matches', async () => {
  const allowed = await canListSectionBindingsViaEnrolledSection(
    ENROLLED_SESSION,
    { sectionId: 'sec-1', orgId: 'ORG-A' },
    async () => granted('org-a'),
  );

  assert.equal(allowed, true);
});

test('canListSectionBindingsViaEnrolledSection checks courseId when the request carries one', async () => {
  const matching = await canListSectionBindingsViaEnrolledSection(
    ENROLLED_SESSION,
    { sectionId: 'sec-1', orgId: 'org-a', courseId: 'COURSE-A' },
    async () => granted('org-a', 'course-a'),
  );
  const mismatching = await canListSectionBindingsViaEnrolledSection(
    ENROLLED_SESSION,
    { sectionId: 'sec-1', orgId: 'org-a', courseId: 'course-b' },
    async () => granted('org-a', 'course-a'),
  );

  assert.equal(matching, true);
  assert.equal(mismatching, false);
});

test('canListSectionBindingsViaEnrolledSection denies when probe denies or org mismatches', async () => {
  const deniedProbe = await canListSectionBindingsViaEnrolledSection(
    ENROLLED_SESSION,
    { sectionId: 'sec-1', orgId: 'org-a' },
    async () => DENIED,
  );
  const orgMismatch = await canListSectionBindingsViaEnrolledSection(
    ENROLLED_SESSION,
    { sectionId: 'sec-1', orgId: 'org-a' },
    async () => granted('org-other'),
  );

  assert.equal(deniedProbe, false);
  assert.equal(orgMismatch, false);
});
