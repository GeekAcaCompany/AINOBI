// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentToolPolicyContext } from './agent-tool-policy.ts';
import {
  createAgentCanUseTool,
  createPlanModeCanUseTool,
  parseAskUserQuestionInput,
  submitUserQuestionAnswer,
  waitForUserQuestionAnswer,
} from './agent-permission.ts';

test("parseAskUserQuestionInput", () => {
  const questions = parseAskUserQuestionInput({
    questions: [
      {
        question: '目标受众是？',
        header: '受众',
        multiSelect: false,
        options: [
          { label: '初学者', description: '零基础' },
          { label: '进阶', description: '有基础' },
        ],
      },
    ],
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.question, '目标受众是？');
  assert.equal(questions[0]?.options.length, 2);
});

test('parseAskUserQuestionInput accepts freeText with fewer than two options', () => {
  const questions = parseAskUserQuestionInput({
    questions: [
      {
        question: '还有哪些必须覆盖的知识点？',
        header: '补充',
        freeText: true,
        options: [{ label: '跳过', description: '暂无补充' }],
      },
      {
        question: '请用一句话描述教学目标',
        header: '目标',
        freeText: true,
      },
    ],
  });
  assert.equal(questions.length, 2);
  assert.equal(questions[0]?.freeText, true);
  assert.deepEqual(questions[0]?.options, []);
  assert.equal(questions[0]?.multiSelect, false);
  assert.equal(questions[1]?.freeText, true);
  assert.deepEqual(questions[1]?.options, []);
});

test('parseAskUserQuestionInput rejects non-freeText with fewer than two options', () => {
  const questions = parseAskUserQuestionInput({
    questions: [
      {
        question: '只有一个选项？',
        header: '无效',
        options: [{ label: '唯一', description: '不够' }],
      },
    ],
  });
  assert.equal(questions.length, 0);
});

test('submitUserQuestionAnswer resolves wait', async () => {
  const requestId = 'test:tu_1';
  const wait = waitForUserQuestionAnswer(requestId, { questions: [] }, undefined, 'tu_1');
  const submitted = submitUserQuestionAnswer({
    requestId,
    answers: { '目标受众是？': '初学者' },
  });
  assert.equal(submitted.ok, true);
  const updated = await wait;
  assert.deepEqual(updated.answers, { '目标受众是？': '初学者' });
});

test('submitUserQuestionAnswer accepts history/session aliases via toolUseId', async () => {
  const requestId = 'conv-abc:tu_alias';
  const wait = waitForUserQuestionAnswer(requestId, { questions: [] }, undefined, 'tu_alias');
  const submitted = submitUserQuestionAnswer({
    requestId: 'history:tu_alias',
    answers: { q: 'a' },
  });
  assert.equal(submitted.ok, true);
  const updated = await wait;
  assert.deepEqual(updated.answers, { q: 'a' });
});

test('submitUserQuestionAnswer rejects unknown requestId', () => {
  assert.equal(submitUserQuestionAnswer({ requestId: 'nope', answers: { q: 'a' } }).ok, false);
});

test('createAgentCanUseTool denies blocked bash before AskUserQuestion', async () => {
  const canUseTool = createAgentCanUseTool({
    policy: buildAgentToolPolicyContext({
      agentCwd: '/tmp/agent-workspaces/conv-test',
      serviceRoot: '/tmp/ainobi-service',
    }),
  });
  const result = await canUseTool(
    'Bash',
    { command: 'printenv' },
    { toolUseID: 'tu_env', signal: new AbortController().signal },
  );
  assert.equal(result.behavior, 'deny');
});

test('createPlanModeCanUseTool allows research bash and denies mutations', async () => {
  const canUseTool = createPlanModeCanUseTool({
    policy: buildAgentToolPolicyContext({
      agentCwd: '/tmp/agent-workspaces/conv-plan',
      serviceRoot: '/tmp/ainobi-service',
      skillMdRead: true,
    }),
  });
  const signal = new AbortController().signal;

  const allowed = await canUseTool(
    'Bash',
    { command: 'ainobi doc read ./report.pdf' },
    { toolUseID: 'tu_doc', signal },
  );
  assert.equal(allowed.behavior, 'allow');

  const search = await canUseTool(
    'Bash',
    { command: 'ainobi search A股 大跌 --answer' },
    { toolUseID: 'tu_search', signal },
  );
  assert.equal(search.behavior, 'allow');

  const narration = await canUseTool(
    'Bash',
    { command: 'ainobi narration insert 0 --teacher-id x' },
    { toolUseID: 'tu_narr', signal },
  );
  assert.equal(narration.behavior, 'deny');

  const write = await canUseTool(
    'Write',
    { file_path: '/tmp/agent-workspaces/conv-plan/x.md', content: 'nope' },
    { toolUseID: 'tu_write', signal },
  );
  assert.equal(write.behavior, 'deny');
});
