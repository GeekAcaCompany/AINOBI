// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const {
  closeQuietly,
  convertPptxBufferOnPage,
  createConverterPage,
  getRuntimePatchVersion,
  launchBrowser,
} = require('./converter-page');

function createConverterPool(config) {
  let browserPromise;
  let pagePoolPromise;
  const pageWaiters = [];

  async function getBrowser() {
    if (!browserPromise) {
      browserPromise = launchBrowser(config);
    }
    return browserPromise;
  }

  async function createSlot(browser) {
    const page = await createConverterPage(browser, config);
    return { page, busy: false };
  }

  async function getPagePool() {
    if (!pagePoolPromise) {
      pagePoolPromise = (async () => {
        const browser = await getBrowser();
        const slots = [];
        for (let i = 0; i < config.poolSize; i += 1) {
          slots.push(await createSlot(browser));
        }
        return slots;
      })().catch((error) => {
        pagePoolPromise = null;
        throw error;
      });
    }
    return pagePoolPromise;
  }

  function releaseSlot(slot) {
    const waiter = pageWaiters.shift();
    if (waiter) {
      slot.busy = true;
      waiter(slot);
      return;
    }
    slot.busy = false;
  }

  async function acquireSlot() {
    const pool = await getPagePool();
    const freeSlot = pool.find((slot) => !slot.busy);
    if (freeSlot) {
      freeSlot.busy = true;
      return freeSlot;
    }
    return new Promise((resolve) => {
      pageWaiters.push(resolve);
    });
  }

  async function rebuildSlot(slot) {
    const browser = await getBrowser();
    await closeQuietly(slot.page);
    slot.page = await createConverterPage(browser, config);
  }

  async function convert(buffer, options) {
    const slot = await acquireSlot();
    try {
      const patchVersion = await getRuntimePatchVersion(slot.page);
      if (patchVersion !== config.runtimePatchVersion) {
        await rebuildSlot(slot);
      }
      return await convertPptxBufferOnPage(slot.page, buffer, options);
    } catch (error) {
      if (error && error.statusCode) {
        throw error;
      }
      await rebuildSlot(slot);
      return convertPptxBufferOnPage(slot.page, buffer, options);
    } finally {
      releaseSlot(slot);
    }
  }

  async function init() {
    await getPagePool();
  }

  async function close() {
    if (pagePoolPromise) {
      const pool = await pagePoolPromise;
      await Promise.all(pool.map((slot) => closeQuietly(slot.page)));
    }
    if (browserPromise) {
      await closeQuietly(await browserPromise);
    }
  }

  return {
    close,
    convert,
    init,
  };
}

module.exports = { createConverterPool };
