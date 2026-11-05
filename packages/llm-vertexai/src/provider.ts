// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vertex AI / Gemini LLM provider (REST implementation).
 *
 * Authenticates with an **API key** (GOOGLE_CLOUD_API_KEY) and uses the Gemini Developer API by default
 * (generativelanguage.googleapis.com): POST /v1beta/models/{model}:generateContent /
 * :streamGenerateContent?alt=sse, header x-goog-api-key, no OAuth/service account stack needed.
 * settings.base_url overrides the base (the FC relay in mainland China).
 *
 * settings.vertex_express switches to Vertex express mode (the REST equivalent of the upstream google-genai
 * SDK Client(vertexai=True, api_key=...)): the base becomes
 * aiplatform.googleapis.com and the path prefix /v1beta1/publishers/google/models/
 * (model names with a publisher/projects prefix are kept as-is); auth is still x-goog-api-key
 * — keys GCP issued for the Gemini API are refused by the server on aiplatform
 * (API_KEY_SERVICE_BLOCKED), so this switch is for environments holding a key valid for Vertex.
 *
 * Message conversion contract: the system prompt is embedded into the text of the first user message, tool messages →
 * functionResponse, assistant.tool_calls → functionCall (thoughtSignature kept),
 * audio/reference audio → inlineData base64.
 */

import type {
  ChatCompletionMessage,
  CompletionResult,
  StreamOptions,
  ThinkingOptions,
} from "@ainobi/api-contracts/schemas/base_agent.ts";
import { MessageRole } from "@ainobi/api-contracts/schemas/base_agent.ts";
import type { BaseLLMProvider, StreamChunk } from "@ainobi/llm";

/** Deployment settings; the host maps its configuration onto these (nothing is read from the environment). */
export interface VertexAISettings {
  api_key: string;
  /** Base URL override (e.g. a relay); empty picks the endpoint for the mode. */
  base_url: string;
  /** Vertex express mode: aiplatform paths instead of the Gemini API. */
  vertex_express: boolean;
}

export const DEFAULT_VERTEXAI_SETTINGS: VertexAISettings = {
  api_key: "",
  base_url: "",
  vertex_express: false,
};

const DEFAULT_TIMEOUT_MS = 600_000; // google-genai SDK default timeout

/** A single part in the SSE response (Gemini REST fields) */
interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> | null };
  inlineData?: { mimeType?: string; data?: string };
  functionResponse?: { name?: string; response?: unknown };
}

interface GeminiChunk {
  candidates?: {
    content?: { parts?: GeminiPart[] } | null;
    finishReason?: string | null;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  } | null;
}

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
];

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { result: text };
  }
}

function pyFloatRepr(value: number): string {
  // Upstream convention: float literals always render with a fraction (1 → "1.0"), integer literals without
  if (Number.isInteger(value) && Math.abs(value) < 1e16) {
    return `${value}.0`;
  }
  return String(value);
}

export class VertexAIProvider implements BaseLLMProvider {
  model: string;
  api_key: string | null;
  api_base: string | null;
  proxy: string | null;
  extraConfig: Record<string, unknown>;
  private baseUrl: string;
  private timeoutMs: number;
  /** Vertex express mode (settings.vertex_express) — the aiplatform path form */
  private vertexExpress: boolean;
  readonly settings: VertexAISettings;

  constructor(params: {
    model?: string;
    api_key?: string | null;
    api_base?: string | null;
    proxy?: string | null;
    settings?: Partial<VertexAISettings>;
  } & Record<string, unknown>) {
    this.settings = { ...DEFAULT_VERTEXAI_SETTINGS, ...params.settings };
    this.model = params.model ?? "gemini-3.1-pro-preview";
    this.api_key = params.api_key ?? null;
    this.api_base = params.api_base ?? null; // Deliberately ignored (a historical compatibility parameter; the base comes from settings)
    this.proxy = params.proxy ?? null;
    const { model: _m, api_key: _k, api_base: _b, proxy: _p, settings: _s, ...rest } = params;
    this.extraConfig = rest;

    if (!this.api_key) {
      this.api_key = this.settings.api_key;
      if (!this.api_key) {
        throw new Error(
          "Vertex AI API key not provided and GOOGLE_CLOUD_API_KEY environment variable is not set",
        );
      }
    }

    this.vertexExpress = this.settings.vertex_express;

    // settings.base_url overrides (the FC relay in mainland China); the api_base constructor parameter is deliberately ignored.
    // Express mode defaults to aiplatform (the same base choice as the SDK), otherwise the Gemini API.
    this.baseUrl = (
      this.settings.base_url ||
      (this.vertexExpress
        ? "https://aiplatform.googleapis.com"
        : "https://generativelanguage.googleapis.com")
    ).replace(/\/+$/, "");
    this.timeoutMs =
      typeof this.extraConfig.timeout === "number"
        ? (this.extraConfig.timeout as number) * 1000
        : DEFAULT_TIMEOUT_MS;
  }

  /**
   * Model resource path: in express mode model names hang off the publishers tree (bare name →
   * publishers/google/models/{model}; a projects/publishers prefix is kept as-is,
   * a slash splits into publisher/model); the default mode uses models/. Suffixes look like
   * ":generateContent" / ":streamGenerateContent?alt=sse".
   */
  private modelRequestPath(suffix: string): string {
    if (!this.vertexExpress) {
      return `/v1beta/models/${this.model}${suffix}`;
    }
    if (
      this.model.startsWith("projects/") ||
      this.model.startsWith("models/") ||
      this.model.startsWith("publishers/")
    ) {
      return `/v1beta1/${this.model}${suffix}`;
    }
    if (this.model.includes("/")) {
      const slash = this.model.indexOf("/");
      return `/v1beta1/publishers/${this.model.slice(0, slash)}/models/${this.model.slice(slash + 1)}${suffix}`;
    }
    return `/v1beta1/publishers/google/models/${this.model}${suffix}`;
  }

  /** OpenAI-style messages → (systemInstruction, contents) */
  convertMessagesToVertexaiFormat(
    messages: ChatCompletionMessage[],
  ): { systemInstruction: string | null; contents: { role: string; parts: GeminiPart[] }[] } {
    let systemInstruction: string | null = null;
    const contents: { role: string; parts: GeminiPart[] }[] = [];

    for (const msg of messages) {
      if (msg.role === MessageRole.SYSTEM) {
        systemInstruction = Array.isArray(msg.content)
          ? JSON.stringify(msg.content)
          : msg.content;
        continue;
      }

      const roleMapping: Record<string, string> = {
        user: "user",
        assistant: "model",
        tool: "function",
      };
      const vertexaiRole = roleMapping[msg.role] ?? "user";

      if (msg.role === MessageRole.TOOL) {
        // Tool response → functionResponse
        const contentText = Array.isArray(msg.content) ? JSON.stringify(msg.content) : msg.content;
        const responseData = typeof contentText === "string"
          ? safeJsonParse(contentText)
          : contentText;
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: msg.tool_call_id || "unknown",
                response: responseData as Record<string, unknown>,
              },
            },
          ],
        });
        continue;
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // assistant + tool calls
        const parts: GeminiPart[] = [];
        if (msg.content && !Array.isArray(msg.content) && msg.content !== "") {
          parts.push({ text: msg.content });
        }
        for (const toolCall of msg.tool_calls) {
          const func = (toolCall.function ?? {}) as { name?: string; arguments?: string };
          let args: Record<string, unknown> = {};
          if (func.arguments) {
            try {
              args = JSON.parse(func.arguments) as Record<string, unknown>;
            } catch {
              args = {};
            }
          }
          const part: GeminiPart = { functionCall: { name: func.name, args } };
          const thoughtSig = toolCall.thought_signature;
          if (typeof thoughtSig === "string" && thoughtSig) {
            part.thoughtSignature = thoughtSig;
          }
          parts.push(part);
        }
        contents.push({ role: vertexaiRole, parts });
        continue;
      }

      // Ordinary message
      const parts: GeminiPart[] = [];
      if (msg.content && !Array.isArray(msg.content)) {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Multimodal part list: text / image_url (data URL)
        for (const item of msg.content) {
          if (!item || typeof item !== "object") continue;
          if (item.type === "text" && typeof item.text === "string") {
            parts.push({ text: item.text });
          } else if (item.type === "image_url") {
            const imageUrl = (item.image_url as { url?: string } | undefined)?.url ?? "";
            const match = /^data:([^;]+);base64,(.*)$/s.exec(imageUrl);
            if (match) {
              parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
          }
        }
      }

      // Reference audio (question attachment) goes before the student's submitted audio
      for (const att of msg.reference_audio_attachments ?? []) {
        if (!att.data || !att.mime_type) continue;
        parts.push({
          inlineData: { mimeType: att.mime_type, data: att.data.toString("base64") },
        });
      }

      // Student / scored audio
      if (msg.audio && msg.audio_mime_type) {
        parts.push({
          inlineData: { mimeType: msg.audio_mime_type, data: msg.audio.toString("base64") },
        });
      }

      contents.push({ role: vertexaiRole, parts });
    }

    return { systemInstruction, contents };
  }

  /** Embed the system instruction into the first user message (streaming version: replaces the whole message with a single text part) */
  private embedSystemInstructionStream(
    systemInstruction: string | null,
    contents: { role: string; parts: GeminiPart[] }[],
  ): void {
    if (!systemInstruction || contents.length === 0) return;
    const index = contents.findIndex(
      (content) => content.role === "user" && content.parts.length > 0,
    );
    if (index === -1) return;
    const originalText = contents[index].parts[0]?.text ?? "";
    const newText = `[System Instructions]\n${systemInstruction}\n\n[User Message]\n${originalText}`;
    contents[index] = { role: "user", parts: [{ text: newText }] };
  }

  /** Embed the system instruction (non-streaming version: keeps non-text parts — audio etc.) */
  private embedSystemInstructionNonStream(
    systemInstruction: string | null,
    contents: { role: string; parts: GeminiPart[] }[],
  ): void {
    if (!systemInstruction || contents.length === 0) return;
    const index = contents.findIndex(
      (content) => content.role === "user" && content.parts.length > 0,
    );
    if (index === -1) return;
    const content = contents[index];
    let originalText = "";
    const nonTextParts: GeminiPart[] = [];
    for (const part of content.parts) {
      if (part.text) {
        originalText = part.text;
      } else {
        nonTextParts.push(part);
      }
    }
    const newParts: GeminiPart[] = [
      { text: `[System Instructions]\n${systemInstruction}\n\n[User Message]\n${originalText}` },
      ...nonTextParts,
    ];
    contents[index] = { role: "user", parts: newParts };
  }

  private buildRequestBody(options: {
    contents: { role: string; parts: GeminiPart[] }[];
    tools?: Record<string, unknown>[] | null;
    maxTokens?: number | null;
    topP?: number;
    thinkingLevel?: string;
    includeThoughts?: boolean;
  }): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {};
    if (options.maxTokens !== undefined && options.maxTokens !== null) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (options.topP !== undefined) {
      generationConfig.topP = options.topP;
    }
    if (options.thinkingLevel || options.includeThoughts !== undefined) {
      const thinkingConfig: Record<string, unknown> = {};
      if (options.thinkingLevel) thinkingConfig.thinkingLevel = options.thinkingLevel;
      if (options.includeThoughts !== undefined) {
        thinkingConfig.includeThoughts = options.includeThoughts;
      }
      generationConfig.thinkingConfig = thinkingConfig;
    }

    const body: Record<string, unknown> = {
      contents: options.contents,
      generationConfig,
      safetySettings: SAFETY_SETTINGS,
    };

    if (options.tools && options.tools.length > 0) {
      const declarations = options.tools
        .filter((tool) => tool.type === "function")
        .map((tool) => {
          const func = (tool.function ?? {}) as Record<string, unknown>;
          return {
            name: func.name,
            description: func.description ?? "",
            parameters: func.parameters ?? {},
          };
        });
      if (declarations.length > 0) {
        body.tools = [{ functionDeclarations: declarations }];
      }
    }

    return body;
  }

  /** Thinking config of the streaming path: only with supports_thinking and (explicitly enabled or the 3.1-pro default) */
  private buildThinkingConfig(thinkingOptions?: ThinkingOptions | null): {
    level?: string;
    includeThoughts?: boolean;
  } {
    if (!this.supports_thinking()) return {};
    const isPro = this.model === "gemini-3.1-pro-preview";
    if (thinkingOptions && thinkingOptions.type === "enabled") {
      return { level: isPro ? "HIGH" : undefined, includeThoughts: true };
    }
    if (isPro) {
      return { level: "HIGH", includeThoughts: true };
    }
    return {};
  }

  private async postJson(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.api_key ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return response;
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
      const { systemInstruction, contents } = this.convertMessagesToVertexaiFormat(
        params.messages,
      );
      this.embedSystemInstructionStream(systemInstruction, contents);

      // Streaming path: thinking_config carries thinkingLevel=HIGH only with supports_thinking and
      // (explicitly enabled or gemini-3.1-pro-preview)
      const thinking = this.buildThinkingConfig(params.thinking_options ?? null);

      const body = this.buildRequestBody({
        contents,
        tools: params.tools,
        maxTokens: params.max_tokens ?? null,
        thinkingLevel: thinking.level,
        includeThoughts: thinking.includeThoughts,
      });

      const response = await this.postJson(
        this.modelRequestPath(":streamGenerateContent?alt=sse"),
        body,
      );

      if (!response.ok || !response.body) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      let accumulatedText = "";
      let accumulatedReasoning = "";
      const accumulatedToolCalls: Record<string, unknown>[] = [];
      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;

      // SSE parsing (data: {json}\n lines)
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const rawChunk of response.body) {
        buffer += decoder.decode(rawChunk as Uint8Array, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");

          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let chunk: GeminiChunk;
          try {
            chunk = JSON.parse(payload) as GeminiChunk;
          } catch {
            continue;
          }

          const candidate = chunk.candidates?.[0];
          const parts = candidate?.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) {
              if (part.thought) {
                accumulatedReasoning += part.text;
                yield { reasoning_content: part.text };
              } else {
                accumulatedText += part.text;
                yield { content: part.text };
              }
            }
            if (part.functionCall?.name) {
              const toolCall: Record<string, unknown> = {
                id: `call_${accumulatedToolCalls.length}`,
                type: "function",
                function: {
                  name: part.functionCall.name,
                  arguments: part.functionCall.args
                    ? JSON.stringify(part.functionCall.args)
                    : "{}",
                },
              };
              if (part.thoughtSignature) {
                toolCall.thought_signature = part.thoughtSignature;
              }
              accumulatedToolCalls.push(toolCall);
            }
          }

          if (chunk.usageMetadata) {
            if (chunk.usageMetadata.promptTokenCount !== undefined) {
              promptTokens = chunk.usageMetadata.promptTokenCount;
            }
            if (chunk.usageMetadata.candidatesTokenCount !== undefined) {
              completionTokens = chunk.usageMetadata.candidatesTokenCount;
            }
            if (chunk.usageMetadata.totalTokenCount !== undefined) {
              totalTokens = chunk.usageMetadata.totalTokenCount;
            }
          }
        }
      }

      // Wrap-up: tool calls first, otherwise stop + usage
      if (accumulatedToolCalls.length > 0) {
        const usageDict =
          totalTokens > 0
            ? {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: totalTokens,
              }
            : null;
        yield {
          tool_calls: accumulatedToolCalls,
          finish_reason: "tool_calls",
          usage: usageDict,
        };
      } else if (totalTokens > 0) {
        yield {
          finish_reason: "stop",
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
        };
      }
    } catch (error) {
      console.error(`Error in Vertex AI streaming: ${error}`);
      yield { error: `Vertex AI error: ${String(error)}` };
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
      const { systemInstruction, contents } = this.convertMessagesToVertexaiFormat(
        params.messages,
      );
      this.embedSystemInstructionNonStream(systemInstruction, contents);

      // Non-streaming: thinking forced to HIGH only for gemini-3.1-pro-preview
      const thinking =
        this.supports_thinking() && this.model === "gemini-3.1-pro-preview"
          ? { level: "HIGH", includeThoughts: true }
          : {};

      const body = this.buildRequestBody({
        contents,
        tools: params.tools,
        maxTokens: params.max_tokens ?? null,
        // This provider consumes only top_p from the pass-through parameters and ignores the rest
        topP: params.extraParams?.top_p as number | undefined,
        thinkingLevel: thinking.level,
        includeThoughts: thinking.includeThoughts,
      });

      const response = await this.postJson(
        this.modelRequestPath(":generateContent"),
        body,
      );

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      const data = (await response.json()) as GeminiChunk;

      let content = "";
      let reasoningContent = "";
      const toolCalls: Record<string, unknown>[] = [];
      let finishReason = "stop";

      const candidate = data.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) {
          if (part.thought) {
            reasoningContent += part.text;
          } else {
            content += part.text;
          }
        }
        if (part.functionCall?.name) {
          toolCalls.push({
            id: `call_${toolCalls.length}`,
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: part.functionCall.args
                ? JSON.stringify(part.functionCall.args)
                : "{}",
            },
          });
        }
      }

      if (candidate?.finishReason) {
        // The upstream SDK parses the finishReason returned by REST into an enum and then stringifies it, like
        // "FinishReason.STOP" — which never equals the bare-name keys in the table below, so every finish reason
        // (MAX_TOKENS / SAFETY etc.) normalizes to "stop". That behavior is kept: consumers
        // (interaction flow / scoring) rely on the production output always being "stop"; the mapping table stays as-is
        const finishReasonMap: Record<string, string> = {
          STOP: "stop",
          MAX_TOKENS: "length",
          SAFETY: "content_filter",
          RECITATION: "content_filter",
          OTHER: "stop",
        };
        finishReason = finishReasonMap[`FinishReason.${candidate.finishReason}`] ?? "stop";
      }

      let usage: Record<string, number> | null = null;
      if (data.usageMetadata) {
        usage = {
          prompt_tokens: data.usageMetadata.promptTokenCount ?? 0,
          completion_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
          total_tokens: data.usageMetadata.totalTokenCount ?? 0,
        };
      }

      return {
        content,
        reasoning_content: reasoningContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : null,
        usage,
        finish_reason: finishReason,
      };
    } catch (error) {
      console.error(`Error in Vertex AI non-streaming: ${error}`);
      throw new Error(`Vertex AI error: ${String(error)}`);
    }
  }

  async close(): Promise<void> {
    // No persistent client to clean up
  }

  supports_tools(): boolean {
    return true;
  }

  supports_thinking(): boolean {
    // Gemini 2.5 / 3.x / models whose names contain thinking
    return (
      this.model.includes("2.5") ||
      this.model.toLowerCase().includes("gemini-3") ||
      this.model.toLowerCase().includes("thinking")
    );
  }
}

export { pyFloatRepr };
