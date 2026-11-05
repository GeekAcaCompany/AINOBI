// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareAiChatMessage } from "../components/courseware-editor/CoursewareEditorAiPanel.tsx";
import type { CoursewareAiAssistantBlock } from "../api/courseware_agent.ts";
import { safeLocalStorageSetItem } from "./safe-storage.ts";

/** Bound to the courseware id, restoring the agent's multi-turn context after a refresh (conversationId / Claude sessionId / editor live preview session). */
const EDITOR_AGENT_THREAD_STORAGE_PREFIX = "courseware-editor-agent-thread:v1:";

export const makeEditorAgentThreadStorageKey = (coursewareId: string): string =>
  `${EDITOR_AGENT_THREAD_STORAGE_PREFIX}${coursewareId}`;

const MAX_STORED_AI_MESSAGES = 400;
const MAX_STORED_AI_MESSAGE_CHARS = 32000;

function parseStoredAssistantBlocks(raw: unknown): CoursewareAiAssistantBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CoursewareAiAssistantBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === "prose" && typeof rec.text === "string") {
      out.push({ type: "prose", text: rec.text });
      continue;
    }
    if (
      rec.type === "tool" &&
      typeof rec.id === "string" &&
      typeof rec.toolName === "string" &&
      typeof rec.title === "string"
    ) {
      out.push({
        type: "tool",
        id: rec.id,
        toolName: rec.toolName,
        title: rec.title,
        command: typeof rec.command === "string" ? rec.command : undefined,
        output: typeof rec.output === "string" ? rec.output : undefined,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function parseStoredChatMessages(raw: unknown): CoursewareAiChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: CoursewareAiChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : null;
    const role = rec.role === "user" || rec.role === "assistant" ? rec.role : null;
    if (!id || !role) continue;
    let content = typeof rec.content === "string" ? rec.content : "";
    if (content.length > MAX_STORED_AI_MESSAGE_CHARS) {
      content = `${content.slice(0, MAX_STORED_AI_MESSAGE_CHARS)}…`;
    }
    out.push({
      id,
      role,
      content,
      blocks: parseStoredAssistantBlocks((item as Record<string, unknown>).blocks),
    });
    if (out.length >= MAX_STORED_AI_MESSAGES) break;
  }
  return out;
}

export type EditorAgentThreadPersisted = {
  claudeSessionId?: string;
  conversationId?: string;
  livePreviewSessionId?: string;
  /** The agent chat Redis stream in progress; should be cleared when it ends */
  chatStreamSessionId?: string;
  /** SSE cursor, used to tail `GET /chat/stream` after a refresh */
  chatStreamLastEntryId?: string;
  chatMessages?: CoursewareAiChatMessage[];
};

/** `null` means deleting the matching field from localStorage */
export type EditorAgentThreadPatch = Omit<
  Partial<EditorAgentThreadPersisted>,
  "chatStreamSessionId" | "chatStreamLastEntryId"
> & {
  chatStreamSessionId?: string | null;
  chatStreamLastEntryId?: string | null;
};

export function readEditorAgentThreadFromStorage(coursewareId: string): EditorAgentThreadPersisted {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(makeEditorAgentThreadStorageKey(coursewareId));
    if (!raw?.trim()) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const rec = o as Record<string, unknown>;
    const claudeSessionId =
      typeof rec.claudeSessionId === "string" && rec.claudeSessionId.trim()
        ? rec.claudeSessionId.trim()
        : undefined;
    const conversationId =
      typeof rec.conversationId === "string" && rec.conversationId.trim()
        ? rec.conversationId.trim()
        : undefined;
    const livePreviewSessionId =
      typeof rec.livePreviewSessionId === "string" && rec.livePreviewSessionId.trim()
        ? rec.livePreviewSessionId.trim()
        : undefined;
    const chatStreamSessionId =
      typeof rec.chatStreamSessionId === "string" && rec.chatStreamSessionId.trim()
        ? rec.chatStreamSessionId.trim()
        : undefined;
    const chatStreamLastEntryId =
      typeof rec.chatStreamLastEntryId === "string" && rec.chatStreamLastEntryId.trim()
        ? rec.chatStreamLastEntryId.trim()
        : undefined;
    const chatMessages = parseStoredChatMessages(rec.chatMessages);
    return {
      claudeSessionId,
      conversationId,
      livePreviewSessionId,
      chatStreamSessionId,
      chatStreamLastEntryId,
      chatMessages,
    };
  } catch {
    return {};
  }
}

export function writeEditorAgentThreadToStorage(
  coursewareId: string,
  patch: EditorAgentThreadPatch,
): void {
  if (typeof window === "undefined") return;
  try {
    const prev = readEditorAgentThreadFromStorage(coursewareId);
    const next: EditorAgentThreadPersisted = { ...prev };
    if ("claudeSessionId" in patch) {
      const v = patch.claudeSessionId?.trim();
      if (v) next.claudeSessionId = v;
      else delete next.claudeSessionId;
    }
    if ("conversationId" in patch) {
      const v = patch.conversationId?.trim();
      if (v) next.conversationId = v;
      else delete next.conversationId;
    }
    if ("livePreviewSessionId" in patch) {
      const v = patch.livePreviewSessionId?.trim();
      if (v) next.livePreviewSessionId = v;
      else delete next.livePreviewSessionId;
    }
    if ("chatStreamSessionId" in patch) {
      if (patch.chatStreamSessionId === null) {
        delete next.chatStreamSessionId;
      } else {
        const v = patch.chatStreamSessionId?.trim();
        if (v) next.chatStreamSessionId = v;
        else delete next.chatStreamSessionId;
      }
    }
    if ("chatStreamLastEntryId" in patch) {
      if (patch.chatStreamLastEntryId === null) {
        delete next.chatStreamLastEntryId;
      } else {
        const v = patch.chatStreamLastEntryId?.trim();
        if (v) next.chatStreamLastEntryId = v;
        else delete next.chatStreamLastEntryId;
      }
    }
    if ("chatMessages" in patch && Array.isArray(patch.chatMessages)) {
      next.chatMessages = patch.chatMessages;
    }
    const cleaned: EditorAgentThreadPersisted = {};
    if (next.claudeSessionId?.trim()) cleaned.claudeSessionId = next.claudeSessionId.trim();
    if (next.conversationId?.trim()) cleaned.conversationId = next.conversationId.trim();
    if (next.livePreviewSessionId?.trim()) cleaned.livePreviewSessionId = next.livePreviewSessionId.trim();
    if (next.chatStreamSessionId?.trim()) cleaned.chatStreamSessionId = next.chatStreamSessionId.trim();
    if (next.chatStreamLastEntryId?.trim()) {
      cleaned.chatStreamLastEntryId = next.chatStreamLastEntryId.trim();
    }
    if (Array.isArray(next.chatMessages)) {
      cleaned.chatMessages = next.chatMessages
        .slice(-MAX_STORED_AI_MESSAGES)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content:
            m.content.length > MAX_STORED_AI_MESSAGE_CHARS
              ? `${m.content.slice(0, MAX_STORED_AI_MESSAGE_CHARS)}…`
              : m.content,
          ...(m.blocks && m.blocks.length > 0 ? { blocks: m.blocks } : {}),
        }));
    }
    const key = makeEditorAgentThreadStorageKey(coursewareId);
    if (Object.keys(cleaned).length === 0) {
      localStorage.removeItem(key);
    } else {
      safeLocalStorageSetItem(key, JSON.stringify(cleaned));
    }
  } catch {
    /* ignore */
  }
}
