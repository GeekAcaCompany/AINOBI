// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const { minify } = require('html-minifier-terser');

/** pdf2htmlEX output is inline-CSS/SVG heavy; keep SVG case-sensitive and skip JS minification. */
const MINIFY_OPTS = {
  caseSensitive: true,
  collapseWhitespace: false,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  minifyCSS: true,
  minifyJS: false,
  keepClosingSlash: true,
};

const CONTAIN_STYLE = `<style id="ainobi-contain-style">
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background-color: transparent;
}
body {
  position: relative;
  background-color: transparent;
}
.pc {
  display: block !important;
}
.ainobi-contain-target {
  position: absolute !important;
  top: 50% !important;
  left: 50% !important;
  margin: 0 !important;
  transform-origin: center center;
}
</style>`;

const CONTAIN_SCRIPT = `<script id="ainobi-contain-script">
(function () {
  var pending = false;

  function viewportSize() {
    var viewport = window.visualViewport;
    return {
      width: viewport && viewport.width ? viewport.width : document.documentElement.clientWidth || window.innerWidth,
      height: viewport && viewport.height ? viewport.height : document.documentElement.clientHeight || window.innerHeight
    };
  }

  function applyContain() {
    pending = false;
    var page = document.querySelector('.pf');
    var target = page;
    if (!target) return;

    target.classList.add('ainobi-contain-target');
    target.style.transform = 'none';

    var width = target.offsetWidth || target.clientWidth;
    var height = target.offsetHeight || target.clientHeight;
    if (!width || !height) return;

    var viewport = viewportSize();
    var scale = Math.min(viewport.width / width, viewport.height / height);
    if (!isFinite(scale) || scale <= 0) return;

    target.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  }

  function scheduleContain() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(applyContain);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleContain, { once: true });
  } else {
    scheduleContain();
  }

  window.addEventListener('load', scheduleContain);
  window.addEventListener('resize', scheduleContain);
  window.addEventListener('orientationchange', scheduleContain);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleContain);
    window.visualViewport.addEventListener('scroll', scheduleContain);
  }
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(scheduleContain);
    observer.observe(document.documentElement);
    observer.observe(document.body);
  }
})();
</script>`;

function stripPdf2HtmlShell(html) {
  if (html == null || typeof html !== 'string') {
    return html;
  }

  let output = html;

  // Remove sidebar block entirely, not just hide.
  output = output.replace(/<div id="sidebar"[\s\S]*?<\/div>\s*(?=<div id="page-container")/i, '');

  // Remove page-container wrapper while keeping its inner page nodes.
  output = output.replace(/<div id="page-container"[^>]*>/i, '');
  output = output.replace(/<\/div>\s*(?=<div class="loading-indicator")/i, '');

  // pdf2htmlEX's viewer runtime expects sidebar/container nodes; remove it with the shell.
  output = output.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (script) =>
    script.includes('pdf2htmlEX') ? '' : script
  );
  output = output.replace(/<style>\s*@media screen\{\.pc\{display:none;\}\}\s*<\/style>/i, '');
  output = output.replace(/<div class="loading-indicator"[\s\S]*?<\/div>\s*/i, '');
  output = output.replace(/(?:-webkit-|-moz-)?box-shadow\s*:\s*[^;}]+;?/gi, '');

  return output;
}

function maybeApplyContainLayout(html) {
  if (html == null || typeof html !== 'string') {
    return html;
  }
  if (process.env.HTML_CONTAIN === 'false') {
    return html;
  }
  if (html.includes('id="ainobi-contain-script"')) {
    return html;
  }

  const stripped = stripPdf2HtmlShell(html);

  if (/<\/head>/i.test(stripped)) {
    return stripped.replace(/<\/head>/i, `${CONTAIN_STYLE}\n</head>`).replace(/<\/body>/i, `${CONTAIN_SCRIPT}\n</body>`);
  }
  if (/<\/body>/i.test(stripped)) {
    return stripped.replace(/<\/body>/i, `${CONTAIN_STYLE}\n${CONTAIN_SCRIPT}\n</body>`);
  }
  return `${CONTAIN_STYLE}\n${stripped}\n${CONTAIN_SCRIPT}`;
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

async function renderHtmlOutput(html) {
  return maybeMinifyHtml(maybeApplyContainLayout(html));
}

module.exports = {
  maybeApplyContainLayout,
  maybeMinifyHtml,
  renderHtmlOutput,
  stripPdf2HtmlShell,
};
