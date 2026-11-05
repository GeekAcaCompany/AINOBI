// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { runTavilySearch } from './tavily-search.ts';

test('runTavilySearch rejects empty query before API call', async () => {
  await assert.rejects(
    () => runTavilySearch({ query: '   ' }),
    /Search query is required/,
  );
});

test('runTavilySearch requires TAVILY_API_KEY', async () => {
  const prev = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    await assert.rejects(
      () => runTavilySearch({ query: 'test' }),
      /TAVILY_API_KEY is not configured/,
    );
  } finally {
    if (prev === undefined) {
      delete process.env.TAVILY_API_KEY;
    } else {
      process.env.TAVILY_API_KEY = prev;
    }
  }
});
