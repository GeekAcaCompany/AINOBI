// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import { isClientFacingError, resolveErrorStatus } from './http-error.ts';

class StatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

test('resolveErrorStatus honors a status field on the error', () => {
  assert.equal(resolveErrorStatus(new StatusError(403, 'Forbidden')), 403);
  assert.equal(resolveErrorStatus(new StatusError(413, 'Too large')), 413);
});

test('resolveErrorStatus ignores out-of-range status values', () => {
  assert.equal(resolveErrorStatus(new StatusError(200, 'not an error status')), 500);
  assert.equal(resolveErrorStatus(new StatusError(999, 'invalid')), 500);
});

test('resolveErrorStatus maps ZodError to 400', () => {
  const schema = z.object({ url: z.string().url() });
  const result = schema.safeParse({ url: 'not-a-url' });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(resolveErrorStatus(result.error), 400);
  }
});

test('resolveErrorStatus defaults unknown errors to 500', () => {
  assert.equal(resolveErrorStatus(new Error('boom')), 500);
  assert.equal(resolveErrorStatus('plain string'), 500);
  assert.equal(resolveErrorStatus(undefined), 500);
});

test('isClientFacingError matches resolveErrorStatus < 500', () => {
  assert.equal(isClientFacingError(new StatusError(400, 'bad request')), true);
  assert.equal(isClientFacingError(new Error('boom')), false);
});
