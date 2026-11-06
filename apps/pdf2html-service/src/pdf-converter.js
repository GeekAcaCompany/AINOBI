// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { createHttpError } = require('./oss-storage');

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function formatToolError(toolName, error) {
  const details = String(error.stderr || error.stdout || error.message || '').trim();
  return details ? `${toolName} failed: ${details}` : `${toolName} failed`;
}

function toSwitchValue(value) {
  return value ? '1' : '0';
}

function createPdfConverter(config) {
  async function readPageCount(pdfPath) {
    let result;
    try {
      result = await execFileAsync(config.pdfInfoPath, [pdfPath], {
        timeout: config.conversionTimeoutMs,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      throw createHttpError(formatToolError('pdfinfo', error), 422);
    }

    const match = result.stdout.match(/^Pages:\s+(\d+)\s*$/m);
    if (!match) {
      throw createHttpError('Unable to read PDF page count from pdfinfo output', 422);
    }
    return Number(match[1]);
  }

  async function convertPage(pdfPath, outputDir, page) {
    const htmlId = `slide_${page}`;
    const outputFile = `${htmlId}.html`;
    const args = [];
    if (config.pdf2html.dataDir) {
      args.push('--data-dir', config.pdf2html.dataDir);
    }
    if (config.pdf2html.popplerDataDir) {
      args.push('--poppler-data-dir', config.pdf2html.popplerDataDir);
    }
    args.push(
      '--dest-dir',
      outputDir,
      '--first-page',
      String(page),
      '--last-page',
      String(page),
      '--zoom',
      String(config.pdf2html.zoom),
      '--embed-css',
      toSwitchValue(config.pdf2html.embedCss),
      '--embed-font',
      toSwitchValue(config.pdf2html.embedFont),
      '--embed-image',
      toSwitchValue(config.pdf2html.embedImage),
      '--embed-javascript',
      toSwitchValue(config.pdf2html.embedJavascript),
      '--embed-outline',
      toSwitchValue(config.pdf2html.embedOutline),
      '--optimize-text',
      toSwitchValue(config.pdf2html.optimizeText),
      pdfPath,
      outputFile
    );

    try {
      await execFileAsync(config.pdf2htmlEXPath, args, {
        cwd: outputDir,
        timeout: config.conversionTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      throw createHttpError(formatToolError('pdf2htmlEX', error), 422);
    }

    const htmlPath = path.join(outputDir, outputFile);
    return {
      page,
      htmlId,
      html: await fs.readFile(htmlPath, 'utf8'),
    };
  }

  async function convert(buffer, options = {}) {
    await fs.mkdir(config.workDir, { recursive: true });
    const workDir = await fs.mkdtemp(path.join(config.workDir, 'job-'));
    const pdfPath = path.join(workDir, `${options.pdfId || randomUUID()}.pdf`);
    const outputDir = path.join(workDir, 'html');

    try {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(pdfPath, buffer);

      const pageCount = await readPageCount(pdfPath);
      const requestedPage = options.page || null;
      if (requestedPage != null && (requestedPage < 1 || requestedPage > pageCount)) {
        throw createHttpError(`\`page\` must be between 1 and ${pageCount}`, 400);
      }

      const pages = [];
      if (requestedPage) {
        pages.push(await convertPage(pdfPath, outputDir, requestedPage));
      } else {
        for (let page = 1; page <= pageCount; page += 1) {
          pages.push(await convertPage(pdfPath, outputDir, page));
        }
      }

      return {
        pageCount,
        pages,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  return {
    convert,
  };
}

module.exports = {
  createPdfConverter,
};
