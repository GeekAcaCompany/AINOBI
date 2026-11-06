// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Avatar pipeline config: canvas and chroma constants, and the settings a host passes in.
 */

/** Generation canvas (square) */
export const CANVAS_SIZE = "1024x1024";
export const CANVAS_W = 1024;
export const CANVAS_H = 1024;

/** Neutral gray screen of the part extraction line (kept for legacy asset compatibility) */
export const CHROMA_HEX = "#808080";

/**
 * The key for generation: LLM_API_KEY, else OPENAI_API_KEY while LLM_API_BASE is unset (the default endpoint is
 * OpenAI's), so an OpenAI key never goes to another provider. Null when neither applies.
 */
export function avatarApiKeyFromEnv(env: Record<string, string | undefined>): string | null {
  const llmKey = env.LLM_API_KEY?.trim();
  if (llmKey) return llmKey;
  if (env.LLM_API_BASE?.trim()) return null;
  return env.OPENAI_API_KEY?.trim() || null;
}

/** Pipeline client config */
export interface AvatarPipelineSettings {
  apiKey: string;
  apiBase: string | null;
  imageModel: string;
  visionModel: string;
  /** Builds the API client for a model. Default: the OpenAI SDK with apiKey and apiBase. */
  openClient?: (model: string) => AvatarApiClient | Promise<AvatarApiClient>;
}

/** The part of an OpenAI SDK client the pipeline uses, and how to release it. */
export interface AvatarApiClient {
  client: {
    images: { edit(params: never): Promise<unknown>; generate(params: never): Promise<unknown> };
    chat: { completions: { create(params: never): Promise<unknown> } };
  };
  close(): Promise<void>;
}
