// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MINIMAX_CREDITS_SERVICE_CODE,
  isMinimaxCreditsConsumptionEnabled,
  normalizeAinobiServiceCode,
  resolveMinimaxCreditsServiceCode,
} from './ainobi-credits.ts';

test('resolveMinimaxCreditsServiceCode reads AINOBI_MINIMAX_CREDITS_SERVICE_CODE', () => {
  const prev = process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE = DEFAULT_MINIMAX_CREDITS_SERVICE_CODE;
  delete process.env.AINOBI_CREDITS_DISABLED;
  try {
    assert.equal(resolveMinimaxCreditsServiceCode(), 'speech-2.8-hd');
    assert.equal(
      normalizeAinobiServiceCode(DEFAULT_MINIMAX_CREDITS_SERVICE_CODE),
      'speech-2_8-hd',
    );
    assert.equal(isMinimaxCreditsConsumptionEnabled(), true);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE = prev;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});
