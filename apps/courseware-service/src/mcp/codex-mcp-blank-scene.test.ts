// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBlankCoursewareScene } from './codex-mcp-blank-scene.ts';

describe('createBlankCoursewareScene', () => {
  it('records the confirmed content language in scene.metadata.language', () => {
    const scene = createBlankCoursewareScene('Demo', 'ja');
    assert.equal((scene.metadata as Record<string, unknown>).language, 'ja');
  });

  it('omits metadata.language when no language is given (legacy repair fallback)', () => {
    const scene = createBlankCoursewareScene('Demo');
    assert.equal('language' in (scene.metadata as Record<string, unknown>), false);
  });

  it('leaves the first slide unnamed so the editor can localize its label', () => {
    const scene = createBlankCoursewareScene('Demo');
    const slides = scene.slide_elements as Array<{ element_type: string; name: string }>;
    assert.equal(slides.length, 1);
    assert.equal(slides[0]?.element_type, 'slide');
    assert.equal(slides[0]?.name, '');
  });
});
