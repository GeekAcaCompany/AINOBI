// SPDX-License-Identifier: AGPL-3.0-only
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/**
 * OpenAI ↔ Anthropic protocol bridge gateway.
 *
 * The official API of some models (e.g. xAI Grok) has only the OpenAI-compatible protocol, no Anthropic
 * `/v1/messages` endpoint (api.x.ai 404s in practice), while the Claude Agent SDK speaks only the Anthropic protocol.
 * This module uses @the-next-ai/ai-gateway (the engine of claude-code-router v3, implemented on Fastify)
 * to start, from this process, a subprocess gateway bound only to 127.0.0.1:
 *
 *   Claude Agent SDK ──Anthropic /v1/messages──▶ local gateway ──OpenAI chat/completions──▶ api.x.ai
 *
 * The gateway config is a temporary JSON given by GATEWAY_CONFIG_PATH (the same startup method as claude-code-router's
 * gateway-bootstrap). The OpenAI target endpoint is in credential pass-through mode: the `x-api-key` the SDK
 * sends (the value of ANTHROPIC_GROK_4_6_API_KEY) is turned by the gateway into
 * `Authorization: Bearer` and forwarded upstream; the key is never written to any config file.
 */

export const OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT = 5635;
const OPENAI_ANTHROPIC_BRIDGE_DEFAULT_UPSTREAM_BASE_URL = 'https://api.x.ai/v1';
const OPENAI_ANTHROPIC_BRIDGE_UPSTREAM_KEY_ENV = 'ANTHROPIC_GROK_4_6_API_KEY';
const OPENAI_ANTHROPIC_BRIDGE_PROVIDER_NAME = 'xai-openai-compat';
const OPENAI_ANTHROPIC_BRIDGE_OPENAI_PROVIDER_NAME = 'openai-gpt6-compat';
const OPENAI_ANTHROPIC_BRIDGE_GPT6_KEY_ENV = 'OPENAI_API_KEY';

/** Request rewrite hooks (declarative rules of the gateway's providerHooks request; no custom JS plugin needed) */
export type OpenAiBridgeRequestHooks = {
  bodySet?: Record<string, unknown>;
  bodyRemove?: string[];
};

/**
 * Runtime settings of one bridge group (one each for xai / gpt6, all from environment variables so unit tests can inject them).
 * Credentials are in pass-through mode: the SDK request header `x-api-key` (the value of the per-model key) is turned by the gateway
 * into the upstream `Authorization: Bearer`; the key is never written to any config file.
 */
export type OpenAiAnthropicBridgeGroup = {
  /** Group id (state key of the in-process gateway singleton): xai / gpt6 */
  key: string;
  host: string;
  port: number;
  /** Upstream OpenAI-compatible base URL (no trailing slash), e.g. https://api.x.ai/v1 */
  upstreamBaseUrl: string;
  /** Environment variable name of the upstream API key (only checked for existence; the actual key passes through with the request header) */
  upstreamApiKeyEnv: string;
  /** Model ids the gateway may route upstream */
  models: string[];
  /** Upstream protocol: xAI uses chat/completions (default), the gpt-6 relay uses responses (natively supports function tools + reasoning) */
  providerType?: 'openai_chat_completions' | 'openai_responses';
  /** Request rewrite hooks (bodySet/bodyRemove), for stripping parameters the upstream doesn't accept */
  requestHooks?: OpenAiBridgeRequestHooks | null;
  /**
   * rawTrace debug directory: when non-empty the gateway writes raw requests/upstream chain packets (body_full) to it,
   * for chasing protocol conversion problems like "the real SDK request gets 400 upstream" that logs alone can't pin down.
   */
  rawTraceDir?: string | null;
  disabled: boolean;
};

/** Compatibility alias: older callers/tests still reference the bridge group settings by the Settings name */
export type OpenAiAnthropicBridgeSettings = OpenAiAnthropicBridgeGroup;

export function resolveOpenAiAnthropicBridgeSettings(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiAnthropicBridgeGroup {
  const portRaw = env.AINOBI_ANTHROPIC_BRIDGE_PORT?.trim();
  const port =
    (portRaw ? Number.parseInt(portRaw, 10) : 0) || OPENAI_ANTHROPIC_BRIDGE_DEFAULT_PORT;
  const upstreamBaseUrl = (
    env.ANTHROPIC_GROK_4_6_UPSTREAM_BASE_URL?.trim() || OPENAI_ANTHROPIC_BRIDGE_DEFAULT_UPSTREAM_BASE_URL
  ).replace(/\/+$/, '');
  const models = (env.AINOBI_ANTHROPIC_BRIDGE_MODELS?.trim() || 'grok-4.6')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  // Redirect values of AINOBI_GROK_*_API_ID go into the allowlist too (complete at startup,
  // so the gateway never restarts mid-run to extend the list and cut other sessions' in-flight streams)
  const disabled = env.AINOBI_ANTHROPIC_BRIDGE_DISABLED?.trim() === 'true';
  return {
    key: 'xai',
    host: env.AINOBI_ANTHROPIC_BRIDGE_HOST?.trim() || '127.0.0.1',
    port,
    upstreamBaseUrl,
    upstreamApiKeyEnv: OPENAI_ANTHROPIC_BRIDGE_UPSTREAM_KEY_ENV,
    models,
    rawTraceDir: resolveOpenAiAnthropicBridgeRawTraceDir(env),
    disabled,
  };
}

/**
 * rawTrace debug switch (off by default): with `AINOBI_ANTHROPIC_BRIDGE_RAW_TRACE_DIR` set,
 * the gateway writes raw requests/upstream chain packets (body_full, with the plaintext request body) to that directory; only for
 * chasing protocol conversion problems in local/test environments — never enable it in shared environments (it writes full conversations to disk).
 */
export function resolveOpenAiAnthropicBridgeRawTraceDir(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return env.AINOBI_ANTHROPIC_BRIDGE_RAW_TRACE_DIR?.trim() || null;
}

/**
 * Collect the redirect values of every `AINOBI_<FAMILY>_<NAME>_API_ID` under a prefix:
 * the allowlist is complete at startup (the gateway honors only the first provider of a type, and extending the list at runtime
 * needs a restart that cuts other sessions' in-flight streams — the runtime restart path is never taken).
 */
export function collectRedirectedModelIds(
  env: NodeJS.ProcessEnv,
  prefix: string,
): string[] {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(prefix) || !key.endsWith('_API_ID')) continue;
    const id = value?.trim();
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * The gpt-6 twins group: a separate bridge instance (default port 5636), upstream is official OpenAI / a relay.
 * Without ANTHROPIC_GPT6_UPSTREAM_BASE_URL configured the group doesn't exist (gpt-6 models unavailable).
 */
export function resolveOpenAiGpt6BridgeGroup(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiAnthropicBridgeGroup | null {
  const upstreamBaseUrl = env.ANTHROPIC_GPT6_UPSTREAM_BASE_URL?.trim();
  if (!upstreamBaseUrl) return null;
  const portRaw = env.AINOBI_ANTHROPIC_BRIDGE_GPT6_PORT?.trim();
  const port =
    (portRaw ? Number.parseInt(portRaw, 10) : 0) || 5636;
  const models = (env.AINOBI_ANTHROPIC_BRIDGE_GPT6_MODELS?.trim() || 'gpt-6-astra,gpt-6-sol')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    key: 'gpt6',
    host: env.AINOBI_ANTHROPIC_BRIDGE_HOST?.trim() || '127.0.0.1',
    port,
    // The gateway appends the endpoint name (/responses, /chat/completions) straight after baseurl,
    // so env must include /v1. The responses endpoint natively supports function tools + reasoning
    // (on chat/completions the two can't coexist; the upstream 400s in practice), so the gpt-6 group always
    // uses the responses protocol and no request rewriting of max_tokens / reasoning_effort is needed.
    upstreamBaseUrl: upstreamBaseUrl.replace(/\/+$/, ''),
    upstreamApiKeyEnv: OPENAI_ANTHROPIC_BRIDGE_GPT6_KEY_ENV,
    providerType: 'openai_responses',
    models: [...new Set([...models, ...collectRedirectedModelIds(env, 'AINOBI_GPT_6_')])],
    rawTraceDir: resolveOpenAiAnthropicBridgeRawTraceDir(env),
    disabled: env.AINOBI_ANTHROPIC_BRIDGE_DISABLED?.trim() === 'true',
  };
}

/** Generate the ai-gateway JSON config (written to a temp file and applied through GATEWAY_CONFIG_PATH) */
export function buildOpenAiAnthropicBridgeGatewayConfig(
  settings: OpenAiAnthropicBridgeGroup,
): Record<string, unknown> {
  // Note: the OpenAI target endpoint is credential pass-through (client x-api-key → upstream Bearer);
  // provider-level apikey/apiKeyEnv has no effect on that path, so don't configure a key here.
  const providers: Record<string, unknown>[] = [
    {
      name: `bridge-${settings.key}`,
      type: settings.providerType ?? 'openai_chat_completions',
      baseurl: settings.upstreamBaseUrl,
      models: settings.models,
    },
  ];
  const plugins: Record<string, unknown>[] = [];
  if (settings.requestHooks) {
    plugins.push({
      key: `${settings.key}-request-hooks`,
      enabled: true,
      match: { providerName: `bridge-${settings.key}` },
      providerHooks: {
        request: {
          bodySet: settings.requestHooks.bodySet,
          bodyRemove: settings.requestHooks.bodyRemove,
        },
      },
    });
  }
  return {
    host: settings.host,
    port: settings.port,
    Providers: providers,
    ...(plugins.length > 0 ? { plugins } : {}),
    // For debugging (off by default): capture raw requests/upstream chain packets to a local spool, to chase
    // gateway conversion problems like "direct curl works, the real SDK request 400s". See the JSDoc of
    // resolveOpenAiAnthropicBridgeRawTraceDir for how to enable it.
    ...(settings.rawTraceDir
      ? { rawTrace: { enabled: true, mode: 'body_full', spoolDir: settings.rawTraceDir } }
      : {}),
  };
}

/** Anthropic base URL the SDK side uses; still accessed through 127.0.0.1 when listening on 0.0.0.0/::, with IPv6 literals in brackets */
export function buildOpenAiAnthropicBridgeBaseUrl(settings: OpenAiAnthropicBridgeSettings): string {
  let host = settings.host === '0.0.0.0' || settings.host === '::' ? '127.0.0.1' : settings.host;
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  return `http://${host}:${settings.port}`;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** Subprocess bootstrap: set GATEWAY_CONFIG_PATH, then require the gateway entry (which starts listening by itself) */
const BRIDGE_CHILD_BOOTSTRAP = [
  'try {',
  "  process.env.GATEWAY_CONFIG_PATH = process.env.AINOBI_BRIDGE_CONFIG_PATH;",
  '  require(process.env.AINOBI_BRIDGE_GATEWAY_ENTRY);',
  '} catch (error) {',
  "  console.error('[anthropic-bridge-child] fatal:', error);",
  '  process.exit(1);',
  '}',
].join('\n');

/**
 * The child gateway uses a minimal env instead of passing process.env through:
 * - the host env's `PORT` (e.g. 5633 from dev .env) would be taken by the gateway as its own listen port,
 *   overriding the bridge port in the config file so the health check never gets through (a pitfall hit in practice);
 * - credentials are pass-through (request header x-api-key → upstream Bearer), so the subprocess needs no secrets;
 * - it keeps sensitive host variables such as DB/OSS/internal tokens from needlessly entering the subprocess.
 * Proxy variables (both spellings) must still pass through: in environments that need a proxy to go out (e.g. reaching
 * api.x.ai through Clash), stripping them would make the gateway connect upstream directly and Grok would fail entirely.
 */
export function buildOpenAiAnthropicBridgeChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  configPath: string,
  gatewayEntry: string,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    AINOBI_BRIDGE_CONFIG_PATH: configPath,
    AINOBI_BRIDGE_GATEWAY_ENTRY: gatewayEntry,
  };
  for (const key of [
    'PATH',
    'HOME',
    'TZ',
    'LANG',
    'NODE_ENV',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ] as const) {
    const value = parentEnv[key];
    if (value !== undefined) childEnv[key] = value;
  }
  return childEnv;
}

/** One runtime state per bridge group: url promise, models pending routing, routed models, subprocess */
type BridgeGroupState = {
  urlPromise: Promise<string> | null;
  pendingModels: Set<string>;
  startedModels: Set<string>;
  child: ChildProcess | null;
};

const bridgeGroupStates = new Map<string, BridgeGroupState>();
let bridgeExitHookInstalled = false;

function bridgeGroupState(key: string): BridgeGroupState {
  let state = bridgeGroupStates.get(key);
  if (!state) {
    state = { urlPromise: null, pendingModels: new Set(), startedModels: new Set(), child: null };
    bridgeGroupStates.set(key, state);
  }
  return state;
}

function killAllBridgeChildren(): void {
  for (const state of bridgeGroupStates.values()) {
    try {
      state.child?.kill();
    } catch {
      // already exited
    }
  }
}

function installBridgeExitHook(): void {
  if (bridgeExitHookInstalled) return;
  bridgeExitHookInstalled = true;
  // Take the gateway subprocess down when the host exits or is killed by a signal, so a leftover process doesn't hold the port (EADDRINUSE on the
  // next start). 'exit' only covers normal exits; SIGTERM/SIGINT (FC scale-down / redeploys)
  // need explicit listeners: after killing the subprocess, remove our own listener and re-raise the signal, keeping the default exit semantics.
  process.once('exit', killAllBridgeChildren);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      killAllBridgeChildren();
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}


/** For unit tests only: reset the singleton state */
export function resetOpenAiAnthropicBridgeForTest(): void {
  bridgeGroupStates.clear();
}

const BRIDGE_HEALTH_TIMEOUT_MS = 20_000;
const BRIDGE_HEALTH_INTERVAL_MS = 250;

/**
 * Resolve the upstream credential the bridge can use: the same fallback chain as resolveAgentChatModelEndpoint
 * (per-model key → global ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN),
 * so global key fallback configs can use the bridge too (the key passes through with the SDK request header; only existence is checked).
 */
export function resolveOpenAiAnthropicBridgeUpstreamKey(
  settings: OpenAiAnthropicBridgeSettings,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    env[settings.upstreamApiKeyEnv]?.trim() ||
    env.ANTHROPIC_API_KEY?.trim() ||
    env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    undefined
  );
}

/**
 * no-proxy patch for loopback bridge addresses: if the CLI subprocess has HTTP(S)_PROXY configured without the bridge host
 * in NO_PROXY, loopback requests get sent to the proxy (failing, and leaking x-api-key to the proxy).
 * Both spellings are unioned (existing exclusions + the bridge host) and assigned to NO_PROXY / no_proxy together —
 * setting only one would drop the existing exclusions the client relies on in the other spelling.
 * A non-loopback baseUrl returns an empty object.
 */
export function bridgeNoProxyEnvPatch(baseUrl: string): Record<string, string> {
  let host: string | null = null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'http:' && isLoopbackHost(url.hostname.replace(/^\[|\]$/g, ''))) {
      host = url.hostname; // Kept as-is (IPv6 literals in brackets)
    }
  } catch {
    return {};
  }
  if (!host) return {};
  const entries = new Set(
    [
      ...(process.env.NO_PROXY?.split(',') ?? []),
      ...(process.env.no_proxy?.split(',') ?? []),
    ]
      .map((item) => item.trim())
      .filter(Boolean),
  );
  entries.add(host);
  const value = [...entries].join(',');
  return { NO_PROXY: value, no_proxy: value };
}

async function startOpenAiAnthropicBridgeForGroup(
  group: OpenAiAnthropicBridgeGroup,
  env: NodeJS.ProcessEnv,
  routedModelId?: string,
): Promise<string> {
  const state = bridgeGroupState(group.key);
  if (group.disabled) {
    throw new Error(
      `OpenAI↔Anthropic bridge group "${group.key}" is disabled (AINOBI_ANTHROPIC_BRIDGE_DISABLED=true).`,
    );
  }
  // Besides the group's default key env, accept the per-model key of the model being routed
  // (e.g. ANTHROPIC_GPT_6_ASTRA_API_KEY): deployments with only per-model credentials and no
  // OPENAI_API_KEY can start the gpt6 group too (the key passes upstream with the request header)
  const routedModelKeyEnv = routedModelId
    ? `ANTHROPIC_${routedModelId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
    : undefined;
  const upstreamKey =
    env[group.upstreamApiKeyEnv]?.trim() ||
    (routedModelKeyEnv ? env[routedModelKeyEnv]?.trim() : undefined) ||
    resolveOpenAiAnthropicBridgeUpstreamKey(
      { upstreamApiKeyEnv: group.upstreamApiKeyEnv } as OpenAiAnthropicBridgeSettings,
      env,
    );
  if (!upstreamKey) {
    throw new Error(
      `Missing upstream API key for bridge group "${group.key}". Set ${group.upstreamApiKeyEnv}` +
        (routedModelKeyEnv ? ` or ${routedModelKeyEnv}` : "") + ".",
    );
  }
  // Before the first start, merge the models pending routing (e.g. the actual model after an API_ID redirect) into this group's model list
  const models = [...new Set([...group.models, ...state.pendingModels])];
  if (models.length === 0) {
    throw new Error(`Bridge group "${group.key}" has no routable models.`);
  }
  if (!isLoopbackHost(group.host)) {
    console.warn(
      `[anthropic-bridge] group "${group.key}" binding on non-loopback host "${group.host}" without gateway auth; ` +
        'anyone with network access to this port can use your upstream key',
    );
  }

  const baseUrl = buildOpenAiAnthropicBridgeBaseUrl(group);
  // Port pre-check: if the bridge port is already taken (e.g. the host PORT misconfigured to the same value — this service's own
  // /health answers 200), the occupant would answer the health check in its place and the bridge would wrongly look ready. Any
  // HTTP response counts as taken and errors immediately; connection refused = the port is free (the expected path).
  // The pre-check runs before the temp config directory is created, so a taken-port error leaves no garbage directory.
  let portProbeResponse: Response | null = null;
  try {
    portProbeResponse = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
  } catch {
    // ECONNREFUSED etc.: the port is free
  }
  if (portProbeResponse) {
    throw new Error(
      `OpenAI↔Anthropic bridge port ${group.port} is already in use by another process ` +
        `(probe got HTTP ${portProbeResponse.status}). Set a free port for bridge group "${group.key}".`,
    );
  }

  const configDir = mkdtempSync(join(tmpdir(), 'ainobi-anthropic-bridge-'));
  const configPath = join(configDir, 'gateway-config.json');
  writeFileSync(configPath, JSON.stringify(buildOpenAiAnthropicBridgeGatewayConfig({ ...group, models })));

  let gatewayEntry: string;
  try {
    gatewayEntry = createRequire(import.meta.url).resolve('@the-next-ai/ai-gateway');
  } catch {
    try {
      rmSync(configDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    throw new Error(
      'Cannot resolve @the-next-ai/ai-gateway. Run `yarn install` so the protocol bridge dependency is present.',
    );
  }

  const child = spawn(process.execPath, ['-e', BRIDGE_CHILD_BOOTSTRAP], {
    env: buildOpenAiAnthropicBridgeChildEnv(env, configPath, gatewayEntry),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.child = child;
  installBridgeExitHook();
  state.startedModels = new Set(models);

  /** Startup failure cleanup: kill the subprocess + delete the temp config directory (so retries don't leak and fill the FC tmp disk) */
  const failStartup = (reason: string): Error => {
    try {
      child.kill();
    } catch {
      // already exited
    }
    try {
      rmSync(configDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    console.error(`[anthropic-bridge] group "${group.key}" startup failed: ${reason}`);
    // Only redacted information is thrown outward: the stderr tail (which may contain stacks/module paths) goes only to the server log
    return new Error(
      'OpenAI↔Anthropic bridge gateway failed to start; see server logs for details',
    );
  };

  // A failed spawn itself (e.g. resource limit EAGAIN) emits only 'error', never 'exit';
  // left uncaught it would be an uncaught exception that brings the whole service down. It's recorded and turned into a startup failure in the health loop.
  let spawnError: Error | null = null;
  child.once('error', (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error));
    console.error(`[anthropic-bridge] gateway process spawn failed: ${spawnError?.message}`);
  });

  const stderrTail: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.info(`[anthropic-bridge] ${line}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (!line) return;
    stderrTail.push(line);
    if (stderrTail.length > 40) stderrTail.shift();
    console.warn(`[anthropic-bridge] ${line}`);
  });
  child.on('exit', (code, signal) => {
    console.warn(`[anthropic-bridge] group "${group.key}" gateway exited (code=${code} signal=${signal}); will restart on next use`);
    // Clear the state only when the exiting process is still the current subprocess: a late exit from an old subprocess killed by the startup timeout,
    // if it cleared unconditionally, would kill the replacement's singleton and trigger a three-way race on the same port
    if (child === state.child) {
      state.urlPromise = null;
      state.child = null;
      try {
        rmSync(configDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  const deadline = Date.now() + BRIDGE_HEALTH_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        console.info(
          `[anthropic-bridge] group "${group.key}" ready at ${baseUrl} → ${group.upstreamBaseUrl} (models: ${models.join(', ')})`,
        );
        return baseUrl;
      }
    } catch {
      // Not ready yet, keep polling
    }
    // Set by the child 'error' listener; TypeScript does not track writes in callbacks.
    const startupError = spawnError as Error | null;
    if (startupError || child.exitCode !== null || child.signalCode !== null) {
      throw failStartup(
        `child exited during startup${startupError ? `: ${startupError.message}` : ''}. stderr tail:\n${stderrTail.join('\n')}`,
      );
    }
    if (Date.now() > deadline) {
      throw failStartup(
        `not healthy within ${BRIDGE_HEALTH_TIMEOUT_MS}ms. stderr tail:\n${stderrTail.join('\n')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, BRIDGE_HEALTH_INTERVAL_MS));
  }
}

/**
 * Make sure the gateway of the target model's bridge group is started, and return an Anthropic base URL the SDK can use.
 * Routes per model to its bridge group: the gpt-6 twins → the openai upstream group (5636), everything else (grok)
 * → the xai upstream group (5635, the default group, still a singleton within the process). Each group is its own singleton;
 * after the gateway subprocess exits unexpectedly, the next call restarts it automatically.
 */
export async function ensureOpenAiAnthropicBridgeBaseUrl(
  surfaceModelId: string | undefined,
  apiModelId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const surface = surfaceModelId?.trim();
  const apiModel = apiModelId?.trim() || surface;
  const xaiGroup = resolveOpenAiAnthropicBridgeSettings(env);
  const gpt6Group = resolveOpenAiGpt6BridgeGroup(env);
  // The gpt-6 family (including ids derived from AINOBI_GPT_6_*_API_ID redirects) must go through
  // the gpt6 group: when the group isn't configured (ANTHROPIC_GPT6_UPSTREAM_BASE_URL missing) it is refused explicitly
  // — it must never slip into the xai group and send GPT-6 credentials to api.x.ai
  const isGpt6Model =
    (!!apiModel && apiModel.startsWith('gpt-6')) ||
    (!!surface && surface.startsWith('gpt-6'));
  if (isGpt6Model && !gpt6Group) {
    throw new Error(
      `Model "${surface ?? apiModel}" requires the GPT-6 bridge: set ` +
        'ANTHROPIC_GPT6_UPSTREAM_BASE_URL (and ANTHROPIC_GPT_6_*_API_KEY) to enable it.',
    );
  }
  const group = isGpt6Model ? gpt6Group! : xaiGroup;
  const state = bridgeGroupState(group.key);
  // The gateway allowlist needs the "actual upstream id" (apiModel, including relay-specific names derived from AINOBI_GPT_6_*_API_ID
  // redirects); the credential guard derives the per-model key env from the "surface model id"
  // — an API_ID redirect only changes the upstream model name, not the credential variable
  // The allowlist was completed at startup by scanning every redirect id (collectRedirectedModelIds),
  // so the unregistered branch normally isn't reached; the warning stays for extreme cases of hand-edited env
  if (apiModel && !state.startedModels.has(apiModel)) {
    state.pendingModels.add(apiModel);
    if (state.urlPromise) {
      console.warn(
        `[anthropic-bridge] model "${apiModel}" is not in bridge group "${group.key}"'s model list; ` +
          'add it to the group model env if routing fails',
      );
      state.startedModels.add(apiModel);
    }
  }
  // After a failure, clear the group's singleton so the next request can retry (rather than caching a rejected promise forever).
  // Guarded by promise identity: when the subprocess exits mid-startup, the exit handler has already cleared the singleton and
  // a concurrent request installed a replacement promise; when the original promise rejects later it must not clear the replacement,
  // or a third request would start another gateway on the same port.
  const promise = (state.urlPromise ??= startOpenAiAnthropicBridgeForGroup(group, env, surface ?? apiModel));
  void promise.catch(() => {
    if (state.urlPromise === promise) {
      state.urlPromise = null;
    }
  });
  return promise;
}
