// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COURSEWARE_BOUND_COURSE_COUNT_SQL,
  COURSEWARE_BOUND_EXISTS_SQL,
  COURSEWARE_SCENE_COUNT_SQL,
  deriveBindingStats,
  resolveCoursewareExtrasFromRaw,
} from './courseware-service.ts';

test('deriveBindingStats: unbound = all - bound', () => {
  assert.deepEqual(deriveBindingStats(8, 5), { all: 8, bound: 5, unbound: 3 });
});

test('deriveBindingStats: unbound is clamped at 0 (over-drawn drift cannot go negative)', () => {
  assert.deepEqual(deriveBindingStats(10, 10), { all: 10, bound: 10, unbound: 0 });
  assert.deepEqual(deriveBindingStats(0, 0), { all: 0, bound: 0, unbound: 0 });
});

test('resolveCoursewareExtrasFromRaw: numeric strings from the driver are normalized', () => {
  const extras = resolveCoursewareExtrasFromRaw({
    cw_id: 'cw-1',
    bound_course_count: '2',
    scene_count: '7',
  });
  assert.deepEqual(extras, { isBound: true, boundCourseCount: 2, sceneCount: 7 });
});

test('resolveCoursewareExtrasFromRaw: zero bindings -> not bound; missing scenes -> null', () => {
  const extras = resolveCoursewareExtrasFromRaw({
    cw_id: 'cw-2',
    bound_course_count: '0',
    scene_count: null,
  });
  assert.equal(extras.isBound, false);
  assert.equal(extras.boundCourseCount, 0);
  assert.equal(extras.sceneCount, null);
});

test('binding SQL fragments cover both binding tables', () => {
  assert.match(COURSEWARE_BOUND_EXISTS_SQL, /courseware_course_binding/);
  assert.match(COURSEWARE_BOUND_EXISTS_SQL, /courseware_section_binding/);
  assert.match(COURSEWARE_BOUND_EXISTS_SQL, /\bOR\b/);
  assert.match(COURSEWARE_BOUND_COURSE_COUNT_SQL, /UNION/);
  assert.match(COURSEWARE_SCENE_COUNT_SQL, /jsonb_array_length\(cw\.content -> 'scenes'\)/);
});
