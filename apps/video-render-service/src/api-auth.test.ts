// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { authorizeRequest, isAuthorizedByInternalToken, isPublicRequest } from './api-auth.ts';

function withInternalTokenEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN;
  if (value === undefined) {
    delete process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN;
  } else {
    process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN;
    else process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN = previous;
  }
}

function reqWithInternalTokenHeader(value: string | undefined): IncomingMessage {
  return { headers: { 'x-ainobi-internal-token': value } } as unknown as IncomingMessage;
}

test('isPublicRequest allows health only', () => {
  assert.equal(isPublicRequest('OPTIONS', '/chat'), true);
  assert.equal(isPublicRequest('GET', '/health'), true);
  assert.equal(isPublicRequest('GET', '/health?probe=1'), true);
  assert.equal(isPublicRequest('GET', '/'), false);
  assert.equal(isPublicRequest('POST', '/chat'), false);
  assert.equal(isPublicRequest('GET', '/courseware'), false);
});

test('isAuthorizedByInternalToken accepts a matching shared secret', () => {
  withInternalTokenEnv('shared-secret', () => {
    assert.equal(isAuthorizedByInternalToken(reqWithInternalTokenHeader('shared-secret')), true);
  });
});

test('isAuthorizedByInternalToken rejects a mismatched token', () => {
  withInternalTokenEnv('shared-secret', () => {
    assert.equal(isAuthorizedByInternalToken(reqWithInternalTokenHeader('wrong-secret')), false);
  });
});

test('isAuthorizedByInternalToken rejects a missing header', () => {
  withInternalTokenEnv('shared-secret', () => {
    assert.equal(isAuthorizedByInternalToken(reqWithInternalTokenHeader(undefined)), false);
  });
});

test('isAuthorizedByInternalToken always rejects when the server has no token configured', () => {
  withInternalTokenEnv(undefined, () => {
    assert.equal(isAuthorizedByInternalToken(reqWithInternalTokenHeader('anything')), false);
    assert.equal(isAuthorizedByInternalToken(reqWithInternalTokenHeader('')), false);
  });
});

test('authorizeRequest is a pure alias for isAuthorizedByInternalToken (no session fallback)', async () => {
  await withInternalTokenEnv('shared-secret', async () => {
    assert.equal(await authorizeRequest(reqWithInternalTokenHeader('shared-secret')), true);
    assert.equal(await authorizeRequest(reqWithInternalTokenHeader('wrong')), false);
  });
});
