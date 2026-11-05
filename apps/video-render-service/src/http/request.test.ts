// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { PayloadTooLargeError, readJsonBody, requestPathname } from './request.ts';

test('requestPathname strips query string and trailing slash', () => {
  assert.equal(requestPathname('/health?probe=1'), '/health');
  assert.equal(requestPathname('/render/video/'), '/render/video');
  assert.equal(requestPathname(undefined), '/');
});

class FakeRequest extends EventEmitter {
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
  }
}

test('readJsonBody parses a well-formed JSON body', async () => {
  const req = new FakeRequest();
  const promise = readJsonBody<{ url: string }>(req as never);
  req.emit('data', Buffer.from('{"url":'));
  req.emit('data', Buffer.from('"https://example.com"}'));
  req.emit('end');
  assert.deepEqual(await promise, { url: 'https://example.com' });
});

test('readJsonBody defaults an empty body to {}', async () => {
  const req = new FakeRequest();
  const promise = readJsonBody<Record<string, unknown>>(req as never);
  req.emit('end');
  assert.deepEqual(await promise, {});
});

test('readJsonBody rejects with PayloadTooLargeError past the byte cap', async () => {
  const req = new FakeRequest();
  const promise = readJsonBody<unknown>(req as never, 8);
  req.emit('data', Buffer.from('0123456789'));

  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PayloadTooLargeError);
    assert.equal(error.status, 413);
    return true;
  });
  assert.equal(req.destroyed, true);
});
