// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AGENT_CHAT_MODEL_ID,
  agentChatModelEnvSuffix,
  assertAgentChatModelSupported,
  isAgentChatConfigured,
  resolveAgentChatModel,
  resolveAgentChatModelApiIdDetails,
  resolveAgentChatModelEndpoint,
} from './agent-chat-models.ts';

test('resolveAgentChatModel defaults to deepseek-v4.1-flash', () => {
  const prevModel = process.env.ANTHROPIC_MODEL;
  const prevApiId = process.env.AINOBI_MODEL_API_ID;
  const prevLegacyPerModel = process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID;
  // The resolver reads the dedicated derived variable: the default-behavior test must isolate it from anything a deployment may set
  const prevDedicated = process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.AINOBI_MODEL_API_ID;
  delete process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID;
  delete process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
  try {
    const m = resolveAgentChatModel();
    assert.equal(m.id, DEFAULT_AGENT_CHAT_MODEL_ID);
    assert.equal(m.apiModel, 'deepseek-v4.1-flash');
    assert.equal(m.creditsServiceCode, 'deepseek-v4.1-flash');
  } finally {
    if (prevModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = prevModel;
    if (prevApiId === undefined) delete process.env.AINOBI_MODEL_API_ID;
    else process.env.AINOBI_MODEL_API_ID = prevApiId;
    if (prevLegacyPerModel === undefined) delete process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID;
    else process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID = prevLegacyPerModel;
    if (prevDedicated === undefined) delete process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
    else process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID = prevDedicated;
  }
});

test('deepseek-v4.1-flash reuses the DEEPSEEK_V4_FLASH credential slot but a dedicated API-ID env', () => {
  // envSuffix override: keeps the ANTHROPIC_DEEPSEEK_V4_FLASH_* slot (Aliyun Bailian),
  // so the id moving from v4 → v4.1 doesn't require the deployment to add new credential env keys
  const m = resolveAgentChatModel('deepseek-v4.1-flash');
  assert.equal(m.envSuffix, 'DEEPSEEK_V4_FLASH');
  assert.deepEqual(
    resolveAgentChatModelEndpoint(m, {
      ANTHROPIC_API_KEY: 'global-key',
      ANTHROPIC_BASE_URL: 'https://global.example/anthropic',
      ANTHROPIC_DEEPSEEK_V4_FLASH_API_KEY: 'bailian-key',
      ANTHROPIC_DEEPSEEK_V4_FLASH_BASE_URL:
        'https://dashscope-intl.aliyuncs.com/apps/anthropic',
    }),
    {
      apiKey: 'bailian-key',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
    },
  );
  // API_ID redirection uses the dedicated variable with the derived suffix: the legacy
  // AINOBI_MODEL_API_ID / AINOBI_DEEPSEEK_V4_FLASH_API_ID (the upstream id of the v4 era)
  // must not silently redirect the v4.1 surface back to v4
  const prevLegacyPerModel = process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID;
  const prevGlobal = process.env.AINOBI_MODEL_API_ID;
  const prevDedicated = process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
  delete process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID;
  delete process.env.AINOBI_MODEL_API_ID;
  delete process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
  try {
    // The legacy value has no effect
    process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID = 'deepseek-v4-flash-0731';
    process.env.AINOBI_MODEL_API_ID = 'deepseek-v4-flash-0731';
    assert.equal(resolveAgentChatModelApiIdDetails(m).apiModel, 'deepseek-v4.1-flash');
    // The dedicated variable takes effect
    delete process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID;
    process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID = 'deepseek-v4.1-flash-0731';
    assert.deepEqual(resolveAgentChatModelApiIdDetails(m), {
      apiModel: 'deepseek-v4.1-flash-0731',
      redirectFromEnv: 'AINOBI_DEEPSEEK_V4_1_FLASH_API_ID',
    });
  } finally {
    if (prevLegacyPerModel === undefined) delete process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID;
    else process.env.AINOBI_DEEPSEEK_V4_FLASH_API_ID = prevLegacyPerModel;
    if (prevGlobal === undefined) delete process.env.AINOBI_MODEL_API_ID;
    else process.env.AINOBI_MODEL_API_ID = prevGlobal;
    if (prevDedicated === undefined) delete process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
    else process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID = prevDedicated;
  }
});

test('legacy AINOBI_MODEL_API_ID does not redirect the new default surface', () => {
  // Migration safety: a legacy deployment's global redirect value (the v4-era upstream id) must not
  // silently send deepseek-v4.1-flash back to the v4 upstream — billed as v4.1 but executed as v4
  const prevApiId = process.env.AINOBI_MODEL_API_ID;
  const prevPerModel = process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
  process.env.AINOBI_MODEL_API_ID = 'deepseek-v4-flash-0731';
  delete process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
  try {
    const m = resolveAgentChatModel('deepseek-v4.1-flash');
    assert.equal(m.id, 'deepseek-v4.1-flash');
    assert.equal(m.creditsServiceCode, 'deepseek-v4.1-flash');
    assert.equal(m.apiModel, 'deepseek-v4.1-flash');
  } finally {
    if (prevApiId === undefined) delete process.env.AINOBI_MODEL_API_ID;
    else process.env.AINOBI_MODEL_API_ID = prevApiId;
    if (prevPerModel === undefined) delete process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID;
    else process.env.AINOBI_DEEPSEEK_V4_1_FLASH_API_ID = prevPerModel;
  }
});

test('gpt-6-astra / gpt-6-sol ride the OpenAI bridge with per-model keys', () => {
  for (const [id, keyEnv] of [
    ['gpt-6-astra', 'ANTHROPIC_GPT_6_ASTRA_API_KEY'],
    ['gpt-6-sol', 'ANTHROPIC_GPT_6_SOL_API_KEY'],
  ] as const) {
    const m = resolveAgentChatModel(id);
    assert.equal(m.id, id);
    assert.equal(m.creditsServiceCode, id);
    assert.equal(m.viaOpenAiBridge, true);
    assert.equal(agentChatModelEnvSuffix(id), id.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    // per-model key + no explicit BASE_URL: left empty to use the built-in protocol bridge (the relay key is never
    // sent to the global endpoint — the global BASE_URL points at dashscope)
    assert.deepEqual(
      resolveAgentChatModelEndpoint(m, {
        ANTHROPIC_API_KEY: 'dashscope-key',
        ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
        [keyEnv]: 'relay-openai-key',
      }),
      {
        apiKey: 'relay-openai-key',
        baseUrl: undefined,
      },
    );
  }
});

test('grok-4.6 keeps bridge semantics', () => {
  const grok = resolveAgentChatModel('grok-4.6');
  assert.equal(grok.id, 'grok-4.6');
  assert.equal(grok.creditsServiceCode, 'grok-4.6');
  assert.equal(grok.viaOpenAiBridge, true);
  assert.deepEqual(
    resolveAgentChatModelEndpoint(grok, {
      ANTHROPIC_API_KEY: 'dashscope-key',
      ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      ANTHROPIC_GROK_4_6_API_KEY: 'xai-key',
    }),
    {
      apiKey: 'xai-key',
      baseUrl: undefined,
    },
  );
});

test('retired models are rejected (glm / kimi / deepseek-v4-flash / deepseek-v4-pro)', () => {
  for (const retired of [
    'glm-5.2',
    'glm-5.3',
    'kimi-k3',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ]) {
    assert.throws(
      () => assertAgentChatModelSupported(retired),
      /Unsupported model/,
      retired,
    );
  }
});

test('assertAgentChatModelSupported rejects unknown models', () => {
  assert.throws(
    () => assertAgentChatModelSupported('gpt-4o'),
    /Unsupported model/,
  );
});

test('resolveAgentChatModel accepts the new ids and ANTHROPIC_MODEL fallback', () => {
  const prev = process.env.ANTHROPIC_MODEL;
  process.env.ANTHROPIC_MODEL = 'gpt-6-astra';
  try {
    assert.equal(resolveAgentChatModel().id, 'gpt-6-astra');
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = prev;
  }
  assert.equal(assertAgentChatModelSupported('gpt-6-sol').id, 'gpt-6-sol');
  assert.equal(agentChatModelEnvSuffix('deepseek-v4.1-flash'), 'DEEPSEEK_V4_1_FLASH');
});

test('the assistant counts as configured only with both a key and an endpoint for the default model', () => {
  assert.equal(isAgentChatConfigured({}), false);
  assert.equal(isAgentChatConfigured({ ANTHROPIC_API_KEY: 'k' }), false);
  assert.equal(isAgentChatConfigured({ ANTHROPIC_BASE_URL: 'https://x.example' }), false);
  assert.equal(isAgentChatConfigured({ ANTHROPIC_API_KEY: ' ', ANTHROPIC_BASE_URL: 'https://x.example' }), false);
  assert.equal(isAgentChatConfigured({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://x.example' }), true);
  assert.equal(isAgentChatConfigured({ ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'https://x.example' }), true);
  assert.equal(
    isAgentChatConfigured({ ANTHROPIC_DEEPSEEK_V4_FLASH_API_KEY: 'k', ANTHROPIC_DEEPSEEK_V4_FLASH_BASE_URL: 'https://x.example' }),
    true,
  );
  // A key for another model does not help the model the panel starts on.
  assert.equal(isAgentChatConfigured({ ANTHROPIC_GROK_4_6_API_KEY: 'k' }), false);
});
