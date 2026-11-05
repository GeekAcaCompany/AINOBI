// SPDX-License-Identifier: AGPL-3.0-only
import { chatUiBlocksToPlainText, type ChatUiAssistantBlock } from "./chat-ui-events.ts";

export const CHAT_STREAMING_PREVIEW_METADATA_KEY = "chatStreamingPreview";

export type ChatStreamingPreview = {
  active: boolean;
  updatedAt: string;
  content: string;
  blocks: ChatUiAssistantBlock[];
};

export type ChatSidebarMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: ChatUiAssistantBlock[];
};

export function readChatStreamingPreview(
  metadata: Record<string, unknown> | null | undefined,
): ChatStreamingPreview | null {
  const raw = metadata?.[CHAT_STREAMING_PREVIEW_METADATA_KEY];
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (rec.active !== true) {
    return null;
  }
  const blocks = Array.isArray(rec.blocks) ? (rec.blocks as ChatUiAssistantBlock[]) : [];
  const content = typeof rec.content === "string" ? rec.content : chatUiBlocksToPlainText(blocks);
  const updatedAt = typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString();
  return { active: true, updatedAt, content, blocks };
}

/** While a streaming turn is in progress: overwrite the lagging assistant at the end of the transcript with the accumulated SSE result, appending `a_streaming`. */
export function mergeStreamingPreviewIntoMessages(
  messages: ChatSidebarMessage[],
  preview: ChatStreamingPreview | null,
): ChatSidebarMessage[] {
  if (!preview?.active) {
    return messages;
  }
  const content = preview.content.trim() || chatUiBlocksToPlainText(preview.blocks);
  if (!content && preview.blocks.length === 0) {
    return messages;
  }

  const next = [...messages];
  if (next.length > 0 && next[next.length - 1]?.role === "assistant") {
    next.pop();
  }

  next.push({
    id: "a_streaming",
    role: "assistant",
    content,
    ...(preview.blocks.length > 0 ? { blocks: [...preview.blocks] } : {}),
  });
  return next;
}
