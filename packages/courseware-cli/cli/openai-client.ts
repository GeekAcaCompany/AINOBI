// SPDX-License-Identifier: AGPL-3.0-only
import OpenAI from "openai";
import { cliEnv } from "./env.ts";

export type OpenAiEnvConfig = {
  apiKey: string;
  baseURL?: string;
  model: string;
};

export const readOpenAiEnvConfig = (): OpenAiEnvConfig | null => {
  const apiKey = cliEnv().OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseURL = cliEnv().OPENAI_API_BASE?.trim();
  return {
    apiKey,
    ...(baseURL ? { baseURL: baseURL.replace(/\/$/, "") } : {}),
    model: cliEnv().OPENAI_MODEL?.trim() || "gpt-4o-mini",
  };
};

export const createOpenAiClient = (config: OpenAiEnvConfig): OpenAI =>
  new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });

export type ChatCompletionTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export function chatCompletionTokenUsage(
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  } | null,
): ChatCompletionTokenUsage {
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}
