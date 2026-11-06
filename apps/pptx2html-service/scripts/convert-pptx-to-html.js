#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable no-console */

require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const { closeQuietly, convertPptxBufferOnPage, createConverterPage, launchBrowser } = require('../src/converter-page');
const { createServiceConfig } = require('../src/config');
const { renderHtmlOutput } = require('../src/html-output');
const { mountRuntimeStatic } = require('../src/static-runtime');

function usage() {
  return [
    'Usage:',
    '  node scripts/convert-pptx-to-html.js <input.pptx> [-o <output.html>] [-p <page>]',
    '',
    'Options:',
    '  -o, --out       Output html filename',
    '  -p, --page      Render only one page, starting from 1',
    '      --slide     Alias for --page',
    '  -h, --help      Show help',
    '',
    'Examples:',
    '  node scripts/convert-pptx-to-html.js ./presentation.pptx',
    '  node scripts/convert-pptx-to-html.js ./presentation.pptx -o ./out.html',
    '  node scripts/convert-pptx-to-html.js ./presentation.pptx --page 3 -o ./page-3.html',
  ].join('\n');
}

function parsePage(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }
  return page;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let input;
  let out;
  let page = null;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      return { help: true };
    }
    if (a === '-o' || a === '--out') {
      out = args[i + 1];
      i += 1;
      continue;
    }
    if (a === '-p' || a === '--page' || a === '--slide') {
      page = parsePage(args[i + 1]);
      if (page == null) {
        return { error: new Error('`page` must be a positive integer starting from 1') };
      }
      i += 1;
      continue;
    }
    if (!input) {
      input = a;
      continue;
    }
  }

  if (!input) return { error: new Error('Missing input.pptx argument') };
  return { input, out, page };
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    console.log(usage());
    process.exit(0);
  }
  if (parsed.error) {
    console.error(parsed.error.message);
    console.log(usage());
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const inputPath = path.resolve(repoRoot, parsed.input);
  const inputBase = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.resolve(repoRoot, parsed.out || `${inputBase}.html`);

  const inputExt = path.extname(inputPath).toLowerCase();
  if (inputExt !== '.pptx') {
    console.error(`Input must be .pptx, got: ${inputExt || '(none)'}`);
    process.exit(1);
  }

  const stat = await fs.stat(inputPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Runtime assets use absolute `/runtime/...` URLs, so the CLI hosts them briefly.
  const app = express();
  mountRuntimeStatic(app, repoRoot);
  const httpServer = app.listen(0);
  const port = await new Promise((resolve) => {
    httpServer.once('listening', () => resolve(httpServer.address().port));
  });

  const config = createServiceConfig({
    rootDir: repoRoot,
    port,
    runtimeUrl: `http://127.0.0.1:${port}/runtime/converter.html`,
  });
  const browser = await launchBrowser(config);
  const page = await createConverterPage(browser, config);
  try {
    const buf = await fs.readFile(inputPath);
    const fragment = await convertPptxBufferOnPage(page, buf, { page: parsed.page });
    const html = await renderHtmlOutput(fragment);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, html, 'utf8');
    console.log(`OK: ${path.relative(repoRoot, outputPath)}`);
  } finally {
    await closeQuietly(page);
    await closeQuietly(browser);
    httpServer.close();
  }
}

main().catch((err) => {
  console.error('Conversion failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});

