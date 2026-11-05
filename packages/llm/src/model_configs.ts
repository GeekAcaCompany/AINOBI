// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Model config mapping.
 * Holds max context/output tokens, the token parameter name (max_tokens vs max_completion_tokens),
 * tool/streaming/thinking capabilities and the parameter mapping table.
 */

export const ParameterType = {
  MAX_TOKENS: "max_tokens",
  MAX_COMPLETION_TOKENS: "max_completion_tokens",
} as const;
export type ParameterType = (typeof ParameterType)[keyof typeof ParameterType];

export interface ModelConfig {
  model_name: string;
  provider: string;
  max_context_length: number;
  max_output_tokens: number;
  token_parameter: ParameterType;
  supports_tools: boolean;
  supports_streaming: boolean;
  supports_thinking: boolean;
  parameter_mappings: Record<string, string>;
}

function cfg(
  model_name: string,
  provider: string,
  max_context_length: number,
  max_output_tokens: number,
  token_parameter: ParameterType,
  supports_thinking: boolean,
  parameter_mappings: Record<string, string> = {},
): ModelConfig {
  return {
    model_name,
    provider,
    max_context_length,
    max_output_tokens,
    token_parameter,
    supports_tools: true,
    supports_streaming: true,
    supports_thinking,
    parameter_mappings,
  };
}

const OPENAI_TOKEN_MAP = { max_tokens: "max_completion_tokens" };

// OpenAI model configs
const OPENAI_MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gpt-5": cfg("gpt-5", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-5.1": cfg("gpt-5.1", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-5.4": cfg("gpt-5.4", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-5.4-mini": cfg("gpt-5.4-mini", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-5.5": cfg("gpt-5.5", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-5.6-sol": cfg("gpt-5.6-sol", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-6-astra": cfg("gpt-6-astra", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, true, OPENAI_TOKEN_MAP),
  "gpt-6-sol": cfg("gpt-6-sol", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, true, OPENAI_TOKEN_MAP),
  "gpt-5.6-terra": cfg("gpt-5.6-terra", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-5.6-luna": cfg("gpt-5.6-luna", "openai", 200704, 16384, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "gpt-5-nano": cfg("gpt-5-nano", "openai", 128000, 4096, ParameterType.MAX_COMPLETION_TOKENS, false, OPENAI_TOKEN_MAP),
  "kimi-k3": cfg("kimi-k3", "openai", 1048576, 131072, ParameterType.MAX_COMPLETION_TOKENS, true, OPENAI_TOKEN_MAP),
  "deepseek-v4.1-flash": cfg("deepseek-v4.1-flash", "deepseek", 131072, 8192, ParameterType.MAX_TOKENS, false),
  "grok-4.6": cfg("grok-4.6", "xai", 262144, 131072, ParameterType.MAX_COMPLETION_TOKENS, true, OPENAI_TOKEN_MAP),
  "gpt-4o": cfg("gpt-4o", "openai", 128000, 16384, ParameterType.MAX_TOKENS, false),
};

// Vertex AI model configs
const VERTEXAI_MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gemini-3.5-flash": cfg("gemini-3.5-flash", "vertexai", 1048576, 65536, ParameterType.MAX_TOKENS, false),
  "gemini-3.1-pro-preview": cfg("gemini-3.1-pro-preview", "vertexai", 2000000, 8192, ParameterType.MAX_TOKENS, false),
  "gemini-3.1-flash-lite-preview": cfg("gemini-3.1-flash-lite-preview", "vertexai", 1048576, 65536, ParameterType.MAX_TOKENS, false),
  "gemini-3.6-flash": cfg("gemini-3.6-flash", "vertexai", 1048576, 65536, ParameterType.MAX_TOKENS, false),
};

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  ...OPENAI_MODEL_CONFIGS,
  ...VERTEXAI_MODEL_CONFIGS,
};

/** Look up a model config by name: exact → case-insensitive → partial match in both directions */
export function getModelConfig(modelName: string): ModelConfig | null {
  if (Object.prototype.hasOwnProperty.call(MODEL_CONFIGS, modelName)) {
    return MODEL_CONFIGS[modelName];
  }

  const modelLower = modelName.toLowerCase();
  for (const [configName, config] of Object.entries(MODEL_CONFIGS)) {
    if (configName.toLowerCase() === modelLower) {
      return config;
    }
  }

  for (const [configName, config] of Object.entries(MODEL_CONFIGS)) {
    const nameLower = configName.toLowerCase();
    if (nameLower.includes(modelLower) || modelLower.includes(nameLower)) {
      return config;
    }
  }

  return null;
}

/** Clamp output/input token counts to the model limit (logs and truncates when exceeded) */
export function validateTokens(
  tokens: number,
  modelConfig: ModelConfig,
  parameterType: string = "output",
): number {
  if (parameterType === "output") {
    const maxTokens = modelConfig.max_output_tokens;
    if (tokens > maxTokens) {
      console.warn(
        `Output tokens ${tokens} exceed maximum ${maxTokens} for ${modelConfig.model_name}, clamping to ${maxTokens}`,
      );
      return maxTokens;
    }
  } else if (parameterType === "input") {
    const maxTokens = modelConfig.max_context_length;
    if (tokens > maxTokens) {
      console.warn(
        `Input tokens ${tokens} exceed maximum context ${maxTokens} for ${modelConfig.model_name}, clamping to ${maxTokens}`,
      );
      return maxTokens;
    }
  }
  return tokens;
}

/** Parameter name mapping (e.g. max_tokens → max_completion_tokens) */
export function getParameterMapping(
  modelConfig: ModelConfig,
  parameterName: string,
): string {
  return modelConfig.parameter_mappings[parameterName] ?? parameterName;
}
