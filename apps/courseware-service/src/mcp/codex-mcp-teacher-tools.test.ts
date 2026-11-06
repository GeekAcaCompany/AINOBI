// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { aiTeacherAnswerTool, aiTeacherGenerateTool, aiTeacherSaveTool, aiTeacherStatusTool } from './codex-mcp-teacher-tools.ts';

const ORG = '00000000-0000-4000-8000-000000000001';
const caller = {
  roles: ['agent'],
  user: { user_id: 'agent-1', user_name: 'Bot', account_name: 'bot', email: null, user_status: 'active', user_avatar_url: null, user_type: 'agent' },
  organization: null,
  permissions: [],
  userId: 'agent-1',
  permissionUserId: 'owner-1',
  currentOrgId: ORG,
  accessToken: 'token-1',
  expireAt: new Date(Date.now() + 3600_000).toISOString(),
  isOrgAgent: true,
} as unknown as AinobiAuthorizedSession;

const local = { AINOBI_MCP_LOCAL_FILES: 'true' };
const draw = { request_id: 'r1', kind: 'draw', instructions: 'Draw a teacher', input_images: [], answer_with: 'a PNG' };
const look = { request_id: 'r2', kind: 'look', instructions: 'Check it', input_images: ['/tmp/a.png'], answer_with: 'JSON' };

/** A host that answers from a script of task states, and records what it was sent. */
function fakeHost(states: Array<Record<string, unknown>>, answers: Array<{ status: number; message?: string }> = []) {
  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace(/^.*\/ai_teacher/, '');
    sent.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (path === '/generate_avatar_temp') return json(202, { success: true, data: { task_id: 't1', status: 'queued' } });
    if (path.endsWith('/agent_answer')) {
      const answer = answers.shift() ?? { status: 200 };
      return answer.status === 200 ? json(200, { success: true, data: { accepted: true } }) : json(answer.status, { success: false, message: answer.message });
    }
    if (path === '/create') return json(200, { success: true, data: { ai_teacher_id: 'teacher-1', ai_teacher_name: 'Ms. Lin' } });
    const state = states.length > 1 ? states.shift()! : states[0];
    return json(200, { success: true, data: { task_id: 't1', result: null, error: null, ...state } });
  }) as typeof fetch;
  return { fetch, sent };
}
const deps = (host: ReturnType<typeof fakeHost>, extra = {}) => ({ fetch: host.fetch, sleep: async () => undefined, env: local, ...extra });

describe('AI teacher tools', () => {
  it('lets the agent draw only on a local Studio', async () => {
    const result = await aiTeacherGenerateTool(caller, { prompt: 'A warm teacher', drawn_by: 'agent' }, { env: {} });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /local AINOBI Studio/);
    assert.equal((await aiTeacherGenerateTool(caller, { prompt: 'A warm teacher' }, { env: local })).code, 'USAGE');
  });

  it('starts an agent-drawn generation and returns the first request once the host has it', async () => {
    const host = fakeHost([{ status: 'processing', agent_request: null }, { status: 'processing', agent_request: draw }]);
    const result = (await aiTeacherGenerateTool(caller, { prompt: 'A warm teacher', drawn_by: 'agent' }, deps(host))) as { ok: boolean; data: Record<string, unknown> };
    assert.equal(result.ok, true);
    assert.deepEqual(host.sent[0], { method: 'POST', path: '/generate_avatar_temp', body: { prompt: 'A warm teacher', drawn_by: 'agent' } });
    assert.equal((result.data.agent_request as { request_id: string }).request_id, 'r1');
    assert.match(String(result.data.next), /ai_teacher_answer/);
  });

  it('passes a refused answer back so the agent can fix it, and waits past the request it answered', async () => {
    const refused = fakeHost([{ status: 'processing', agent_request: draw }], [{ status: 422, message: 'Draw it square.' }]);
    const bad = await aiTeacherAnswerTool(caller, { task_id: 't1', request_id: 'r1', image_path: '/tmp/wide.png' }, deps(refused));
    assert.equal(bad.code, 'ANSWER_REFUSED');
    assert.match(String(bad.error), /square/);

    const host = fakeHost([{ status: 'processing', agent_request: draw }, { status: 'processing', agent_request: null }, { status: 'processing', agent_request: look }]);
    const next = (await aiTeacherAnswerTool(caller, { task_id: 't1', request_id: 'r1', image_path: '/tmp/teacher.png' }, deps(host))) as { data: Record<string, unknown> };
    assert.equal((next.data.agent_request as { request_id: string }).request_id, 'r2');
    assert.match(String(next.data.next), /JSON object/);
  });

  it('reports the result, and stops waiting when time runs out', async () => {
    const done = fakeHost([{ status: 'succeeded', agent_request: null, result: { model_url: '/local/ai-teachers/tasks/t1/model.inx', preview_url: '/local/ai-teachers/tasks/t1/preview.png' } }]);
    const result = (await aiTeacherStatusTool(caller, { task_id: 't1' }, deps(done))) as { data: Record<string, unknown> };
    assert.equal(result.data.status, 'succeeded');
    assert.match(String(result.data.preview_url), /\/local\/ai-teachers\/tasks\/t1\/preview\.png$/);
    assert.match(String(result.data.next), /ai_teacher_save/);

    const busy = fakeHost([{ status: 'processing', agent_request: null }]);
    const waiting = (await aiTeacherStatusTool(caller, { task_id: 't1' }, deps(busy, { waitMs: 0 }))) as { data: Record<string, unknown> };
    assert.equal(waiting.data.status, 'processing');
    assert.match(String(waiting.data.next), /ai_teacher_status/);
  });

  it('saves a finished generation under the chosen name', async () => {
    const host = fakeHost([]);
    const saved = (await aiTeacherSaveTool(caller, { task_id: 't1', name: ' Ms. Lin ' }, deps(host))) as { ok: boolean; data: Record<string, unknown> };
    assert.equal(saved.ok, true);
    assert.deepEqual(host.sent[0].body, { ai_teacher_name: 'Ms. Lin', task_id: 't1' });
    assert.equal(saved.data.ai_teacher_id, 'teacher-1');
  });
});
