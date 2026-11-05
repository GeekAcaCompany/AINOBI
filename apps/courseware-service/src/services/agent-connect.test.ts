// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  AGENT_CONNECT_CODE_RE,
  _storeAgentConnectCodeForTests,
  agentConnectUrl,
  buildAgentConnectInstruction,
  buildCredentialEnvFile,
  issueAgentConnectCode,
  redeemAgentConnectCredential,
  resetAgentConnectForTests,
  type AgentConnectPayload,
} from './agent-connect.ts';

function backendCreateOk(overrides: Partial<{ apiKey: string; agentUserId: string }> = {}) {
  const calls: Array<{ orgId: string; name: string }> = [];
  return {
    calls,
    async createAgent(input: { accessToken: string; orgId: string; name: string }) {
      calls.push({ orgId: input.orgId, name: input.name });
      return {
        apiKey: overrides.apiKey ?? 'ainobi_ak_test_secret',
        agentUserId: overrides.agentUserId ?? 'agent-user-1',
        expiresAt: '2026-12-10T00:00:00.000Z',
      };
    },
  };
}

function payload(overrides: Partial<AgentConnectPayload> = {}): AgentConnectPayload {
  return {
    api_key: 'ainobi_ak_test_secret',
    mcp_url: 'https://courseware-api.example.com/mcp',
    org_id: 'org-1',
    org_name: '绿叶中学',
    owner_user_id: 'owner-1',
    agent_user_id: 'agent-user-1',
    agent_name: '待接入·0910-1200',
    credential_expires_at: '2026-12-10T00:00:00.000Z',
    minted_at: '2026-09-10T12:00:00.000Z',
    used_at: null,
    ...overrides,
  };
}

describe('agent-connect', () => {
  afterEach(() => {
    resetAgentConnectForTests();
  });

  it('mints a formatted code and reuses it within the window', async () => {
    resetAgentConnectForTests();
    const backend = backendCreateOk();
    const first = await issueAgentConnectCode({
      accessToken: 'token-1',
      orgId: 'org-1',
      orgName: '绿叶中学',
      _createAgentForTests: backend.createAgent,
    });
    assert.match(first.code, AGENT_CONNECT_CODE_RE);
    assert.equal(first.connectUrl, agentConnectUrl(first.code));
    assert.ok(first.connectUrl.includes(first.code));

    const second = await issueAgentConnectCode({
      accessToken: 'token-1',
      orgId: 'org-1',
      orgName: '绿叶中学',
      _createAgentForTests: backend.createAgent,
    });
    assert.equal(second.code, first.code);
    assert.equal(backend.calls.length, 1);
    assert.match(backend.calls[0]!.name, /^待接入·/);
    // The reuse path must return the code's real expiry (no fake restarted timer). The first-mint and reuse branches
    // take their expiry from two carriers (payload exp vs the org-index expiresAtMs), written milliseconds apart
    // — asserting equality to the second is enough; a faked restart (minutes of drift) is still caught by this assertion.
    assert.ok(
      Math.abs(new Date(second.expiresAt).getTime() - new Date(first.expiresAt).getTime()) <= 2000,
      `expiresAt drift too large: first=${first.expiresAt} second=${second.expiresAt}`,
    );
    assert.ok(second.ttlSeconds <= first.ttlSeconds);
  });

  it('mints a fresh code per org (index is org-scoped)', async () => {
    resetAgentConnectForTests();
    const backend = backendCreateOk();
    const a = await issueAgentConnectCode({
      accessToken: 't',
      orgId: 'org-a',
      _createAgentForTests: backend.createAgent,
    });
    const b = await issueAgentConnectCode({
      accessToken: 't',
      orgId: 'org-b',
      _createAgentForTests: backend.createAgent,
    });
    assert.notEqual(a.code, b.code);
    assert.equal(backend.calls.length, 2);
  });

  it('delivers the env file exactly once, then rotates the org code', async () => {
    resetAgentConnectForTests();
    const backend = backendCreateOk({ apiKey: 'ainobi_ak_live_key' });
    const issued = await issueAgentConnectCode({
      accessToken: 't',
      orgId: 'org-1',
      orgName: '绿叶中学',
      _createAgentForTests: backend.createAgent,
    });

    const env = await redeemAgentConnectCredential(issued.code, 'claude-code');
    const lines = env.split('\n');
    assert.equal(lines[0], 'AINOBI_AGENT_API_KEY=ainobi_ak_live_key');
    assert.match(lines[1]!, /^AINOBI_MCP_URL=https?:\/\//);

    await assert.rejects(
      () => redeemAgentConnectCredential(issued.code, 'claude-code'),
      (error: { code?: string }) => error.code === 'AGENT_CONNECT_CODE_USED',
    );

    const next = await issueAgentConnectCode({
      accessToken: 't',
      orgId: 'org-1',
      orgName: '绿叶中学',
      _createAgentForTests: backend.createAgent,
    });
    assert.notEqual(next.code, issued.code);
    assert.equal(backend.calls.length, 2);
  });

  it('expired codes resolve as 410 and never deliver', async () => {
    resetAgentConnectForTests();
    await _storeAgentConnectCodeForTests(
      'ANB-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD',
      payload(),
      -1,
    );
    await assert.rejects(
      () => redeemAgentConnectCredential('ANB-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', null),
      (error: { code?: string }) => error.code === 'AGENT_CONNECT_CODE_INVALID',
    );
  });

  it('rejects malformed codes without touching the store', async () => {
    resetAgentConnectForTests();
    await assert.rejects(
      () => redeemAgentConnectCredential('../etc/passwd', null),
      (error: { code?: string }) => error.code === 'AGENT_CONNECT_CODE_INVALID',
    );
    await assert.rejects(
      () => redeemAgentConnectCredential('ANB-SHORT', null),
      (error: { code?: string }) => error.code === 'AGENT_CONNECT_CODE_INVALID',
    );
  });

  it('instruction stays minimal — details live in the guide, not the pasted text', () => {
    const text = buildAgentConnectInstruction({
      connectUrl: 'https://courseware-api.example.com/agent/connect/ANB-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD',
      orgName: '绿叶中学',
    });
    // Must stay: the org label, the connect link, and the pointer to "follow the steps in the document"
    assert.ok(text.includes('AINOBI courseware workspace (绿叶中学)'));
    assert.ok(text.includes('/agent/connect/ANB-'));
    assert.ok(text.includes('follow the steps there to complete the onboarding'));
    // Locked minimal: operation details must not return to the instructions (they are on the connect document page; repeating them burdens the user)
    assert.ok(!text.includes('~/.ainobi/ainobi-agent.env'));
    assert.ok(!text.includes('AINOBI_AGENT_API_KEY'));
    assert.ok(!text.includes('course_list'));
    assert.ok(!text.includes('起什么名字'));
  });

  it('guide carries the hard-won onboarding lessons', async () => {
    const { buildMarkdownGuide } = await import('./agent-connect.ts');
    const md = buildMarkdownGuide({
      code: 'ANB-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD',
      orgId: 'org-1',
      orgName: '绿叶中学',
      mcpUrl: 'https://courseware-api.example.com/mcp',
      credentialExpiresAt: '2026-12-10T00:00:00.000Z',
    });
    // 406 pitfall: dual Accept header must be spelled out in the verify recipe
    assert.ok(md.includes('Accept: application/json, text/event-stream'));
    // session-free verification path: JSON-RPC direct recipe (course_list tool call)
    assert.ok(md.includes('"method":"tools/call"'));
    assert.ok(md.includes('no session id needed'));
    // quick path: paste-able install blocks
    assert.ok(md.includes('Quick path'));
    assert.ok(md.includes('claude mcp add --transport http'));
    // R3 lesson: double quotes let the shell expand ${…} into plaintext in ~/.claude.json
    assert.ok(md.includes("Bearer ${AINOBI_AGENT_API_KEY}'"));
    assert.ok(md.includes('SINGLE quotes'));
    // error table covers every known failure mode
    assert.ok(md.includes('Common errors'));
    assert.ok(md.includes('410') && md.includes('409') && md.includes('406'));
    // completion checklist
    assert.ok(md.includes('Completion checklist'));
    assert.ok(md.includes('agent_set_name'));
    // client self-identification
    assert.ok(md.includes('X-AINOBI-Client'));
    // credential red line
    assert.ok(md.includes('reading the plaintext is forbidden'));
    // two lifetimes on separate lines: code 15min vs credential 90 days (full UTC stamp)
    assert.ok(md.includes('This connect code is valid for 15 minutes and single-use'));
    assert.ok(md.includes('the credential is valid until'));
    assert.ok(/valid until \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(md));
    assert.ok(md.includes('90 days from code issuance'));
  });

  it('env file carries exactly the two documented lines', () => {
    const env = buildCredentialEnvFile(payload({ mcp_url: 'https://x/mcp' }));
    assert.equal(env, 'AINOBI_AGENT_API_KEY=ainobi_ak_test_secret\nAINOBI_MCP_URL=https://x/mcp\n');
  });
});
