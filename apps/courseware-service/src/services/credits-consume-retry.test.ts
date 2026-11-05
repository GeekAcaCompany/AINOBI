// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  immediateRetryDelayMs,
  isRetryableCreditsConsumeError,
  queueRetryBackoffMs,
} from './credits-consume-retry.ts';
import { AinobiCreditsConsumeError } from './ainobi-credits.ts';

test('isRetryableCreditsConsumeError treats 5xx and 503 as retryable', () => {
  assert.equal(isRetryableCreditsConsumeError(new AinobiCreditsConsumeError('x', 503)), true);
  assert.equal(isRetryableCreditsConsumeError(new AinobiCreditsConsumeError('x', 502)), true);
  assert.equal(isRetryableCreditsConsumeError(new AinobiCreditsConsumeError('x', 500)), true);
  assert.equal(isRetryableCreditsConsumeError(new AinobiCreditsConsumeError('x', 429)), true);
});

test('isRetryableCreditsConsumeError treats balance and validation as non-retryable', () => {
  assert.equal(isRetryableCreditsConsumeError(new AinobiCreditsConsumeError('x', 402)), false);
  assert.equal(isRetryableCreditsConsumeError(new AinobiCreditsConsumeError('x', 400)), false);
  assert.equal(isRetryableCreditsConsumeError(new AinobiCreditsConsumeError('x', 401)), false);
});

test('immediateRetryDelayMs grows exponentially with cap', () => {
  assert.equal(immediateRetryDelayMs(1), 400);
  assert.equal(immediateRetryDelayMs(2), 800);
  assert.equal(immediateRetryDelayMs(10), 8000);
});

test('immediateRetryDelayMs uses shorter backoff for preauth', () => {
  assert.equal(immediateRetryDelayMs(1, 'preauth'), 200);
  assert.equal(immediateRetryDelayMs(3, 'preauth'), 800);
  assert.equal(immediateRetryDelayMs(10, 'preauth'), 2000);
});

test('queueRetryBackoffMs respects base and max env', () => {
  const prevBase = process.env.AINOBI_CREDITS_RETRY_BASE_BACKOFF_MS;
  const prevMax = process.env.AINOBI_CREDITS_RETRY_MAX_BACKOFF_MS;
  process.env.AINOBI_CREDITS_RETRY_BASE_BACKOFF_MS = '1000';
  process.env.AINOBI_CREDITS_RETRY_MAX_BACKOFF_MS = '5000';
  try {
    assert.ok(queueRetryBackoffMs(1) >= 1000);
    assert.ok(queueRetryBackoffMs(1) <= 5500);
    assert.ok(queueRetryBackoffMs(10) <= 5500);
  } finally {
    if (prevBase === undefined) {
      delete process.env.AINOBI_CREDITS_RETRY_BASE_BACKOFF_MS;
    } else {
      process.env.AINOBI_CREDITS_RETRY_BASE_BACKOFF_MS = prevBase;
    }
    if (prevMax === undefined) {
      delete process.env.AINOBI_CREDITS_RETRY_MAX_BACKOFF_MS;
    } else {
      process.env.AINOBI_CREDITS_RETRY_MAX_BACKOFF_MS = prevMax;
    }
  }
});
