// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeAinobiServiceCode } from './ainobi-credits.ts';

export type AgentChatModelId =
  | 'deepseek-v4.1-flash'
  | 'gpt-6-astra'
  | 'gpt-6-sol'
  | 'grok-4.6';

export type AgentChatModelOption = {
  id: AgentChatModelId;
  /** Main title (e.g. DeepSeek-V4.1) */
  label: string;
  /** Subtitle (e.g. Flash); may be empty */
  subtitle: string;
  /** Model id passed to the Claude Agent SDK / ANTHROPIC_MODEL */
  apiModel: string;
  /** Platform billing service_code */
  creditsServiceCode: string;
  /**
   * Models whose upstream has only the OpenAI-compatible protocol and no official Anthropic endpoint (e.g. xAI Grok,
   * OpenAI GPT-6): without a direct `ANTHROPIC_<MODEL>_BASE_URL` configured, they are called through the built-in
   * OpenAI ↔ Anthropic protocol bridge gateway.
   */
  viaOpenAiBridge?: boolean;
  /**
   * Override of the env key suffix (derived from the id by default). deepseek-v4.1-flash keeps the original
   * DEEPSEEK_V4_FLASH slot's key/base_url (Aliyun Bailian; the two slots always had the same values),
   * so the deployment doesn't need new env keys.
   */
  envSuffix?: string;
};

export type AgentChatModelEndpoint = {
  apiKey?: string;
  baseUrl?: string;
};

export const DEFAULT_AGENT_CHAT_MODEL_ID: AgentChatModelId = 'deepseek-v4.1-flash';

export const AGENT_CHAT_MODEL_OPTIONS: readonly AgentChatModelOption[] = [
  {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek-V4.1',
    subtitle: 'Flash',
    apiModel: 'deepseek-v4.1-flash',
    creditsServiceCode: 'deepseek-v4.1-flash',
    // Keeps the original deepseek-v4-flash slot (ANTHROPIC_DEEPSEEK_V4_FLASH_*,
    // the Aliyun Bailian DashScope Anthropic endpoint; the PRO slot keeps the same values)
    envSuffix: 'DEEPSEEK_V4_FLASH',
  },
  {
    id: 'gpt-6-astra',
    label: 'GPT-6',
    subtitle: 'Astra',
    apiModel: 'gpt-6-astra',
    creditsServiceCode: 'gpt-6-astra',
    // Official OpenAI has only the OpenAI protocol; it goes through the built-in protocol bridge to the relay's /openai/v1
    viaOpenAiBridge: true,
  },
  {
    id: 'gpt-6-sol',
    label: 'GPT-6',
    subtitle: 'Sol',
    apiModel: 'gpt-6-sol',
    creditsServiceCode: 'gpt-6-sol',
    viaOpenAiBridge: true,
  },
  {
    id: 'grok-4.6',
    label: 'Grok-4.6',
    subtitle: '',
    apiModel: 'grok-4.6',
    creditsServiceCode: 'grok-4.6',
    // Official xAI has no Anthropic-compatible endpoint (api.x.ai 404s in practice); by default it goes through the built-in protocol bridge to the relay's /xai/v1
    viaOpenAiBridge: true,
  },
] as const;

const MODEL_BY_ID = new Map(AGENT_CHAT_MODEL_OPTIONS.map((m) => [m.id, m]));
const MODEL_BY_API = new Map(
  AGENT_CHAT_MODEL_OPTIONS.flatMap((m) => [
    [m.apiModel, m] as const,
    [normalizeAinobiServiceCode(m.apiModel), m] as const,
  ]),
);

/** `deepseek-v4-flash` → `DEEPSEEK_V4_FLASH`; `glm-5.2` → `GLM_5_2`; `kimi-k3` → `KIMI_K3` */
export function agentChatModelEnvSuffix(modelId: string): string {
  return modelId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type AgentChatModelApiIdResolution = {
  apiModel: string;
  /** Name of the source env when a redirect happened; null when not redirected */
  redirectFromEnv: string | null;
};

/**
 * Model id actually passed to the upstream API (may differ from the surface id / billing service_code).
 * Taken from `AINOBI_<MODEL>_API_ID` with the model's own derived suffix
 * (e.g. AINOBI_DEEPSEEK_V4_1_FLASH_API_ID).
 *
 * Two migration-safety constraints:
 * - the legacy AINOBI_MODEL_API_ID / AINOBI_DEEPSEEK_V4_FLASH_API_ID are not read:
 *   a deepseek-v4-flash-0731 value left over by old deployments would silently redirect the new default deepseek-v4.1-flash
 *   back to the v4 upstream (billed as v4.1 but executed as v4).
 * - the envSuffix override applies only to the credential slots (KEY/BASE_URL), not to the API_ID variable name.
 */
export function resolveAgentChatModelApiId(
  model: AgentChatModelOption,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveAgentChatModelApiIdDetails(model, env).apiModel;
}

export function resolveAgentChatModelApiIdDetails(
  model: AgentChatModelOption,
  env: NodeJS.ProcessEnv = process.env,
): AgentChatModelApiIdResolution {
  const suffix = agentChatModelEnvSuffix(model.id);
  const perModelKey = `AINOBI_${suffix}_API_ID`;
  const perModel = env[perModelKey]?.trim();
  if (perModel) {
    return { apiModel: perModel, redirectFromEnv: perModelKey };
  }
  return { apiModel: model.apiModel, redirectFromEnv: null };
}

function finalizeAgentChatModel(model: AgentChatModelOption): AgentChatModelOption {
  const { apiModel, redirectFromEnv } = resolveAgentChatModelApiIdDetails(model);
  if (!redirectFromEnv || apiModel === model.apiModel) return model;
  console.info(
    `[chat-model] API redirect ${model.id} → ${apiModel} (credits=${model.creditsServiceCode}, via ${redirectFromEnv})`,
  );
  return { ...model, apiModel };
}

function matchAgentChatModel(input: string | null | undefined): AgentChatModelOption | null {
  const raw = input?.trim();
  if (!raw) return null;
  const byId = MODEL_BY_ID.get(raw as AgentChatModelId);
  if (byId) return byId;
  const byApi = MODEL_BY_API.get(raw) ?? MODEL_BY_API.get(normalizeAinobiServiceCode(raw));
  if (byApi) return byApi;
  const normalized = normalizeAinobiServiceCode(raw);
  for (const option of AGENT_CHAT_MODEL_OPTIONS) {
    const redirected = resolveAgentChatModelApiId(option);
    if (redirected === raw || normalizeAinobiServiceCode(redirected) === normalized) {
      return option;
    }
  }
  return null;
}

/** Resolve the model in the request; unknown values fall back to ANTHROPIC_MODEL / the default, returning the canonical apiModel (with env redirection). */
export function resolveAgentChatModel(input?: string | null): AgentChatModelOption {
  const matched =
    matchAgentChatModel(input) ??
    matchAgentChatModel(process.env.ANTHROPIC_MODEL) ??
    MODEL_BY_ID.get(DEFAULT_AGENT_CHAT_MODEL_ID)!;
  return finalizeAgentChatModel(matched);
}

export function assertAgentChatModelSupported(input?: string | null): AgentChatModelOption {
  const raw = input?.trim();
  if (!raw) {
    return resolveAgentChatModel(undefined);
  }
  const matched = matchAgentChatModel(raw);
  if (!matched) {
    const allowed = AGENT_CHAT_MODEL_OPTIONS.map((m) => m.id).join(', ');
    throw new Error(`Unsupported model "${raw}". Allowed: ${allowed}`);
  }
  return finalizeAgentChatModel(matched);
}

/**
 * Resolve the Anthropic-compatible endpoint per model.
 * `ANTHROPIC_<MODEL>_API_KEY` / `ANTHROPIC_<MODEL>_BASE_URL` first
 * (e.g. ANTHROPIC_GLM_5_2_*, ANTHROPIC_DEEPSEEK_V4_FLASH_*, ANTHROPIC_KIMI_K3_*),
 * falling back to the global ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL (a shared endpoint such as OpenRouter) when unset.
 *
 * Pairing rules for `viaOpenAiBridge` models (e.g. xAI Grok) — credential and endpoint must come from the same source:
 * - a per-model key is configured: the global BASE_URL is not inherited (the global URL points at a shared endpoint unrelated to
 *   xAI, so inheriting it would send the xAI key to an unrelated provider); BASE_URL is left empty to use the built-in protocol bridge.
 * - no per-model key, and the global key/URL exist as a pair: the global pair is used as a whole
 *   (e.g. OpenRouter), never split — taking only the key would pass the shared credential through to api.x.ai.
 * - only a global key, no global URL: BASE_URL is left empty to use the built-in protocol bridge (deployments that put the xAI key
 *   in the global slot).
 * An explicitly configured per-model BASE_URL can still connect directly to any Anthropic-compatible endpoint.
 */
export function resolveAgentChatModelEndpoint(
  model: AgentChatModelOption,
  env: NodeJS.ProcessEnv = process.env,
): AgentChatModelEndpoint {
  const suffix = model.envSuffix ?? agentChatModelEnvSuffix(model.id);
  let perModelKey = env[`ANTHROPIC_${suffix}_API_KEY`]?.trim() || undefined;
  // The gpt-6 family's credential may be in the generic OPENAI_API_KEY (the gpt6 group passes through by baseurl):
  // without a per-model key it falls back to that, otherwise the SDK request has no x-api-key and the gateway forwards an
  // empty Bearer, so the upstream returns 401
  if (!perModelKey && model.viaOpenAiBridge && model.id.startsWith('gpt-6')) {
    perModelKey = env.OPENAI_API_KEY?.trim() || undefined;
  }
  const globalKey =
    env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined;
  const globalUrl = env.ANTHROPIC_BASE_URL?.trim() || undefined;
  const apiKey = perModelKey || globalKey;
  let baseUrl = env[`ANTHROPIC_${suffix}_BASE_URL`]?.trim() || undefined;
  if (!baseUrl) {
    if (model.viaOpenAiBridge) {
      // Bridge models: with a per-model key → left empty to use the built-in bridge (the xAI key is never sent to the global endpoint);
      // without a per-model key → the global pair is used as a whole (e.g. OpenRouter), never split
      baseUrl = perModelKey ? undefined : globalUrl;
    } else {
      baseUrl = globalUrl;
    }
  }
  return { apiKey: apiKey || undefined, baseUrl: baseUrl || undefined };
}

/** Whether the editor's assistant can answer: the model its panel starts on has both a credential and an endpoint. */
export function isAgentChatConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const { apiKey, baseUrl } = resolveAgentChatModelEndpoint(MODEL_BY_ID.get(DEFAULT_AGENT_CHAT_MODEL_ID)!, env);
  return Boolean(apiKey && baseUrl);
}
