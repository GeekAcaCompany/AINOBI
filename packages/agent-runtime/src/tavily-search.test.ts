// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { runTavilySearch } from './tavily-search.ts';

const unconfigured = {
  apiKey: (): string => {
    throw new Error('TAVILY_API_KEY is not configured on the AINOBI host.');
  },
};

test('runTavilySearch rejects empty query before API call', async () => {
  let keyRead = false;
  await assert.rejects(
    () =>
      runTavilySearch(
        { query: '   ' },
        {
          apiKey: () => {
            keyRead = true;
            return 'k';
          },
        },
      ),
    /Search query is required/,
  );
  assert.equal(keyRead, false, 'the key is not read for an invalid request');
});

test('runTavilySearch surfaces the host key error', async () => {
  await assert.rejects(
    () => runTavilySearch({ query: 'test' }, unconfigured),
    /TAVILY_API_KEY is not configured/,
  );
});
