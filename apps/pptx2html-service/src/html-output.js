// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const { minify } = require('html-minifier-terser');

/** PPTX preview output is inline-CSS/SVG heavy; keep SVG case-sensitive and skip JS minification. */
const MINIFY_OPTS = {
  caseSensitive: true,
  // PPT text is split into many inline runs; trimming run-edge spaces changes visible text.
  collapseWhitespace: false,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  // html-minifier-terser's CSS minifier can corrupt inline styles that contain
  // HTML-escaped quoted font names, dropping following declarations like bold.
  minifyCSS: false,
  minifyJS: false,
  keepClosingSlash: true,
};

function wrapStandaloneHtml(fragment) {
  if (fragment == null || typeof fragment !== 'string') {
    return fragment;
  }
  const lead = fragment.replace(/^\uFEFF/, '').trimStart();
  const probe = lead.slice(0, 12).toLowerCase();
  if (probe.startsWith('<!doctype') || probe.startsWith('<html')) {
    return fragment;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ainobi Courseware</title>
<style>
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background-color: transparent;
  }

  body {
    background-color: transparent;
  }

  #pptx-fit-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  #pptx-fit-content {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    will-change: transform;
  }
</style>
</head>
<body>
<div id="pptx-fit-viewport">
  <div id="pptx-fit-content">
${fragment}
  </div>
</div>
<script>
  (function fitContain() {
    var viewport = document.getElementById('pptx-fit-viewport');
    var content = document.getElementById('pptx-fit-content');
    if (!viewport || !content) {
      return;
    }

    function getContentSize() {
      var first = content.firstElementChild;
      if (!first) {
        return { width: 0, height: 0 };
      }
      var rect = first.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
      return { width: first.scrollWidth || 0, height: first.scrollHeight || 0 };
    }

    function applyFit() {
      content.style.transform = 'none';
      content.style.left = '0px';
      content.style.top = '0px';

      var viewportRect = viewport.getBoundingClientRect();
      var size = getContentSize();
      if (!viewportRect.width || !viewportRect.height || !size.width || !size.height) {
        return;
      }

      var scale = Math.min(viewportRect.width / size.width, viewportRect.height / size.height);
      var renderedWidth = size.width * scale;
      var renderedHeight = size.height * scale;
      var offsetX = (viewportRect.width - renderedWidth) / 2;
      var offsetY = (viewportRect.height - renderedHeight) / 2;

      content.style.left = offsetX + 'px';
      content.style.top = offsetY + 'px';
      content.style.transform = 'scale(' + scale + ')';
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyFit, { once: true });
    } else {
      applyFit();
    }

    window.addEventListener('load', applyFit);
    window.addEventListener('resize', applyFit);
  })();
</script>
</body>
</html>
`;
}

async function maybeMinifyHtml(html) {
  if (html == null || typeof html !== 'string') {
    return html;
  }
  if (process.env.HTML_MINIFY === 'false') {
    return html;
  }
  try {
    return await minify(html, MINIFY_OPTS);
  } catch (err) {
    console.warn('HTML minify skipped:', err && err.message ? err.message : err);
    return html;
  }
}

async function renderHtmlOutput(fragment) {
  return maybeMinifyHtml(wrapStandaloneHtml(fragment));
}

module.exports = {
  maybeMinifyHtml,
  renderHtmlOutput,
  wrapStandaloneHtml,
};
