// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeSceneDiff } from './agent-courseware-scene-diff.ts';

const sceneWithText = (x: number, y: number, fontSize: number) => ({
  scene_id: 'sc_diff',
  name: 'Test',
  slide_elements: [
    {
      element_id: 'el_slide_1',
      element_type: 'slide',
      name: '封面',
      children_elements: [
        {
          element_id: 'el_text_1',
          element_type: 'text',
          name: '文本1',
          position: { x, y },
          size: { width: 1200, height: 100 },
          font_size: fontSize,
          text: 'HelloWorld',
          align: 'center',
          color: '#333333',
        },
      ],
    },
  ],
  vtuber_elements: [],
});

test('summarizeSceneDiff reports position and font_size changes', () => {
  const before = sceneWithText(360, 480, 72);
  const after = sceneWithText(120, 80, 144);
  const summary = summarizeSceneDiff(before, after);

  assert.match(summary, /font_size: 72 → 144/);
  assert.match(summary, /position\.(x|y): 360|position\.(x|y): 480/);
  assert.match(summary, /Slide 1 "封面"/);
  assert.match(summary, /el_text_1/);
});

test('summarizeSceneDiff reports added element', () => {
  const before = sceneWithText(0, 0, 24);
  const after = {
    ...sceneWithText(0, 0, 24),
    slide_elements: [
      {
        ...sceneWithText(0, 0, 24).slide_elements[0],
        children_elements: [
          ...sceneWithText(0, 0, 24).slide_elements[0].children_elements,
          {
            element_id: 'el_text_new',
            element_type: 'text',
            name: '新文本',
            position: { x: 100, y: 200 },
            size: { width: 400, height: 60 },
            font_size: 32,
            text: 'New',
          },
        ],
      },
    ],
  };

  const summary = summarizeSceneDiff(before, after);
  assert.match(summary, /\(added\)/);
  assert.match(summary, /el_text_new/);
});
