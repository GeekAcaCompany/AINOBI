// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCoursewareUiLinks } from './codex-mcp-tools.ts';

describe('buildCoursewareUiLinks', () => {
  const baseSpec = {
    studentOrigin: 'https://student.example.com/',
    manageOrigin: 'https://manage.example.com',
    handoffCode: 'h'.repeat(43),
    coursewareId: 'cw-1',
    orgId: 'org-1',
    manageCourseId: 'course-9',
  };

  it('leaves the manage links out when there is no manage app', () => {
    const { links, paths } = buildCoursewareUiLinks({ ...baseSpec, manageOrigin: null });

    assert.deepEqual(Object.keys(links).sort(), ['courseware_editor', 'courseware_preview']);
    assert.deepEqual(Object.keys(paths).sort(), ['courseware_editor', 'courseware_preview']);
  });

  it('builds preview/editor/manage links with the handoff code', () => {
    const { links, paths } = buildCoursewareUiLinks(baseSpec);

    const preview = new URL(links.courseware_preview);
    assert.equal(preview.origin, 'https://student.example.com');
    assert.equal(preview.pathname, '/courseware-preview');
    assert.equal(preview.searchParams.get('courseware_id'), 'cw-1');
    assert.equal(preview.searchParams.get('handoff'), 'h'.repeat(43));

    const editor = new URL(links.courseware_editor);
    assert.equal(editor.pathname, '/courseware-editor');
    assert.equal(editor.searchParams.get('courseware_id'), 'cw-1');

    const manage = new URL(links.manage_course);
    assert.equal(manage.origin, 'https://manage.example.com');
    assert.equal(manage.pathname, '/course/course-9');
    assert.equal(manage.searchParams.get('handoff'), 'h'.repeat(43));
    assert.equal(manage.searchParams.get('org_id'), 'org-1');

    // paths mirror links without the origin
    assert.equal(paths.courseware_preview, `/courseware-preview?courseware_id=cw-1&handoff=${'h'.repeat(43)}`);
    assert.equal(paths.manage_course, `/course/course-9?handoff=${'h'.repeat(43)}&org_id=org-1`);
  });

  it('falls back to the manage course list when unbound and omits org when unknown', () => {
    const { links, paths } = buildCoursewareUiLinks({
      ...baseSpec,
      manageCourseId: null,
      orgId: null,
    });
    const manage = new URL(links.manage_course);
    assert.equal(manage.pathname, '/course');
    assert.equal(manage.searchParams.get('org_id'), null);
    assert.equal(paths.manage_course, `/course?handoff=${'h'.repeat(43)}`);
  });

  it('URL-encodes unsafe characters in ids', () => {
    const { links } = buildCoursewareUiLinks({
      ...baseSpec,
      handoffCode: 'a/b+c=d',
      coursewareId: 'cw 1',
    });
    const preview = new URL(links.courseware_preview);
    assert.equal(preview.searchParams.get('courseware_id'), 'cw 1');
    assert.equal(preview.searchParams.get('handoff'), 'a/b+c=d');
  });
});
