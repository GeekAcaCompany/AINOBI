// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { formatAgentCurrentTime } from './agent-current-time.ts';

test('formatAgentCurrentTime uses fixed instant and TZ', () => {
  const prevTz = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';

  try {
    const fixed = new Date('2026-05-25T01:31:00.000Z');
    const out = formatAgentCurrentTime(fixed);

    assert.equal(out.isoUtc, '2026-05-25T01:31:00.000Z');
    assert.equal(out.timeZone, 'Asia/Shanghai');
    assert.match(out.localLabel, /2026-05-25/);
    assert.match(out.promptLine, /Current time \(host\)/);
    assert.match(out.promptLine, /Asia\/Shanghai/);
  } finally {
    if (prevTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = prevTz;
    }
  }
});
