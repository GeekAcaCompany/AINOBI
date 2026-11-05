// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  _mintAgentHandoffForTests,
  isSafeAgentHandoffCode,
  mintAgentHandoff,
  redeemAgentHandoff,
  resetAgentHandoffForTests,
} from './agent-handoff.ts';

const payload = {
  accessToken: 'token-1',
  ownerUserId: 'owner-1',
  coursewareId: 'cw-1',
  orgId: 'org-1',
};

describe('agent-handoff', () => {
  afterEach(() => {
    resetAgentHandoffForTests();
  });

  it('redeems a freshly minted code', async () => {
    resetAgentHandoffForTests();
    const minted = await mintAgentHandoff(payload);
    assert.ok(isSafeAgentHandoffCode(minted.code));
    const redeemed = await redeemAgentHandoff(minted.code);
    assert.ok(redeemed);
    assert.equal(redeemed.access_token, 'token-1');
    assert.equal(redeemed.owner_user_id, 'owner-1');
    assert.equal(redeemed.courseware_id, 'cw-1');
    assert.equal(redeemed.org_id, 'org-1');
  });

  it('accepts org-less payloads', async () => {
    resetAgentHandoffForTests();
    const minted = await mintAgentHandoff({ ...payload, orgId: null });
    const redeemed = await redeemAgentHandoff(minted.code);
    assert.ok(redeemed);
    assert.equal(redeemed.org_id, null);
  });

  it('rejects unknown / malformed codes', async () => {
    resetAgentHandoffForTests();
    await mintAgentHandoff(payload);
    assert.equal(await redeemAgentHandoff('a'.repeat(43)), null);
    assert.equal(await redeemAgentHandoff(''), null);
    assert.equal(await redeemAgentHandoff('../etc/passwd'), null);
    // format guard
    assert.equal(isSafeAgentHandoffCode('short'), false);
    assert.equal(isSafeAgentHandoffCode(`${'A'.repeat(42)}+`), false);
    assert.equal(isSafeAgentHandoffCode('A'.repeat(43)), true);
  });

  it('stops redeeming after the redemption budget is exhausted', async () => {
    resetAgentHandoffForTests();
    process.env.AINOBI_AGENT_HANDOFF_MAX_REDEMPTIONS = '2';
    try {
      const minted = await mintAgentHandoff(payload);
      assert.ok(await redeemAgentHandoff(minted.code));
      assert.ok(await redeemAgentHandoff(minted.code));
      assert.equal(await redeemAgentHandoff(minted.code), null);
    } finally {
      delete process.env.AINOBI_AGENT_HANDOFF_MAX_REDEMPTIONS;
    }
  });

  it('rejects expired codes', async () => {
    resetAgentHandoffForTests();
    const code = await _mintAgentHandoffForTests(payload, -1);
    assert.equal(await redeemAgentHandoff(code), null);
  });

  it('clamps ttl and budget env values into sane ranges', async () => {
    resetAgentHandoffForTests();
    process.env.AINOBI_AGENT_HANDOFF_TTL_SECONDS = '99999999';
    process.env.AINOBI_AGENT_HANDOFF_MAX_REDEMPTIONS = '99999';
    try {
      const minted = await mintAgentHandoff(payload);
      assert.equal(minted.ttlSeconds, 3600);
      assert.equal(minted.maxRedemptions, 20);
    } finally {
      delete process.env.AINOBI_AGENT_HANDOFF_TTL_SECONDS;
      delete process.env.AINOBI_AGENT_HANDOFF_MAX_REDEMPTIONS;
    }
  });
});
