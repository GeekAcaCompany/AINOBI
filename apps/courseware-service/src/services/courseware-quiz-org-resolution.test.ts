// SPDX-License-Identifier: AGPL-3.0-only
// Single-org policy tests for quiz attempt/billing org attribution: a
// courseware belongs to exactly ONE organization, assigned at creation and
// never rewritten, so the attempt org is always the courseware's own org.
// Section bindings and the login session never contribute, and a
// client-supplied org is a consistency check only (mismatch rejects).
// Attempts REQUIRE an org — an org-less courseware (legacy rows only)
// resolves to null and resolveAttemptSession rejects the evaluation before
// touching any attempt row; there is deliberately no personal, login-session,
// or section-binding fallback.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ORG_REQUIRED_FOR_QUIZ_EVALUATION_MESSAGE,
  pickQuizAttemptOrgId,
  resolveQuizAttemptOrgId,
} from './courseware-quiz-evaluation-service.ts';

test('the courseware org is authoritative when no org is supplied', () => {
  assert.equal(
    pickQuizAttemptOrgId({ fromInput: null, fromCourseware: 'cw-org' }),
    'cw-org',
  );
});

test('an org-less courseware resolves to null (rejected upstream — org is mandatory)', () => {
  assert.equal(pickQuizAttemptOrgId({ fromInput: null, fromCourseware: null }), null);
});

test('explicit input matching the courseware org is accepted', () => {
  assert.equal(
    pickQuizAttemptOrgId({ fromInput: 'cw-org', fromCourseware: 'cw-org' }),
    'cw-org',
  );
});

test('explicit input NOT matching the courseware org throws', () => {
  assert.throws(
    () => pickQuizAttemptOrgId({ fromInput: 'another-org', fromCourseware: 'cw-org' }),
    /org_id does not match authorized courseware/,
  );
});

test('explicit input with no courseware org throws the org-required error', () => {
  // Not a "mismatch": there is nothing resource-side to verify against, so the
  // error must name the real cause (org-less courseware is not evaluable).
  assert.throws(
    () => pickQuizAttemptOrgId({ fromInput: 'client-supplied-org', fromCourseware: null }),
    new RegExp(ORG_REQUIRED_FOR_QUIZ_EVALUATION_MESSAGE.slice(0, 40)),
  );
});

// --- resolveQuizAttemptOrgId ---

const CW_ID = 'cw-1';

test('resolution takes the courseware org and ignores the supplied org when it matches', () => {
  assert.equal(
    resolveQuizAttemptOrgId({
      input: { orgId: 'org-y' },
      courseware: { id: CW_ID, orgId: 'org-y' },
    }),
    'org-y',
  );
});

test('resolution takes the courseware org when no org is supplied', () => {
  assert.equal(
    resolveQuizAttemptOrgId({
      input: { orgId: undefined },
      courseware: { id: CW_ID, orgId: 'org-y' },
    }),
    'org-y',
  );
});

test('P1 regression: a client-supplied foreign org is rejected even if bound there', () => {
  // The section-binding table can no longer launder a client-supplied org into
  // the attribution — only the courseware's own org counts.
  assert.throws(
    () =>
      resolveQuizAttemptOrgId({
        input: { orgId: 'org-z' },
        courseware: { id: CW_ID, orgId: 'org-y' },
      }),
    /org_id does not match authorized courseware/,
  );
});

test('an org-less courseware is not evaluable, with or without a supplied org', () => {
  assert.equal(
    resolveQuizAttemptOrgId({
      input: { orgId: undefined },
      courseware: { id: CW_ID, orgId: null },
    }),
    null,
  );
  assert.throws(
    () =>
      resolveQuizAttemptOrgId({
        input: { orgId: 'org-p' },
        courseware: { id: CW_ID, orgId: null },
      }),
    new RegExp(ORG_REQUIRED_FOR_QUIZ_EVALUATION_MESSAGE.slice(0, 40)),
  );
});

test('a supplied org matching the courseware org in a different letter case is accepted', () => {
  // uuid columns come back lowercase from Postgres; a client may send uppercase.
  assert.equal(
    resolveQuizAttemptOrgId({
      input: { orgId: '7C9E6679-7425-40DE-944B-E07FC1F90AE7' },
      courseware: { id: CW_ID, orgId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
    }),
    '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  );
});

test('blank-string org ids normalize to null before resolution', () => {
  assert.equal(
    resolveQuizAttemptOrgId({
      input: { orgId: '   ' },
      courseware: { id: CW_ID, orgId: '  org-y  ' },
    }),
    'org-y',
  );
  assert.equal(
    resolveQuizAttemptOrgId({
      input: { orgId: '   ' },
      courseware: { id: CW_ID, orgId: '   ' },
    }),
    null,
  );
});
