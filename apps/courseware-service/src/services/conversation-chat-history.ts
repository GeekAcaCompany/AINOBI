// SPDX-License-Identifier: AGPL-3.0-only
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import { dataSource } from "../db/db.ts";
import { CoursewareConversation, CoursewareSessionTranscriptLine } from "../models/courseware-conversation.ts";
import { resolveTranscriptLinesForChatUi, type TranscriptLineForChatUi } from "../session/transcript-entry-ui.ts";
import { getCoursewareEntityById } from "./courseware-service.ts";
import { findLatestConversationForCourseware } from "./conversation-service.ts";
import {
  applyChatUiEventsToBlocks,
  chatUiBlocksToPlainText,
  createChatUiStreamState,
  mapSdkMessageToChatUiEvents,
  type ChatUiAssistantBlock,
} from "./chat-ui-events.ts";
import { mergeStreamingPreviewIntoMessages, readChatStreamingPreview } from "./conversation-message-merge.ts";

export type { ChatStreamingPreview } from "./conversation-message-merge.ts";
export { CHAT_STREAMING_PREVIEW_METADATA_KEY, mergeStreamingPreviewIntoMessages, readChatStreamingPreview } from "./conversation-message-merge.ts";

export type ConversationChatMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: ChatUiAssistantBlock[];
};

export type ConversationTokenUsageDto = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
};

export type ConversationChatHistoryResult = {
  coursewareId: string;
  conversationId: string | null;
  title: string | null;
  claudeSessionId: string | null;
  livePreviewSessionId: string | null;
  tokenUsage: ConversationTokenUsageDto | null;
  createdAt: string | null;
  updatedAt: string | null;
  messages: ConversationChatMessageDto[];
};

export type ConversationListItemDto = {
  conversationId: string;
  title: string | null;
  kind: string;
  claudeSessionId: string | null;
  livePreviewSessionId: string | null;
  messageCount: number;
  tokenUsage: ConversationTokenUsageDto;
  createdAt: string;
  updatedAt: string;
};

export type ConversationListResult = {
  coursewareId: string;
  conversations: ConversationListItemDto[];
};

function readTokenCount(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return 0;
}

export function conversationTokenUsageDto(
  conversation: Pick<
    CoursewareConversation,
    "inputTokens" | "outputTokens" | "totalTokens" | "cacheTokens"
  >,
): ConversationTokenUsageDto {
  return {
    inputTokens: readTokenCount(conversation.inputTokens),
    outputTokens: readTokenCount(conversation.outputTokens),
    totalTokens: readTokenCount(conversation.totalTokens),
    cacheTokens: readTokenCount(conversation.cacheTokens),
  };
}

function normalizeSdkMessage(entry: SessionStoreEntry): Record<string, unknown> | null {
  const rec = entry as Record<string, unknown>;
  const type = rec.type;
  if (type === "assistant" || type === "user" || type === "result") {
    return rec;
  }
  const wrapped = rec.message;
  if (wrapped && typeof wrapped === "object") {
    const inner = wrapped as Record<string, unknown>;
    if (inner.type === "assistant" || inner.type === "user" || inner.type === "result") {
      return inner;
    }
  }
  return null;
}

function extractUserTextFromSdkMessage(message: Record<string, unknown>): string | null {
  if (message.isSynthetic === true) {
    return null;
  }
  if (message.type !== "user") {
    return null;
  }
  const inner = message.message as { content?: unknown } | undefined;
  const content = inner?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const textParts: string[] = [];
  let hasToolResultOnly = true;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      textParts.push(b.text.trim());
      hasToolResultOnly = false;
    } else if (b.type !== "tool_result") {
      hasToolResultOnly = false;
    }
  }
  if (hasToolResultOnly || textParts.length === 0) {
    return null;
  }
  const display = textParts.join("\n\n").trim();
  return display.length > 0 ? display : null;
}

function assistantTurnHasBody(blocks: readonly ChatUiAssistantBlock[], content: string): boolean {
  return blocks.length > 0 || content.trim().length > 0;
}

/**
 * Rebuild SessionStore transcript lines into the editor sidebar message list.
 * Shows only transcript user lines with `expose_in_user_chat = true` (editor context etc. were split out and hidden at mirror time).
 */
export function rebuildChatMessagesFromTranscript(
  lines: readonly (SessionStoreEntry | TranscriptLineForChatUi)[],
): ConversationChatMessageDto[] {
  const resolved = resolveTranscriptLinesForChatUi(lines);
  const messages: ConversationChatMessageDto[] = [];
  let assistantBlocks: ChatUiAssistantBlock[] = [];
  let streamState = createChatUiStreamState();
  let assistantIndex = 0;

  const flushAssistant = (): void => {
    const content = chatUiBlocksToPlainText(assistantBlocks);
    if (!assistantTurnHasBody(assistantBlocks, content)) {
      assistantBlocks = [];
      streamState = createChatUiStreamState();
      return;
    }
    messages.push({
      id: `a_hist_${assistantIndex}`,
      role: "assistant",
      content,
      ...(assistantBlocks.length > 0 ? { blocks: [...assistantBlocks] } : {}),
    });
    assistantIndex += 1;
    assistantBlocks = [];
    streamState = createChatUiStreamState();
  };

  resolved.forEach(({ entry, exposeInUserChat }, entryIndex) => {
    const sdk = normalizeSdkMessage(entry);
    if (!sdk) return;

    if (sdk.type === "system") {
      return;
    }

    const userText = extractUserTextFromSdkMessage(sdk);
    if (userText && exposeInUserChat) {
      flushAssistant();
      const entryUuid = typeof entry.uuid === "string" ? entry.uuid.trim() : "";
      messages.push({
        id: entryUuid || `u_hist_${entryIndex}`,
        role: "user",
        content: userText,
      });
      return;
    }

    const events = mapSdkMessageToChatUiEvents(streamState, sdk);
    if (events.length > 0) {
      assistantBlocks = applyChatUiEventsToBlocks(assistantBlocks, events);
    }
  });

  flushAssistant();
  return messages;
}

async function loadTranscriptLinesForConversation(
  conversation: CoursewareConversation,
): Promise<TranscriptLineForChatUi[]> {
  const sessionId = conversation.claudeSessionId?.trim();
  if (!sessionId) {
    return [];
  }

  const repo = dataSource.getRepository(CoursewareSessionTranscriptLine);
  const projectKey = conversation.sessionProjectKey?.trim();

  const rows = await repo.find({
    where: projectKey
      ? { projectKey, sessionId, subpath: "" }
      : { sessionId, subpath: "" },
    order: { id: "ASC" },
    select: ["entry", "exposeInUserChat"],
  });

  return rows.map((r) => ({
    entry: r.entry as SessionStoreEntry,
    exposeInUserChat: r.exposeInUserChat,
  }));
}

async function countExposedUserChatLines(conversation: CoursewareConversation): Promise<number> {
  const sessionId = conversation.claudeSessionId?.trim();
  if (!sessionId) return 0;

  const repo = dataSource.getRepository(CoursewareSessionTranscriptLine);
  const projectKey = conversation.sessionProjectKey?.trim();
  const qb = repo
    .createQueryBuilder("t")
    .where("t.session_id = :sessionId", { sessionId })
    .andWhere("t.subpath = ''")
    .andWhere("t.expose_in_user_chat = true");
  if (projectKey) {
    qb.andWhere("t.project_key = :projectKey", { projectKey });
  }
  return qb.getCount();
}

/**
 * Lightweight conversation list: doesn't rebuild transcripts; messageCount counts only the user message lines visible in the sidebar.
 */
export async function listConversationsForCourseware(
  idOrKey: string,
  options?: { limit?: number; kind?: "agent" | "plan" },
): Promise<ConversationListResult> {
  const cw = await getCoursewareEntityById(idOrKey.trim());
  if (!cw) {
    throw new Error(`Unknown courseware: ${idOrKey.trim()}`);
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const convRepo = dataSource.getRepository(CoursewareConversation);
  const conversations = await convRepo.find({
    where: { coursewareId: cw.id, ...(options?.kind ? { kind: options.kind } : {}) },
    order: { updatedAt: "DESC" },
    take: limit,
  });

  const items: ConversationListItemDto[] = [];
  for (const conversation of conversations) {
    const messageCount = await countExposedUserChatLines(conversation);
    items.push({
      conversationId: conversation.id,
      title: conversation.title?.trim() || null,
      kind: conversation.kind?.trim() || "agent",
      claudeSessionId: conversation.claudeSessionId?.trim() || null,
      livePreviewSessionId: conversation.livePreviewSessionId?.trim() || null,
      messageCount,
      tokenUsage: conversationTokenUsageDto(conversation),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    });
  }

  return { coursewareId: cw.id, conversations: items };
}

/**
 * Read the sidebar message history of a courseware's latest conversation (from the DB transcript).
 */
export async function getConversationChatHistoryForCourseware(
  idOrKey: string,
  options?: { conversationId?: string; kind?: "agent" | "plan" },
): Promise<ConversationChatHistoryResult> {
  const cw = await getCoursewareEntityById(idOrKey.trim());
  if (!cw) {
    throw new Error(`Unknown courseware: ${idOrKey.trim()}`);
  }

  const convRepo = dataSource.getRepository(CoursewareConversation);
  let conversation: CoursewareConversation | null = null;

  const requestedCid = options?.conversationId?.trim();
  if (requestedCid) {
    conversation = await convRepo.findOne({ where: { id: requestedCid, coursewareId: cw.id } });
    if (!conversation) {
      throw new Error(`Unknown conversationId: ${requestedCid}`);
    }
  } else {
    conversation = await findLatestConversationForCourseware(convRepo, cw.id, options?.kind);
  }

  if (!conversation) {
    return {
      coursewareId: cw.id,
      conversationId: null,
      title: null,
      claudeSessionId: null,
      livePreviewSessionId: null,
      tokenUsage: null,
      createdAt: null,
      updatedAt: null,
      messages: [],
    };
  }

  const lines = await loadTranscriptLinesForConversation(conversation);
  const messages = mergeStreamingPreviewIntoMessages(
    rebuildChatMessagesFromTranscript(lines),
    readChatStreamingPreview(conversation.metadata),
  );

  return {
    coursewareId: cw.id,
    conversationId: conversation.id,
    title: conversation.title?.trim() || null,
    claudeSessionId: conversation.claudeSessionId?.trim() || null,
    livePreviewSessionId: conversation.livePreviewSessionId?.trim() || null,
    tokenUsage: conversationTokenUsageDto(conversation),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages,
  };
}
