// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM capability port: the provider contract every implementation satisfies
 * (create_completion_stream / create_completion / close / capability flags, with
 * Whisper transcription as an optional extension), the provider kinds the platform
 * ships, and a registry with a throwing default so an unconfigured kind fails loudly.
 * Billing and audit wrap a provider as decorators; implementations never handle them.
 */

import { createProviderRegistry, PortNotConfiguredError, type ProviderRegistry } from "@ainobi/port-kit";
import type {
  ChatCompletionMessage,
  CompletionResult,
  StreamOptions,
  ThinkingOptions,
} from "@ainobi/api-contracts/schemas/base_agent.ts";

export type { ChatCompletionMessage, CompletionResult, StreamOptions, ThinkingOptions };

/**
 * Kinds of the built-in providers (@ainobi/llm-* and the platform's own adapters). The registry accepts any string, so a third party
 * registers its own kind without extending this list.
 */
export const LLMProvider = {
  OPENAI: "openai",
  VERTEXAI: "vertexai",
  DEEPSEEK: "deepseek",
  XAI: "xai",
} as const;
export type LLMProvider = (typeof LLMProvider)[keyof typeof LLMProvider];

/** Unified stream chunk structure */
export interface StreamChunk {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Record<string, unknown>[] | null;
  finish_reason?: string | null;
  usage?: Record<string, number> | null;
  error?: string | null;
}

export interface StreamParams {
  messages: ChatCompletionMessage[];
  tools?: Record<string, unknown>[] | null;
  tool_choice?: string;
  max_tokens?: number | null;
  stream_options?: StreamOptions | null;
  thinking_options?: ThinkingOptions | null;
}

export interface CompletionParams {
  messages: ChatCompletionMessage[];
  tools?: Record<string, unknown>[] | null;
  tool_choice?: string;
  max_tokens?: number | null;
  /** Pass-through parameters (temperature / reasoning_effort etc. — openai passes them straight to the API,
   * vertexai consumes only top_p and ignores the rest) */
  extraParams?: Record<string, unknown>;
}

/** Common LLM provider interface */
export interface BaseLLMProvider {
  model: string;
  api_key?: string | null;
  api_base?: string | null;
  proxy?: string | null;

  create_completion_stream(params: StreamParams): AsyncGenerator<StreamChunk, void, undefined>;

  create_completion(params: CompletionParams): Promise<CompletionResult>;

  close(): Promise<void>;

  supports_tools(): boolean;
  supports_thinking(): boolean;
}

/** Whisper transcription parameters */
export interface TranscribeAudioParams {
  file: { filename: string; buffer: Buffer };
  model?: string | null;
  language?: string | null;
  prompt?: string | null;
  temperature?: number | null;
  response_format?: string | null;
  [key: string]: unknown;
}

/** Audio transcription capability (implemented by the openai provider; other providers lack this method) */
export interface TranscribingProvider extends BaseLLMProvider {
  transcribeAudio(params: TranscribeAudioParams): Promise<unknown>;
}

/** Provider constructor parameters (common keywords + provider-specific extra kwargs) */
export interface ProviderCtorParams {
  model: string;
  api_key?: string | null;
  api_base?: string | null;
  proxy?: string | null;
  [key: string]: unknown;
}

/** Thrown by the default provider and by registry misses. */
export { PROVIDER_NOT_CONFIGURED } from "@ainobi/port-kit";
export { PortNotConfiguredError };
export type { ProviderRegistry };

/** This port's not-configured error; `instanceof PortNotConfiguredError` catches every port's. */
export class ProviderNotConfiguredError extends PortNotConfiguredError {
  constructor(kind: string) {
    super("LLM provider", kind);
  }
}

/** The throwing default. */
export class UnconfiguredLLMProvider implements BaseLLMProvider {
  model = "unconfigured";
  constructor(private readonly kind: string) {}
  create_completion_stream(): AsyncGenerator<StreamChunk, void, undefined> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async create_completion(): Promise<CompletionResult> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async close(): Promise<void> {}
  supports_tools(): boolean {
    throw new ProviderNotConfiguredError(this.kind);
  }
  supports_thinking(): boolean {
    throw new ProviderNotConfiguredError(this.kind);
  }
}

/**
 * Creates a provider registry owned by the caller — for hosts that keep several configurations
 * in one process, or that avoid module-level state. Unregistered kinds resolve to the throwing
 * default.
 */
export function createLLMProviderRegistry(): ProviderRegistry<BaseLLMProvider> {
  return createProviderRegistry<BaseLLMProvider>((kind) => new UnconfiguredLLMProvider(kind));
}

/** The process-wide default registry behind the functions below. */
const defaultRegistry = createLLMProviderRegistry();

/** Register an implementation for a kind at the composition root. */
export function registerLLMProvider(kind: string, provider: BaseLLMProvider): void {
  defaultRegistry.register(kind, provider);
}

/** Test hook: drop one kind (or the whole registry). */
export function unregisterLLMProvider(kind?: string): void {
  defaultRegistry.unregister(kind);
}

/** Resolve a provider; an unregistered kind yields the throwing default. */
export function getLLMProvider(kind: string): BaseLLMProvider {
  return defaultRegistry.get(kind);
}
