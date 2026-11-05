// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, it } from 'node:test';

import { attachAuthorizedSession } from '../api-auth.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { redeemAgentHandoff, resetAgentHandoffForTests } from './agent-handoff.ts';
import { handleEmbedHandoffMint } from './embed-handoff-http.ts';

function request(body: unknown): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { method: 'POST', url: '/embed/handoff', headers: { 'content-type': 'application/json' } });
  return req;
}

function response() {
  const captured: { status?: number; body?: string } = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader() {},
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(chunk?: string) {
      captured.body = String(chunk ?? '');
    },
  };
  return { res: res as unknown as ServerResponse, captured };
}

describe('POST /embed/handoff', () => {
  afterEach(() => {
    resetAgentHandoffForTests();
  });

  it('rejects an unauthenticated caller', async () => {
    resetAgentHandoffForTests();
    const { res, captured } = response();
    await handleEmbedHandoffMint(request({}), res);
    assert.equal(captured.status, 401);
  });

  it("mints a single-use code carrying the caller's own session", async () => {
    resetAgentHandoffForTests();
    const req = request({ courseware_id: 'cw-1', org_id: 'org-1' });
    attachAuthorizedSession(req, { accessToken: 'user-token', userId: 'user-1' } as AinobiAuthorizedSession);
    const { res, captured } = response();
    await handleEmbedHandoffMint(req, res);
    assert.equal(captured.status, 200);
    const { data } = JSON.parse(captured.body ?? '{}') as { data: { code: string; expires_at: string } };
    assert.ok(Date.parse(data.expires_at) - Date.now() <= 60_000);

    const redeemed = await redeemAgentHandoff(data.code);
    assert.equal(redeemed?.access_token, 'user-token');
    assert.equal(redeemed?.owner_user_id, 'user-1');
    assert.equal(redeemed?.courseware_id, 'cw-1');
    assert.equal(await redeemAgentHandoff(data.code), null, 'a second redemption fails');
  });
});
