// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chat session domain enums.
 */

/** Chat session status (PG enum type: chatsessionstatus) */
export const ChatSessionStatus = {
  Active: "active",
  Deleted: "deleted",
} as const;
export type ChatSessionStatus = (typeof ChatSessionStatus)[keyof typeof ChatSessionStatus];

/** Chat message author role (PG enum type: chatmessageauthorrole) */
export const ChatMessageAuthorRole = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
  TOOL: "tool",
} as const;
export type ChatMessageAuthorRole =
  (typeof ChatMessageAuthorRole)[keyof typeof ChatMessageAuthorRole];

/**
 * Chat session source / type (PG enum type: ai_chat_session_type)
 *
 * Used both as the API-side source filter value and as the persisted `ai_chat_session.type` value.
 * The member name keeps the historical "PERSONAL_LIVE" so call sites stay stable; the string values are the canonical
 * "personal" / "course" used in the DB column.
 */
export const ChatSessionSource = {
  COURSE: "course",
  PERSONAL_LIVE: "personal",
} as const;
export type ChatSessionSource = (typeof ChatSessionSource)[keyof typeof ChatSessionSource];
