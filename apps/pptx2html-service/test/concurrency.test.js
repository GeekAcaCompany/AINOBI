// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mapWithConcurrency } = require('../src/concurrency');

test('mapWithConcurrency keeps at most `limit` calls in flight and preserves order', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5 * (11 - value)));
    inFlight -= 1;
    return value * 10;
  });
  assert.equal(peak, 3);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
});

test('mapWithConcurrency rejects when a call fails and handles empty input', async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error('boom');
      return value;
    }),
    /boom/
  );
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});
