// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hooks = require('../runtime/preview-render-hooks');
const { PPTX_PREVIEW_BUNDLE } = require('../src/static-runtime');

function style() {
  const values = {};
  values.setProperty = (name, value) => {
    values[name] = value;
  };
  return values;
}

function element(tagName, children = [], className = '') {
  return {
    tagName,
    className,
    children,
    style: style(),
    get firstElementChild() {
      return children[0] || null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function pictureElement() {
  return element('DIV', [element('DIV', [element('IMG')])]);
}

function pictureNode(extra) {
  return { source: { 'p:blipFill': {} }, extend: { w: 40, h: 20 }, ...extra };
}

function unfilledShape(border) {
  return { source: { 'p:spPr': { 'a:ln': { 'a:noFill': {} } } }, border };
}

test('a shape line with a:noFill loses the border its theme style gave it', () => {
  const unfilled = unfilledShape({ width: 2, color: { color: '#000' }, type: 'dash' });
  const filled = { source: { 'p:spPr': { 'a:ln': {} } }, border: { width: 2, color: { color: '#000' } } };
  hooks.prepareNode({ nodes: [unfilled, filled] });
  assert.deepEqual(unfilled.border, { width: 0, color: null, type: 'dash' });
  assert.deepEqual(filled.border, { width: 2, color: { color: '#000' } });
});

test('a table cell side left undefined by a:noFill becomes a zero border', () => {
  const cell = {
    props: { border: { left: undefined, top: { width: 1 } } },
    inheritTcStyle: { border: { bottom: undefined } },
  };
  hooks.prepareNode({ tableGrid: { gridCol: [] }, tr: [{ td: [cell] }] });
  assert.deepEqual(cell.props.border, { left: { width: 0, color: null }, top: { width: 1 } });
  assert.deepEqual(cell.inheritTcStyle.border, { bottom: { width: 0, color: null } });
});

test('a merged cell is as wide as the columns it spans', () => {
  const grid = [{ width: 10 }, { width: 20 }, { width: 30 }];
  assert.equal(hooks.cellWidth(grid, 0, {}), 10);
  assert.equal(hooks.cellWidth(grid, 1, { gridSpan: 2 }), 50);
  assert.equal(hooks.cellWidth(grid, 2, { gridSpan: 3 }), 30);
  assert.equal(hooks.cellWidth([], 0, {}), 30);
});

test('a table fills its frame and skips merged-away cells when sizing', () => {
  const first = element('TD');
  const second = element('TD');
  const table = element('TABLE', [element('TR', [first, second])]);
  const node = {
    tableGrid: { gridCol: [{ width: 10 }, { width: 20 }, { width: 30 }] },
    tr: [{ td: [{ props: { gridSpan: 2 } }, { props: { hMerge: true } }, { props: {} }] }],
  };
  hooks.finishNode(node, element('DIV', [table]));
  assert.equal(table.style.width, '100%');
  assert.equal(table.style.height, '100%');
  assert.equal(first.style.width, '30px');
  assert.equal(second.style.width, '30px');
});

test('a picture gets its box, flip, and rotation, also inside a group', () => {
  assert.equal(
    hooks.pictureTransform({ flipH: true, flipV: true, rotate: 45 }),
    'scaleX(-1) scaleY(-1) rotate(45deg)'
  );
  assert.equal(hooks.pictureTransform({ rotate: 0 }), '');

  const plain = pictureElement();
  hooks.finishNode(pictureNode(), plain);
  assert.equal(plain.style.width, '40px');
  assert.equal(plain.style.height, '20px');
  assert.equal(plain.style.transform, undefined);

  const nested = pictureElement();
  const shape = element('DIV', [], 'shape-wrapper shape-rect');
  const inner = element('DIV', [nested], 'group');
  const group = { nodes: [{ border: {}, source: {} }, { nodes: [pictureNode({ flipH: true })] }] };
  hooks.finishNode(group, element('DIV', [shape, inner], 'group'));
  assert.equal(nested.style.transform, 'scaleX(-1)');
  assert.equal(nested.style['transform-origin'], 'center center');
});

test('install wraps each renderer the previewer creates, and refuses an unknown one', () => {
  const previewer = hooks.install({});
  const widths = [];
  previewer.htmlRender = {
    _renderNode(node) {
      widths.push(node.border.width);
      return null;
    },
  };
  previewer.htmlRender._renderNode(unfilledShape({ width: 3 }));
  assert.deepEqual(widths, [0]);
  assert.throws(() => {
    previewer.htmlRender = {};
  }, /no longer exposes the node renderer/);
});

test('pptx-preview is served from the installed package and the repository keeps no copy', () => {
  assert.ok(fs.existsSync(PPTX_PREVIEW_BUNDLE));
  assert.ok(PPTX_PREVIEW_BUNDLE.split(path.sep).includes('node_modules'));
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'runtime', 'vendor', 'pptx-preview.umd.js')), false);
});
