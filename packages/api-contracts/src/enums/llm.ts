// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM domain enums.
 */

/** LLM provider (PG enum type: llmprovider) */
export const LLMProvider = {
  OpenAI: "openai",
  Anthropic: "anthropic",
  Azure: "azure",
  BigModel: "bigmodel",
  VolcEngine: "volcengine",
  DeepSeek: "deepseek",
  Aliyun: "aliyun",
  VertexAI: "vertexai",
  Xai: "xai",
} as const;
export type LLMProvider = (typeof LLMProvider)[keyof typeof LLMProvider];

/**
 * Provider → model list available to AI teachers.
 *
 * NOTE: kimi-k3 (Moonshot, OpenAI-compatible wire protocol only) is deliberately not listed here — it is only
 * the courseware editor's chat model, never a provider/model an AI teacher can pick.
 */
export const LLMModelMap: Partial<Record<LLMProvider, string[]>> = {
  [LLMProvider.OpenAI]: [
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.1",
    "gpt-5",
    "gpt-4o",
  ],
  // [LLMProvider.Anthropic]: ["sonnet-4.5", "haiku-4.5"],
  // [LLMProvider.Azure]: ["gpt-4o", "gpt-5"],
  // [LLMProvider.BigModel]: ["glm-4.5", "glm-4-flashx-250414"],
  // [LLMProvider.VolcEngine]: ["doubao-seed-1.6"],
  [LLMProvider.DeepSeek]: [
    "deepseek-v4.1-flash",
  ],
  // [LLMProvider.Aliyun]: ["qwen3-max"],
  [LLMProvider.VertexAI]: [
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.6-flash",
  ],
  [LLMProvider.Xai]: [
    "grok-4.6",
  ],
};
