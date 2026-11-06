// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * Maps `items` through `worker` with at most `limit` calls in flight, resolving to the results in
 * input order. The first rejection rejects the whole map, like Promise.all.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: width }, lane));
  return results;
}

module.exports = { mapWithConcurrency };
