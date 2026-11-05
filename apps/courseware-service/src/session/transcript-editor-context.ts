// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";

import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

/** Same as `buildCoursewareAgentEditorContext` in apps/student-frontend */
export const COURSEWARE_EDITOR_CONTEXT_HEADER = "[Courseware Editor Context]";

/** Same as `buildCoursewarePlanEditorContext` in apps/student-frontend (Plan mode courseware context) */
export const COURSEWARE_PLAN_CONTEXT_HEADER = "[Courseware Plan Context]";

/**
 * Prefix of the user line written into the SDK transcript when an interrupted turn resumes; `expose_in_user_chat` is false, so the sidebar doesn't show it.
 * @see CoursewareSessionTranscriptLine.exposeInUserChat
 */
export const CHAT_TURN_RESUME_TRANSCRIPT_HEADER = "[AINOBI Chat Turn Resume]";

/** SDK `query` prompt when resuming an interrupted turn (host restart / stream drop). */
export const CHAT_STREAM_RECOVERY_USER_PROMPT = `${CHAT_TURN_RESUME_TRANSCRIPT_HEADER}
Your previous assistant turn was interrupted before it finished (connection loss or server restart). Continue the same user request: complete any steps, tool calls, or courseware edits that were still in progress. Do not tell the user the task is finished until you have verified every part of their last request is actually done.`;

export type PendingTranscriptPromptSplit = {
  /** User input (without editor context) */
  userPrompt: string;
  /** Editor context block (may include selected elements, @ resources, etc.) */
  editorContext: string;
  /** The full prompt sent to claude-agent-sdk this turn (user + editor + optional live preview) */
  queryPrompt: string;
};

export function buildAgentQueryPrompt(parts: {
  userPrompt: string;
  editorContext?: string;
  livePreviewAppend?: string;
}): { userPrompt: string; editorContext: string; queryPrompt: string } {
  const userPrompt = parts.userPrompt.trim();
  const editorContext = parts.editorContext?.trim() ?? "";
  const segments = [userPrompt];
  if (editorContext) {
    segments.push(editorContext);
  }
  if (parts.livePreviewAppend?.trim()) {
    segments.push(parts.livePreviewAppend.trim());
  }
  const queryPrompt = segments.filter(Boolean).join("\n\n");
  return { userPrompt, editorContext, queryPrompt };
}

export function isCoursewareEditorContextText(text: string): boolean {
  return text.trimStart().startsWith(COURSEWARE_EDITOR_CONTEXT_HEADER);
}

export function isCoursewarePlanContextText(text: string): boolean {
  return text.trimStart().startsWith(COURSEWARE_PLAN_CONTEXT_HEADER);
}

export function isChatTurnResumeContextText(text: string): boolean {
  return text.trimStart().startsWith(CHAT_TURN_RESUME_TRANSCRIPT_HEADER);
}

/** User text that shouldn't show in the sidebar but may stay in the transcript for SDK resume */
export function isHiddenTranscriptUserContextText(text: string): boolean {
  const t = text.trimStart();
  if (isCoursewareEditorContextText(t)) {
    return true;
  }
  if (isCoursewarePlanContextText(t)) {
    return true;
  }
  if (isChatTurnResumeContextText(t)) {
    return true;
  }
  return t.startsWith("[AINOBI Live Preview Session]");
}

export function joinUserMessageText(entry: SessionStoreEntry): string | null {
  const rec = entry as Record<string, unknown>;
  if (rec.type !== "user") {
    return null;
  }
  const inner = rec.message as { content?: unknown } | undefined;
  const content = inner?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      parts.push(b.text.trim());
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Written to the transcript for SDK resume; not shown in the sidebar */
export function buildEditorContextTranscriptEntry(editorContext: string): SessionStoreEntry {
  const text = editorContext.trim();
  return {
    type: "user",
    uuid: randomUUID(),
    parent_tool_use_id: null,
    shouldQuery: false,
    message: {
      type: "user",
      role: "user",
      content: [{ type: "text", text }],
    },
    timestamp: new Date().toISOString(),
  } as SessionStoreEntry;
}

export function buildUserOnlyTranscriptEntry(
  source: SessionStoreEntry,
  userPrompt: string,
): SessionStoreEntry {
  const rec = { ...(source as Record<string, unknown>) };
  const inner = rec.message as Record<string, unknown> | undefined;
  if (inner && typeof inner === "object") {
    rec.message = {
      ...inner,
      content: [{ type: "text", text: userPrompt.trim() }],
    };
  }
  return rec as SessionStoreEntry;
}

export function trySplitMirroredUserEntry(
  entry: SessionStoreEntry,
  pending: PendingTranscriptPromptSplit | undefined,
): SessionStoreEntry[] | null {
  if (!pending?.editorContext) {
    return null;
  }
  const mirrored = joinUserMessageText(entry);
  if (!mirrored || mirrored !== pending.queryPrompt.trim()) {
    return null;
  }
  return [
    buildEditorContextTranscriptEntry(pending.editorContext),
    buildUserOnlyTranscriptEntry(entry, pending.userPrompt),
  ];
}
