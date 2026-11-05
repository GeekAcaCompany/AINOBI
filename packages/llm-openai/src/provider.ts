// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenAI LLM provider.
 *
 * Built on the openai npm SDK (Chat Completions protocol; compatible endpoints such as DeepSeek/xAI/Kimi
 * use this implementation too). The streaming path accumulates tool-call fragments (aggregated by index,
 * emitted as a whole when finish_reason=="tool_calls") and handles DeepSeek cache hits (cache_tokens
 * subtracted from prompt_tokens).
 */

import OpenAI from "openai";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  ChatCompletionMessage,
  CompletionResult,
  StreamOptions,
  ThinkingOptions,
} from "@ainobi/api-contracts/schemas/base_agent.ts";
import { MessageRole } from "@ainobi/api-contracts/schemas/base_agent.ts";
import { getModelConfig, validateTokens, type BaseLLMProvider, type StreamChunk } from "@ainobi/llm";

/** Deployment settings; the host maps its configuration onto these (nothing is read from the environment). */
export interface OpenAISettings {
  api_key: string;
  /** Default API base; empty uses the SDK's own default. */
  api_base: string;
}

export const DEFAULT_OPENAI_SETTINGS: OpenAISettings = {
  api_key: "",
  api_base: "https://api.openai.com/v1",
};

/**
 * Outbound HTTP seam: in proxy mode, fetch and ProxyAgent must come from the same undici
 * (requests hang when the dispatcher and fetch major versions differ), so both are taken from this repo's undici dependency.
 * Replaceable at module level so unit tests can inject stubs.
 */
export const outboundHttp: {
  fetch: typeof fetch;
  proxyAgent: (uri: string) => unknown;
} = {
  fetch: undiciFetch as unknown as typeof fetch,
  proxyAgent: (uri) => new ProxyAgent(uri),
};

/** Message payload (with explicit null fields — the SDK request body shape contract) */
export function dumpMessage(msg: ChatCompletionMessage): Record<string, unknown> {
  return {
    role: msg.role,
    content: msg.content,
    tool_calls: msg.tool_calls ?? null,
    tool_call_id: msg.tool_call_id ?? null,
    audio: msg.audio ?? null,
    audio_mime_type: msg.audio_mime_type ?? null,
    reference_audio_attachments: null,
  };
}

/** Estimate the tokens of one message (images in vision messages use a fixed estimate) */
function estimateMessageTokens(message: ChatCompletionMessage): number {
  let tokens = 0;
  if (message.role) {
    tokens += 2;
  }
  if (!message.content) {
    return tokens;
  }
  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item && typeof item === "object") {
        if (item.type === "text" && "text" in item) {
          tokens += Math.floor(String(item.text).length / 4);
        } else if (item.type === "image_url" && "image_url" in item) {
          const imageUrl = item.image_url as { url?: string } | undefined;
          const url = imageUrl?.url ?? "";
          if (url.startsWith("data:")) {
            tokens += 800;
          } else {
            tokens += 170;
          }
        }
      }
    }
  } else {
    tokens += Math.floor(message.content.length / 4);
  }
  return tokens;
}

/** When the context length is exceeded, drop from the oldest non-system message (system messages kept) */
function validateInputContextLength(
  messages: ChatCompletionMessage[],
  modelConfig: { max_context_length: number },
): ChatCompletionMessage[] {
  const estimatedTokens = messages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0,
  );

  if (estimatedTokens <= modelConfig.max_context_length) {
    return messages;
  }

  console.warn(
    `Estimated input tokens (${estimatedTokens}) exceed model context length (${modelConfig.max_context_length})`,
  );

  const systemMessages = messages.filter((msg) => msg.role === MessageRole.SYSTEM);
  const otherMessages = messages.filter((msg) => msg.role !== MessageRole.SYSTEM);

  const truncatedMessages = [...systemMessages];
  let currentTokens = systemMessages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0,
  );

  const availableTokens = Math.floor(modelConfig.max_context_length * 0.9) - currentTokens;

  if (availableTokens < 0) {
    console.warn(
      `System messages alone exceed 90% of context length. Keeping all system messages anyway (${systemMessages.length} messages).`,
    );
    if (otherMessages.length > 0) {
      const firstUserMsgTokens = estimateMessageTokens(otherMessages[0]);
      if (currentTokens + firstUserMsgTokens <= modelConfig.max_context_length) {
        truncatedMessages.push(otherMessages[0]);
        console.info(
          `Added first user message despite exceeding limit. Total estimated tokens: ${currentTokens + firstUserMsgTokens}`,
        );
      }
    }
  } else {
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const message = otherMessages[i];
      const messageTokens = estimateMessageTokens(message);
      if (currentTokens + messageTokens <= availableTokens + currentTokens) {
        truncatedMessages.splice(systemMessages.length, 0, message);
        currentTokens += messageTokens;
      } else {
        break;
      }
    }
  }

  console.info(
    `Truncated messages from ${messages.length} to ${truncatedMessages.length} to fit context length`,
  );

  if (truncatedMessages.length === 0) {
    console.error(
      "Truncation resulted in empty messages array! This should not happen. Returning original messages.",
    );
    return messages;
  }

  return truncatedMessages;
}

/** DeepSeek cache hit: subtracted from prompt_tokens (a subset), recorded separately as cache_tokens */
function applyCacheHit(
  usage: Record<string, number>,
  cacheHit: number | null | undefined,
): void {
  if (cacheHit) {
    usage.prompt_tokens -= cacheHit;
    usage.cache_tokens = cacheHit;
  }
}

export class OpenAIProvider implements BaseLLMProvider {
  model: string;
  api_key: string | null;
  api_base: string | null;
  proxy: string | null;
  extraConfig: Record<string, unknown>;
  client: OpenAI;
  readonly settings: OpenAISettings;

  constructor(params: {
    model: string;
    api_key?: string | null;
    api_base?: string | null;
    proxy?: string | null;
    settings?: Partial<OpenAISettings>;
  } & Record<string, unknown>) {
    this.settings = { ...DEFAULT_OPENAI_SETTINGS, ...params.settings };
    this.model = params.model;
    this.api_key = params.api_key ?? null;
    this.api_base = params.api_base ?? null;
    this.proxy = params.proxy ?? null;
    const { model: _m, api_key: _k, api_base: _b, proxy: _p, settings: _s, ...rest } = params;
    this.extraConfig = rest;

    if (!this.api_key) {
      this.api_key = this.settings.api_key;
      if (!this.api_key) {
        throw new Error(
          "OpenAI API key not provided and LLM_API_KEY environment variable is not set",
        );
      }
    }

    if (this.api_base === null) {
      this.api_base = this.settings.api_base || null;
    }

    // The SDK timeout is in milliseconds; config values (LLM_API_TIMEOUT / ASR WHISPER_TIMEOUT etc.)
    // are in seconds, defaulting to 3600 seconds
    const timeoutSeconds = (this.extraConfig.timeout as number | undefined) ?? 3600.0;
    const clientOptions: Record<string, unknown> = {
      apiKey: this.api_key,
      timeout: timeoutSeconds * 1000,
    };
    if (this.api_base) {
      clientOptions.baseURL = this.api_base;
    }
    if (this.proxy) {
      console.info(`OpenAI Provider using proxy: ${this.proxy}`);
      clientOptions.fetch = outboundHttp.fetch;
      clientOptions.fetchOptions = {
        dispatcher: outboundHttp.proxyAgent(this.proxy),
      };
    }
    this.client = new OpenAI(clientOptions as never);
  }

  async *create_completion_stream(params: {
    messages: ChatCompletionMessage[];
    tools?: Record<string, unknown>[] | null;
    tool_choice?: string;
    max_tokens?: number | null;
    stream_options?: StreamOptions | null;
    thinking_options?: ThinkingOptions | null;
  }): AsyncGenerator<StreamChunk, void, undefined> {
    try {
      let modelConfig = getModelConfig(this.model);
      if (!modelConfig) {
        console.warn(
          `No configuration found for model ${this.model}, using default settings`,
        );
        modelConfig = getModelConfig("gpt-4o");
      }

      const validatedMessages = validateInputContextLength(
        params.messages,
        modelConfig!,
      );

      const validatedMaxTokens = validateTokens(
        params.max_tokens ?? modelConfig!.max_output_tokens,
        modelConfig!,
        "output",
      );

      const requestParams: Record<string, unknown> = {
        model: this.model,
        messages: validatedMessages.map(dumpMessage),
        stream: modelConfig!.supports_streaming,
      };

      const tokenParamName = modelConfig!.token_parameter;
      requestParams[tokenParamName] = validatedMaxTokens;

      if (modelConfig!.parameter_mappings) {
        for (const [oldParam, newParam] of Object.entries(modelConfig!.parameter_mappings)) {
          if (oldParam in requestParams) {
            requestParams[newParam] = requestParams[oldParam];
            delete requestParams[oldParam];
          }
        }
      }

      if (params.tools && params.tools.length > 0) {
        if (modelConfig!.supports_tools) {
          requestParams.tools = params.tools;
          requestParams.tool_choice = params.tool_choice ?? "auto";
        } else {
          console.warn(
            `Model ${this.model} does not support tools, ignoring tool parameters`,
          );
        }
      }

      if (params.stream_options) {
        requestParams.stream_options = {
          include_usage: params.stream_options.include_usage,
        };
      }

      const stream = (await this.client.chat.completions.create(
        requestParams as never,
      )) as unknown as AsyncIterable<{
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_cache_hit_tokens?: number | null;
        } | null;
        choices: {
          error?: { message?: string } | null;
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: {
              index?: number;
              id?: string | null;
              type?: string | null;
              function?: { name?: string | null; arguments?: string | null } | null;
            }[] | null;
          } | null;
        }[];
      }>;

      // Tool-call fragments being accumulated (aggregated by index)
      const accumulatedToolCalls: Record<number, Record<string, unknown>> = {};

      for await (const chunk of stream) {
        let usageDict: Record<string, number> | null = null;
        if (chunk.usage) {
          usageDict = {
            prompt_tokens: chunk.usage.prompt_tokens ?? 0,
            completion_tokens: chunk.usage.completion_tokens ?? 0,
            total_tokens: chunk.usage.total_tokens ?? 0,
          };
          applyCacheHit(usageDict, chunk.usage.prompt_cache_hit_tokens);
        }

        for (const choice of chunk.choices ?? []) {
          if (choice.error) {
            yield { error: choice.error.message ?? "Unknown error" };
            continue;
          }

          const finishReason = choice.finish_reason ?? null;

          const delta = choice.delta;
          let content: string | null = null;
          let reasoningContent: string | null = null;
          let toolCallsList: Record<string, unknown>[] | null = null;

          if (delta) {
            if (delta.content) {
              content = delta.content;
            }
            if (delta.reasoning_content) {
              reasoningContent = delta.reasoning_content;
            }
            if (delta.tool_calls) {
              for (const toolCallChunk of delta.tool_calls) {
                const index = toolCallChunk.index ?? 0;
                if (!(index in accumulatedToolCalls)) {
                  accumulatedToolCalls[index] = {
                    index,
                    function: { name: "", arguments: "" },
                  };
                }
                const acc = accumulatedToolCalls[index];
                if (toolCallChunk.id) {
                  acc.id = toolCallChunk.id;
                }
                if (toolCallChunk.type) {
                  acc.type = toolCallChunk.type;
                }
                if (toolCallChunk.function) {
                  if (toolCallChunk.function.name) {
                    acc.function = acc.function ?? { name: "", arguments: "" };
                    (acc.function as { name: string }).name += toolCallChunk.function.name;
                  }
                  if (toolCallChunk.function.arguments) {
                    acc.function = acc.function ?? { name: "", arguments: "" };
                    (acc.function as { arguments: string }).arguments +=
                      toolCallChunk.function.arguments;
                  }
                }
              }
            }
          }

          if (finishReason === "tool_calls") {
            toolCallsList = Object.values(accumulatedToolCalls);
          }

          yield {
            content,
            reasoning_content: reasoningContent,
            tool_calls: toolCallsList,
            finish_reason: finishReason,
            usage: usageDict,
          };
        }
      }
    } catch (error) {
      console.error(`Error in OpenAI streaming: ${error}`);
      yield { error: `OpenAI API error: ${String(error)}` };
    }
  }

  async create_completion(params: {
    messages: ChatCompletionMessage[];
    tools?: Record<string, unknown>[] | null;
    tool_choice?: string;
    max_tokens?: number | null;
    extraParams?: Record<string, unknown>;
  }): Promise<CompletionResult> {
    try {
      let modelConfig = getModelConfig(this.model);
      if (!modelConfig) {
        console.warn(
          `No configuration found for model ${this.model}, using default settings`,
        );
        modelConfig = getModelConfig("gpt-4o");
      }

      const validatedMessages = validateInputContextLength(
        params.messages,
        modelConfig!,
      );

      const validatedMaxTokens = validateTokens(
        params.max_tokens ?? modelConfig!.max_output_tokens,
        modelConfig!,
        "output",
      );

      const requestParams: Record<string, unknown> = {
        model: this.model,
        messages: validatedMessages.map(dumpMessage),
        stream: false,
      };

      const tokenParamName = modelConfig!.token_parameter;
      requestParams[tokenParamName] = validatedMaxTokens;

      if (modelConfig!.parameter_mappings) {
        for (const [oldParam, newParam] of Object.entries(modelConfig!.parameter_mappings)) {
          if (oldParam in requestParams) {
            requestParams[newParam] = requestParams[oldParam];
            delete requestParams[oldParam];
          }
        }
      }

      if (params.tools && params.tools.length > 0) {
        if (modelConfig!.supports_tools) {
          requestParams.tools = params.tools;
          requestParams.tool_choice = params.tool_choice ?? "auto";
        } else {
          console.warn(
            `Model ${this.model} does not support tools, ignoring tool parameters`,
          );
        }
      }

      // Pass-through parameters (merged into the request body; may override default parameters of the same name)
      if (params.extraParams) {
        Object.assign(requestParams, params.extraParams);
      }

      const response = (await this.client.chat.completions.create(
        requestParams as never,
      )) as {
        choices: {
          message: {
            content?: string | null;
            tool_calls?: {
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }[] | null;
          } | null;
          finish_reason?: string | null;
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_cache_hit_tokens?: number | null;
        } | null;
      };

      let content = "";
      let toolCalls: Record<string, unknown>[] | null = null;
      let finishReason: string | null = null;

      if (response.choices && response.choices.length > 0) {
        const choice = response.choices[0];
        if (choice.message?.content) {
          content = choice.message.content;
        }
        if (choice.message?.tool_calls) {
          toolCalls = choice.message.tool_calls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }));
        }
        finishReason = choice.finish_reason ?? null;
      }

      let usage: Record<string, number> | null = null;
      if (response.usage) {
        usage = {
          prompt_tokens: response.usage.prompt_tokens ?? 0,
          completion_tokens: response.usage.completion_tokens ?? 0,
          total_tokens: response.usage.total_tokens ?? 0,
        };
        applyCacheHit(usage, response.usage.prompt_cache_hit_tokens);
      }

      return { content, tool_calls: toolCalls, usage, finish_reason: finishReason };
    } catch (error) {
      console.error(`Error in OpenAI non-streaming: ${error}`);
      throw new Error(`OpenAI API error: ${String(error)}`);
    }
  }

  async transcribeAudio(params: {
    file: { filename: string; buffer: Buffer };
    model?: string | null;
    language?: string | null;
    prompt?: string | null;
    temperature?: number | null;
    response_format?: string | null;
  } & Record<string, unknown>): Promise<unknown> {
    const { file, ...requestParams } = params;
    try {
      const { toFile } = await import("openai");
      const transcribeParams: Record<string, unknown> = {
        model: requestParams.model || this.model,
        file: await toFile(file.buffer, file.filename),
      };
      if (requestParams.response_format) {
        transcribeParams.response_format = requestParams.response_format;
      }
      if (requestParams.language) {
        transcribeParams.language = requestParams.language;
      }
      if (requestParams.prompt) {
        transcribeParams.prompt = requestParams.prompt;
      }
      if (requestParams.temperature !== undefined && requestParams.temperature !== null) {
        transcribeParams.temperature = requestParams.temperature;
      }
      for (const [key, value] of Object.entries(requestParams)) {
        if (!["model", "language", "prompt", "temperature", "response_format"].includes(key)) {
          transcribeParams[key] = value;
        }
      }

      return await this.client.audio.transcriptions.create(
        transcribeParams as never,
      );
    } catch (error) {
      const errorType = (error as { constructor?: { name?: string } })?.constructor?.name ?? "Error";
      const errorMsg = String(error);
      console.error(
        `Error in OpenAI transcription: ${errorType}: ${errorMsg} ` +
          `(model: ${requestParams.model || this.model}, response_format: ${requestParams.response_format})`,
      );
      // HTTP/API errors keep the original exception (SDK errors carrying status are rethrown as-is)
      if ((error as { status?: number }).status !== undefined) {
        throw error as Error;
      }
      throw new Error(`OpenAI API error: ${errorType}: ${errorMsg}`);
    }
  }

  async close(): Promise<void> {
    // The openai npm SDK has no explicit close; kept as a semantic placeholder
  }

  supports_tools(): boolean {
    const modelConfig = getModelConfig(this.model);
    if (modelConfig) {
      return modelConfig.supports_tools;
    }
    return true;
  }

  supports_thinking(): boolean {
    const modelConfig = getModelConfig(this.model);
    if (modelConfig) {
      return modelConfig.supports_thinking;
    }
    const lowered = this.model.toLowerCase();
    return lowered.includes("o1") || lowered.includes("reasoning");
  }
}
