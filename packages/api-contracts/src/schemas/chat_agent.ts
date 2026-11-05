// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chat Agent domain schemas.
 *
 * The request/response models the routes actually consume (pure agent-internal models such as ChatAgentConfig / DocumentInfo
 * are at the end of the file; the payloads of the 6 routes come first).
 */

import { z } from "zod";
import { pyBool, pyUuid } from "./helpers.ts";

/** Streaming chat request (SSE) */
export const ChatStreamRequestSchema = z.object({
  query: z.string().min(1).max(5000),
  /** Leading context used only for this turn (e.g. the current question summary); goes into the prompt, not the history */
  before_context: z.string().nullable().optional(),
  /** Trailing context used only for this turn; goes into the prompt, not the history */
  after_context: z.string().nullable().optional(),
  max_documents_to_read: z.coerce.number().int().min(1).max(10).default(3),
  max_conversation_turns: z.coerce.number().int().min(1).max(50).default(20),
});
export type ChatStreamRequest = z.infer<typeof ChatStreamRequestSchema>;

/** Create chat session request */
export const ChatSessionCreateRequestSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  system_prompt: z.string().nullable().optional(),
});
export type ChatSessionCreateRequest = z.infer<typeof ChatSessionCreateRequestSchema>;

/** Chat session info */
export interface ChatSessionInfo {
  session_id: string;
  user_id: string;
  course_id: string;
  chapter_id: string;
  section_id: string;
  title: string | null;
  system_prompt: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Create chat session response */
export interface ChatSessionCreateResponse {
  success: boolean;
  session: ChatSessionInfo;
  message: string | null;
}

/** Delete chat session response */
export interface ChatSessionRemoveResponse {
  success: boolean;
  message: string | null;
}

/**
 * Session list query request (GET query model).
 * course_id/chapter_id/section_id are optional UUIDs in string form (parsed with UUID() in the service layer).
 */
export const ChatSessionListRequestSchema = z.object({
  course_id: z.string().nullable().optional(),
  chapter_id: z.string().nullable().optional(),
  section_id: z.string().nullable().optional(),
  include_deleted: pyBool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ChatSessionListRequest = z.infer<typeof ChatSessionListRequestSchema>;

/** Session list response */
export interface ChatSessionListResponse {
  success: boolean;
  sessions: ChatSessionInfo[];
  total: number;
  limit: number;
  offset: number;
}

/** Chat message info */
export interface ChatMessageInfo {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: Record<string, unknown>[] | null;
  tool_call_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Message list query request (messages in a session, GET) */
export const ChatMessageListRequestSchema = z.object({
  include_deleted: pyBool().default(false),
  limit: z.coerce.number().int().min(1).max(1000).nullable().optional(),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ChatMessageListRequest = z.infer<typeof ChatMessageListRequestSchema>;

/** Message list response */
export interface ChatMessageListResponse {
  success: boolean;
  messages: ChatMessageInfo[];
  total: number;
  limit: number | null;
  offset: number;
}

/** Create message request */
export const ChatMessageCreateRequestSchema = z.object({
  role: z.string(),
  content: z.string().min(1).max(50000),
  tool_calls: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
  vector: z.array(z.number()).nullable().optional(),
});
export type ChatMessageCreateRequest = z.infer<typeof ChatMessageCreateRequestSchema>;

/** Create message response */
export interface ChatMessageCreateResponse {
  success: boolean;
  message: ChatMessageInfo;
  message_text: string | null;
}

/** uuid parameter (chat routes' path/query id parsing shares lax UUID semantics) */
export const chatUuid = pyUuid;

// ---------------------------------------------------------------------------
// ChatAgent internal structures (agent section)
// ---------------------------------------------------------------------------

/** Document type enum */
export const DocumentType = {
  PDF: "pdf",
  DOCX: "docx",
  TXT: "txt",
  MD: "md",
  HTML: "html",
  OTHER: "other",
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

/** Document info (agent tool payload) */
export interface DocumentInfo {
  file_id: string;
  file_name: string;
  file_title: string;
  file_summary: string;
  file_type: DocumentType;
  file_size: number;
  file_url: string | null;
  org_id: string;
  created_at: string | null;
  keywords: string | null;
}

/** ChatAgent config */
export interface ChatAgentConfig {
  org_id: string;
  course_id: string;
  chapter_id: string;
  section_id: string;
  user_id: string;
  system_prompt: string;
  language: string;
  max_documents_to_read: number;
  max_conversation_turns: number;
  max_search_results: number;
  similarity_threshold: number;
  use_reader_model: boolean;
  use_organization_asset: boolean;
  service_code: string;
  course_section?: {
    section_id?: string;
    section_name?: string | null;
    section_description?: string | null;
    section_type?: string | null;
    section_status?: string | null;
    org_id?: string;
    teacher_id?: string | null;
    [key: string]: unknown;
  } | null;
}

/** ChatAgent streaming response (yielded by run_with_documents) */
export interface ChatAgentResponse {
  success: boolean;
  type: string;
  message: string;
  documents_used?: DocumentInfo[];
  tool_calls?: ChatAgentToolCall[];
  references?: string[];
  error?: string | null;
}

/** ChatAgent tool call record */
export interface ChatAgentToolCall {
  tool_name: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  error?: string | null;
}
