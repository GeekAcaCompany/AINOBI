// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bridgeNoProxyEnvPatch,
  buildOpenAiAnthropicBridgeBaseUrl,
  buildOpenAiAnthropicBridgeChildEnv,
  buildOpenAiAnthropicBridgeGatewayConfig,
  OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT,
  resolveOpenAiAnthropicBridgeSettings,
  resolveOpenAiAnthropicBridgeUpstreamKey,
  resolveOpenAiGpt6BridgeGroup,
} from './openai-anthropic-bridge.ts';

const BASE_ENV: NodeJS.ProcessEnv = {};

test('bridge settings default to local gateway + xAI upstream', () => {
  const settings = resolveOpenAiAnthropicBridgeSettings(BASE_ENV);
  assert.equal(settings.host, '127.0.0.1');
  assert.equal(settings.port, OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT);
  assert.equal(settings.upstreamBaseUrl, 'https://api.x.ai/v1');
  assert.equal(settings.upstreamApiKeyEnv, 'ANTHROPIC_GROK_4_6_API_KEY');
  assert.deepEqual(settings.models, ['grok-4.6']);
  assert.equal(settings.disabled, false);
});

test('bridge settings honor env overrides and strip trailing slashes', () => {
  const settings = resolveOpenAiAnthropicBridgeSettings({
    AINOBI_ANTHROPIC_BRIDGE_HOST: '0.0.0.0',
    AINOBI_ANTHROPIC_BRIDGE_PORT: '7001',
    ANTHROPIC_GROK_4_6_UPSTREAM_BASE_URL: 'https://api.x.ai/v1///',
    AINOBI_ANTHROPIC_BRIDGE_MODELS: ' grok-4.6, grok-4.5 ',
    AINOBI_ANTHROPIC_BRIDGE_DISABLED: 'true',
  });
  assert.equal(settings.host, '0.0.0.0');
  assert.equal(settings.port, 7001);
  assert.equal(settings.upstreamBaseUrl, 'https://api.x.ai/v1');
  assert.deepEqual(settings.models, ['grok-4.6', 'grok-4.5']);
  assert.equal(settings.disabled, true);
});

test('gateway config routes openai_chat_completions with credential pass-through (no key material)', () => {
  const config = buildOpenAiAnthropicBridgeGatewayConfig(
    resolveOpenAiAnthropicBridgeSettings(BASE_ENV),
  );
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT);
  const providers = config.Providers as Array<Record<string, unknown>>;
  assert.equal(providers.length, 1);
  assert.equal(providers[0].type, 'openai_chat_completions');
  assert.equal(providers[0].baseurl, 'https://api.x.ai/v1');
  assert.deepEqual(providers[0].models, ['grok-4.6']);
  // The upstream key is passed through via the SDK's x-api-key (turned into Bearer); no key field may appear in the config file
  assert.equal(providers[0].apikey, undefined);
  assert.equal(providers[0].apiKey, undefined);
  assert.equal(providers[0].apiKeyEnv, undefined);
  // rawTrace is off by default
  assert.equal(config.rawTrace, undefined);
});

test('gpt6 group is absent without upstream base URL and configured via env when present', () => {
  assert.equal(resolveOpenAiGpt6BridgeGroup(BASE_ENV), null);
  const group = resolveOpenAiGpt6BridgeGroup({
    ANTHROPIC_GPT6_UPSTREAM_BASE_URL: 'https://relay.example/openai/v1/',
    AINOBI_ANTHROPIC_BRIDGE_GPT6_PORT: '5636',
    AINOBI_ANTHROPIC_BRIDGE_GPT6_MODELS: ' gpt-6-astra, gpt-6-sol ',
  });
  assert.equal(group?.key, 'gpt6');
  assert.equal(group?.port, 5636);
  assert.equal(group?.upstreamBaseUrl, 'https://relay.example/openai/v1');
  assert.equal(group?.upstreamApiKeyEnv, 'OPENAI_API_KEY');
  assert.deepEqual(group?.models, ['gpt-6-astra', 'gpt-6-sol']);
  // The responses endpoint natively supports function tools + reasoning (on chat/completions the two can't coexist)
  assert.equal(group?.providerType, 'openai_responses');
  assert.equal(group?.disabled, false);
});

test('gpt6 gateway config uses openai_responses provider and honors rawTrace opt-in', () => {
  const group = resolveOpenAiGpt6BridgeGroup({
    ANTHROPIC_GPT6_UPSTREAM_BASE_URL: 'https://relay.example/openai/v1',
    AINOBI_ANTHROPIC_BRIDGE_RAW_TRACE_DIR: '/tmp/bridge-trace',
  })!;
  const config = buildOpenAiAnthropicBridgeGatewayConfig(group);
  const providers = config.Providers as Array<Record<string, unknown>>;
  assert.equal(providers[0].type, 'openai_responses');
  assert.equal(providers[0].baseurl, 'https://relay.example/openai/v1');
  assert.equal(providers[0].apikey, undefined);
  assert.deepEqual(config.rawTrace, {
    enabled: true,
    mode: 'body_full',
    spoolDir: '/tmp/bridge-trace',
  });
  // Without a rawTrace directory configured, no rawTrace config block is produced
  const groupNoTrace = resolveOpenAiGpt6BridgeGroup({
    ANTHROPIC_GPT6_UPSTREAM_BASE_URL: 'https://relay.example/openai/v1',
  })!;
  assert.equal(
    (buildOpenAiAnthropicBridgeGatewayConfig(groupNoTrace) as Record<string, unknown>).rawTrace,
    undefined,
  );
});

test('request hooks flow into gateway providerHooks declarative rules', () => {
  const config = buildOpenAiAnthropicBridgeGatewayConfig({
    ...resolveOpenAiAnthropicBridgeSettings(BASE_ENV),
    requestHooks: {
      bodySet: { max_tokens: 32000 },
      bodyRemove: ['reasoning_effort'],
    },
  });
  const plugins = config.plugins as Array<Record<string, unknown>>;
  assert.equal(plugins.length, 1);
  // Hooks match by provider and only affect this bridge group's upstream requests
  assert.deepEqual(plugins[0].match, { providerName: 'bridge-xai' });
  const hooks = (plugins[0].providerHooks as { request: Record<string, unknown> }).request;
  assert.deepEqual(hooks.bodySet, { max_tokens: 32000 });
  assert.deepEqual(hooks.bodyRemove, ['reasoning_effort']);
});

test('bridge base url always dials loopback even when listening on 0.0.0.0', () => {
  assert.equal(
    buildOpenAiAnthropicBridgeBaseUrl(resolveOpenAiAnthropicBridgeSettings(BASE_ENV)),
    `http://127.0.0.1:${OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT}`,
  );
  assert.equal(
    buildOpenAiAnthropicBridgeBaseUrl(
      resolveOpenAiAnthropicBridgeSettings({ AINOBI_ANTHROPIC_BRIDGE_HOST: '0.0.0.0' }),
    ),
    `http://127.0.0.1:${OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT}`,
  );
});

test('bridge base url brackets IPv6 literals', () => {
  assert.equal(
    buildOpenAiAnthropicBridgeBaseUrl(
      resolveOpenAiAnthropicBridgeSettings({ AINOBI_ANTHROPIC_BRIDGE_HOST: '::1' }),
    ),
    `http://[::1]:${OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT}`,
  );
});

test('bridge child env is minimal: no PORT, no secrets; proxies forwarded', () => {
  const childEnv = buildOpenAiAnthropicBridgeChildEnv(
    {
      PORT: '5633',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/dev',
      TZ: 'Asia/Shanghai',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      no_proxy: 'localhost,127.0.0.1',
      DB_PASSWORD: 'secret',
      OSS_ACCESS_KEY_ID: 'secret',
      ANTHROPIC_GROK_4_6_API_KEY: 'xai-secret',
    },
    '/tmp/gateway-config.json',
    '/repo/node_modules/@the-next-ai/ai-gateway/dist/index.js',
  );
  assert.equal(childEnv.AINOBI_BRIDGE_CONFIG_PATH, '/tmp/gateway-config.json');
  assert.equal(
    childEnv.AINOBI_BRIDGE_GATEWAY_ENTRY,
    '/repo/node_modules/@the-next-ai/ai-gateway/dist/index.js',
  );
  assert.equal(childEnv.PATH, '/usr/local/bin:/usr/bin:/bin');
  assert.equal(childEnv.HOME, '/home/dev');
  assert.equal(childEnv.TZ, 'Asia/Shanghai');
  // In environments that go out through a proxy, stripping the proxy variables would make the gateway connect to api.x.ai directly (Grok all fails) → they must pass through
  assert.equal(childEnv.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(childEnv.no_proxy, 'localhost,127.0.0.1');
  // The host PORT would override the gateway's listen port (5633 from dev .env), and the secret subprocess doesn't need it either
  assert.equal(childEnv.PORT, undefined);
  assert.equal(childEnv.DB_PASSWORD, undefined);
  assert.equal(childEnv.OSS_ACCESS_KEY_ID, undefined);
  assert.equal(childEnv.ANTHROPIC_GROK_4_6_API_KEY, undefined);
});

test('upstream key resolution mirrors the endpoint fallback chain', () => {
  const settings = resolveOpenAiAnthropicBridgeSettings(BASE_ENV);
  // per-model first
  assert.equal(
    resolveOpenAiAnthropicBridgeUpstreamKey(settings, {
      ANTHROPIC_GROK_4_6_API_KEY: 'xai-key',
      ANTHROPIC_API_KEY: 'global-key',
    }),
    'xai-key',
  );
  // Global key fallback (the bridge must not accept only per-model variables)
  assert.equal(
    resolveOpenAiAnthropicBridgeUpstreamKey(settings, { ANTHROPIC_API_KEY: 'global-key' }),
    'global-key',
  );
  assert.equal(
    resolveOpenAiAnthropicBridgeUpstreamKey(settings, { ANTHROPIC_AUTH_TOKEN: 'auth-token' }),
    'auth-token',
  );
  assert.equal(resolveOpenAiAnthropicBridgeUpstreamKey(settings, {}), undefined);
});

test('bridgeNoProxyEnvPatch unions existing exclusions into both no-proxy spellings', () => {
  const prevNoProxy = process.env.NO_PROXY;
  const prevNoProxyLower = process.env.no_proxy;
  try {
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    // Loopback http: both spellings are injected
    let patch = bridgeNoProxyEnvPatch('http://127.0.0.1:5635');
    assert.equal(patch.NO_PROXY, '127.0.0.1');
    assert.equal(patch.no_proxy, '127.0.0.1');
    // Only uppercase set: after the union both spellings match, and existing exclusions aren't lost
    process.env.NO_PROXY = 'internal.example.com,localhost';
    patch = bridgeNoProxyEnvPatch('http://127.0.0.1:5635');
    assert.equal(patch.NO_PROXY, 'internal.example.com,localhost,127.0.0.1');
    assert.equal(patch.no_proxy, 'internal.example.com,localhost,127.0.0.1');
    // Not appended again when already included
    delete process.env.NO_PROXY;
    process.env.no_proxy = '127.0.0.1';
    patch = bridgeNoProxyEnvPatch('http://127.0.0.1:5635');
    assert.equal(patch.NO_PROXY, '127.0.0.1');
    // IPv6 literal
    delete process.env.no_proxy;
    patch = bridgeNoProxyEnvPatch('http://[::1]:5635');
    assert.equal(patch.NO_PROXY, '[::1]');
    // Non-loopback / https addresses are not injected
    assert.deepEqual(bridgeNoProxyEnvPatch('https://api.example.com'), {});
    assert.deepEqual(bridgeNoProxyEnvPatch('http://10.0.0.5:5635'), {});
  } finally {
    if (prevNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = prevNoProxy;
    if (prevNoProxyLower === undefined) delete process.env.no_proxy;
    else process.env.no_proxy = prevNoProxyLower;
  }
});
