// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FISHAUDIO_CREDITS_SERVICE_CODE,
  isFishAudioCreditsConsumptionEnabled,
  resolveFishAudioCreditsServiceCode,
} from './ainobi-credits.ts';

test('resolveFishAudioCreditsServiceCode reads AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE', () => {
  const prev = process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE = DEFAULT_FISHAUDIO_CREDITS_SERVICE_CODE;
  delete process.env.AINOBI_CREDITS_DISABLED;
  try {
    assert.equal(resolveFishAudioCreditsServiceCode(), 'fishaudio-s2.1-pro');
    assert.equal(isFishAudioCreditsConsumptionEnabled(), true);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE = prev;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});
