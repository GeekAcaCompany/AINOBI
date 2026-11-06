// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const puppeteer = require('puppeteer-core');

function createLaunchOptions(config) {
  const launchOptions = {
    headless: config.puppeteer.headless,
    args: config.puppeteer.args,
  };
  if (config.puppeteer.executablePath) {
    launchOptions.executablePath = config.puppeteer.executablePath;
  }
  return launchOptions;
}

async function launchBrowser(config) {
  return puppeteer.launch(createLaunchOptions(config));
}

async function createConverterPage(browser, config) {
  const page = await browser.newPage();
  await page.goto(config.runtimeUrl, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => window.__runtimeReady === true && typeof window.__convertPptxBase64 === 'function',
    { timeout: config.runtimeReadyTimeoutMs }
  );
  return page;
}

async function convertPptxBufferOnPage(page, buffer, options = {}) {
  const base64 = buffer.toString('base64');
  try {
    return await page.evaluate(
      async (encoded, convertOptions) => window.__convertPptxBase64(encoded, convertOptions),
      base64,
      options
    );
  } catch (error) {
    if (error && /Page \d+ exceeds slide count \d+/.test(error.message || '')) {
      error.statusCode = 400;
    }
    throw error;
  }
}

async function getRuntimePatchVersion(page) {
  return page.evaluate(() => window.__runtimePatchVersion || '');
}

async function closeQuietly(resource) {
  if (!resource || typeof resource.close !== 'function') {
    return;
  }
  try {
    await resource.close();
  } catch (_) {
    // Best-effort cleanup for browser/page shutdown.
  }
}

module.exports = {
  closeQuietly,
  convertPptxBufferOnPage,
  createConverterPage,
  getRuntimePatchVersion,
  launchBrowser,
};
