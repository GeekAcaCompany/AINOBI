// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const express = require('express');
const path = require('path');

// pptx-preview is served as its npm package publishes it. The repository keeps no copy of it, and
// runtime/preview-render-hooks.js makes this service's corrections from outside the library.
const PPTX_PREVIEW_BUNDLE = require.resolve('pptx-preview/dist/pptx-preview.umd.js');

function mountRuntimeStatic(app, rootDir) {
  app.get('/runtime/vendor/pptx-preview.umd.js', (_req, res) => {
    // `root` keeps the dot directories of a pnpm install out of the path that send checks.
    res.sendFile(path.basename(PPTX_PREVIEW_BUNDLE), { root: path.dirname(PPTX_PREVIEW_BUNDLE) });
  });
  app.use('/runtime', express.static(path.join(rootDir, 'runtime')));
}

module.exports = { mountRuntimeStatic, PPTX_PREVIEW_BUNDLE };
