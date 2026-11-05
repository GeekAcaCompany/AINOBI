// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Base Agent schemas.
 *
 * Contract notes:
 * - ResponseMessageChunk content is a str | Dict union (a dict passes through as-is when JSON serialized)
 * - ChatCompletionMessage's binary audio is used only by the vertexai multimodal scoring path
 *   (the openai provider does not consume the audio field)
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Enums (string values)
// ---------------------------------------------------------------------------

export const AgentState = {
  READY: "ready",
  RUNNING: "running",
  ABORTING: "aborting",
  STOPPED: "stopped",
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];

export const MessageRole = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
  TOOL: "tool",
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

export const ResponseMessageType = {
  TEXT: "text",
  THINKING: "thinking",
  FINAL_ANSWER: "final_answer",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  TOKEN_USAGE: "token_usage",
  BEGIN: "begin",
  CONTENT_VERIFICATION: "content_verification",
  CONTENT_VERIFICATION_START: "content_verification_start",
  CONTENT_VERIFICATION_SEGMENTS: "content_verification_segments",
  CONTENT_VERIFICATION_COMPLETE: "content_verification_complete",
  SEGMENT_START: "segment_start",
  SEGMENT_END: "segment_end",
  SEGMENT_ISSUES_FOUND: "segment_issues_found",
  SEGMENT_REWRITTEN: "segment_rewritten",
  SEGMENT_VERIFIED: "segment_verified",
  END: "end",
  ERROR: "error",
  SYSTEM: "system",
  RE_EXTRACT_UNUSE_REFERENCES: "re-extract-unuse-references",
  RE_EXTRACT_UNUSE_REFERENCES_START: "re-extract-unuse-references-start",
  RE_EXTRACT_UNUSE_REFERENCES_END: "re-extract-unuse-references-end",
} as const;
export type ResponseMessageType =
  (typeof ResponseMessageType)[keyof typeof ResponseMessageType];

// ---------------------------------------------------------------------------
// Config and result structures
// ---------------------------------------------------------------------------

/** Tool-call loop detection config (per-field defaults, see defaultToolLoopDetectionConfig) */
export interface ToolLoopDetectionConfig {
  enabled: boolean;
  window_size: number;
  repeat_threshold: number;
}

export function defaultToolLoopDetectionConfig(): ToolLoopDetectionConfig {
  return { enabled: true, window_size: 5, repeat_threshold: 2 };
}

/** A parsed tool call */
export interface ParsedToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  reference_index?: number | null;
  parsing_error?: string | null;
}

/** Tool-call loop detection result */
export interface ToolCallLoopDetection {
  tool_name: string;
  repeated_count: number;
  parameters: Record<string, unknown>;
}

/** Token usage */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Session info (content of the begin/end frames) */
export interface SessionInfo {
  session_id: string;
  question?: string | null;
  can_export?: boolean | null;
}

/** Error content (content of the error frame) */
export interface ErrorContent {
  error: string;
}

/** Multimodal audio attachment (question reference audio / student submitted audio) */
export interface AudioAttachment {
  data: Buffer;
  mime_type: string;
}

/**
 * Chat completion message.
 * content is a string or a list of multimodal parts ({type:"text"|"image_url", ...}).
 */
export interface ChatCompletionMessage {
  role: MessageRole;
  content: string | Record<string, unknown>[];
  tool_calls?: Record<string, unknown>[] | null;
  tool_call_id?: string | null;
  audio?: Buffer | null;
  audio_mime_type?: string | null;
  reference_audio_attachments?: AudioAttachment[] | null;
}

export function chatMessage(
  role: MessageRole,
  content: string | Record<string, unknown>[],
  extra: Partial<ChatCompletionMessage> = {},
): ChatCompletionMessage {
  return { role, content, ...extra };
}

/** Tool call result (return value of the on_tool_call callback) */
export interface ToolCallResult {
  content: string;
  result: unknown;
  reference_index?: number | null;
  inject_message?: ChatCompletionMessage | null;
  token_usage?: TokenUsage | null;
  tool_message?: ChatCompletionMessage | null;
}

/** Base Agent run options (run arguments) */
export interface BaseAgentRunOptions {
  session_id: string;
  question: string;
  history: ChatCompletionMessage[];
  before_context?: string | null;
  after_context?: string | null;
  is_continue_request: boolean;
  on_tool_call?: ((
    toolCall: ParsedToolCall,
    toolCalls: ParsedToolCall[],
    historyToolCalls: ParsedToolCall[],
  ) => Promise<ToolCallResult>) | null;
  on_iteration?: ((
    messages: ChatCompletionMessage[],
    toolCalls: ParsedToolCall[],
    historyToolCalls: ParsedToolCall[],
  ) => Promise<boolean | unknown>) | null;
  on_next?: ((
    messages: ChatCompletionMessage[],
    toolCalls: ParsedToolCall[],
    historyToolCalls: ParsedToolCall[],
    finalAssistantMessage: string | null,
    finalAssistantReasoningMessage: string | null,
  ) => Promise<boolean | unknown>) | null;
  on_end?: ((
    messages: ChatCompletionMessage[],
    toolCalls: ParsedToolCall[],
    historyToolCalls: ParsedToolCall[],
    reportContent: string,
    reportReasoningContent: string,
  ) => Promise<{ after_content?: string } | Record<string, unknown> | void>) | null;
}

/** Base Agent constructor options (per-field defaults) */
export interface BaseAgentOptions {
  model: string;
  api_key?: string | null;
  provider?: string | null;
  provider_type?: string | null;
  proxy?: string | null;
  max_tokens?: number | null;
  max_completion_tokens?: number | null;
  max_iterations?: number | null;
  max_concurrent_tools?: number | null;
  tool_loop_detection?: ToolLoopDetectionConfig | null;
  ping_interval?: number | null;
  debug_enabled?: boolean | null;
  org_id?: string | null;
  user_id?: string | null;
  use_organization_asset?: boolean | null;
  service_code?: string | null;
  billing_session_id?: string | null;
  billing_remark?: string | null;
  billing_usage_type?: string | null;
  billing_strict?: boolean | null;
}

/** Stream options (stream_options) */
export interface StreamOptions {
  include_usage: boolean;
}

/** Thinking options */
export interface ThinkingOptions {
  type: "enabled" | "disabled";
}

/** Completion usage (content of the token_usage frame) */
export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Response message chunk (what BaseAgent.run yields) */
export interface ResponseMessageChunk {
  id: string;
  role: MessageRole;
  type: ResponseMessageType;
  event?: string | null;
  content: string | Record<string, unknown>;
  reasoning_content?: string | null;
  tool_name?: string | null;
  tool_call_id?: string | null;
  finish_reason?: string | null;
  finished?: boolean | null;
  timestamp: number;
}

/** Non-streaming completion result (returned by provider.create_completion) */
export interface CompletionResult {
  content: string;
  tool_calls?: Record<string, unknown>[] | null;
  usage?: Record<string, number> | null;
  finish_reason?: string | null;
  reasoning_content?: string | null;
}

/** uuid4 + epoch-milliseconds float timestamp (datetime.now().timestamp() semantics) */
export function newChunkMeta(): { id: string; timestamp: number } {
  return { id: randomUUID(), timestamp: Date.now() / 1000 };
}
