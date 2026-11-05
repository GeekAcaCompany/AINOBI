// SPDX-License-Identifier: AGPL-3.0-only
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import { isHiddenTranscriptUserContextText } from "./transcript-editor-context.ts";

/** Whether the sidebar/API may show this transcript line as a message "sent by the user" (SDK resume still uses the full entry) */
export type TranscriptLineForChatUi = {
  entry: SessionStoreEntry;
  exposeInUserChat: boolean;
};

const SKILL_BASE_DIR_RE = /^Base directory for this skill:\s/m;
const SKILL_ARGUMENTS_TRAILER_RE = /\n\nARGUMENTS:\s*\S/m;

const NON_USER_CHAT_ENTRY_TYPES = new Set([
  "system",
  "custom-title",
  "summary",
  "tag",
  "mode",
  "mirror_error",
  "tool_use_summary",
]);

function asRecord(entry: SessionStoreEntry): Record<string, unknown> {
  return entry as Record<string, unknown>;
}

function normalizeSdkMessage(entry: SessionStoreEntry): Record<string, unknown> | null {
  const rec = asRecord(entry);
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

function joinUserTextBlocks(message: Record<string, unknown>): string {
  const inner = message.message as { content?: unknown } | undefined;
  const content = inner?.content;
  if (!Array.isArray(content)) {
    return "";
  }
  const textParts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      textParts.push(b.text.trim());
    }
  }
  return textParts.join("\n\n");
}

/**
 * User context claude-agent-sdk writes after the Skill tool runs (not end-user input).
 * Uses the body form + envelope fields the SDK defines, not just a string prefix.
 */
export function isSdkSkillContextUserText(text: string, envelope?: Record<string, unknown>): boolean {
  const body = text.trim();
  if (!body) {
    return false;
  }
  if (SKILL_BASE_DIR_RE.test(body)) {
    return true;
  }
  if (SKILL_ARGUMENTS_TRAILER_RE.test(body) && body.includes("# ")) {
    return true;
  }
  if (envelope?.shouldQuery === false && typeof envelope.parent_tool_use_id === "string") {
    const parentId = envelope.parent_tool_use_id.trim();
    if (parentId && SKILL_ARGUMENTS_TRAILER_RE.test(body)) {
      return true;
    }
  }
  return false;
}

/**
 * Decided at mirror append time: whether this line may appear in the frontend's user chat bubbles.
 * The `entry` JSON stays as the SDK wrote it; this only feeds the side column `expose_in_user_chat`.
 */
export function computeExposeInUserChat(entry: SessionStoreEntry): boolean {
  const rec = asRecord(entry);

  if (rec.isSynthetic === true) {
    return false;
  }

  const topType = typeof rec.type === "string" ? rec.type : "";
  if (NON_USER_CHAT_ENTRY_TYPES.has(topType)) {
    return false;
  }

  const sdk = normalizeSdkMessage(entry);
  if (!sdk) {
    return false;
  }

  if (sdk.type !== "user") {
    return true;
  }

  const userText = joinUserTextBlocks(sdk);
  if (!userText) {
    return true;
  }

  if (isHiddenTranscriptUserContextText(userText)) {
    return false;
  }

  return !isSdkSkillContextUserText(userText, rec);
}

export function toTranscriptLineForChatUi(entry: SessionStoreEntry): TranscriptLineForChatUi {
  return {
    entry,
    exposeInUserChat: computeExposeInUserChat(entry),
  };
}

export function resolveTranscriptLinesForChatUi(
  lines: readonly (SessionStoreEntry | TranscriptLineForChatUi)[],
): TranscriptLineForChatUi[] {
  return lines.map((line) => {
    if (typeof line === "object" && line !== null && "entry" in line && "exposeInUserChat" in line) {
      return line as TranscriptLineForChatUi;
    }
    return toTranscriptLineForChatUi(line as SessionStoreEntry);
  });
}
