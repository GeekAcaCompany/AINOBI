// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareAiChatMessage } from "../components/courseware-editor/CoursewareEditorAiPanel.tsx";
import {
  makeEditorAgentThreadStorageKey,
  readEditorAgentThreadFromStorage,
  type EditorAgentThreadPersisted,
} from "./editorAgentThreadStorage.ts";
import { safeLocalStorageSetItem } from "./safe-storage.ts";

const SESSIONS_STORAGE_PREFIX = "courseware-editor-agent-sessions:v1:";
const LAST_ACTIVE_CONVERSATION_PREFIX = "courseware-editor-agent-last-conversation:v1:";
const PLAN_LAST_ACTIVE_CONVERSATION_PREFIX = "courseware-editor-plan-last-conversation:v1:";
const PANEL_MODE_PREFIX = "courseware-editor-ai-panel-mode:v1:";

/** AI panel mode: `agent` (edits the courseware directly) or `plan` (courseware design planner). */
export type EditorAiPanelMode = "agent" | "plan";

export function readEditorAiPanelMode(coursewareId: string | null | undefined): EditorAiPanelMode {
  if (typeof window === "undefined" || !coursewareId) return "agent";
  try {
    const raw = localStorage.getItem(`${PANEL_MODE_PREFIX}${coursewareId}`)?.trim();
    return raw === "plan" ? "plan" : "agent";
  } catch {
    return "agent";
  }
}

export function writeEditorAiPanelMode(
  coursewareId: string | null | undefined,
  mode: EditorAiPanelMode,
): void {
  if (typeof window === "undefined" || !coursewareId) return;
  try {
    safeLocalStorageSetItem(`${PANEL_MODE_PREFIX}${coursewareId}`, mode);
  } catch {
    /* ignore */
  }
}

/** i18n key of the default conversation title; must not be written into session.title (otherwise the key literal shows after switching language). */
export const EDITOR_AGENT_DEFAULT_SESSION_TITLE_KEY =
  "coursewareEditor.aiPanel.newSession" as const;

export function isPlaceholderAgentSessionTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim() ?? "";
  return !trimmed || trimmed === EDITOR_AGENT_DEFAULT_SESSION_TITLE_KEY;
}

/** Strip the placeholder title when reading from the API / localStorage. */
export function normalizeAgentSessionTitle(title: string | null | undefined): string {
  return isPlaceholderAgentSessionTitle(title) ? "" : title!.trim();
}

export type EditorAgentSession = {
  id: string;
  title: string;
  conversationId?: string;
  claudeSessionId?: string;
  livePreviewSessionId?: string;
  chatMessages: CoursewareAiChatMessage[];
  messageCount?: number;
  createdAt: number;
  updatedAt: number;
};

export type EditorAgentSessionsState = {
  activeSessionId: string;
  sessions: EditorAgentSession[];
};

export function makeEditorAgentSessionsStorageKey(coursewareId: string): string {
  return `${SESSIONS_STORAGE_PREFIX}${coursewareId}`;
}

export function makeLastActiveAgentConversationStorageKey(
  coursewareId: string,
  kind: EditorAiPanelMode = "agent",
): string {
  const prefix =
    kind === "plan" ? PLAN_LAST_ACTIVE_CONVERSATION_PREFIX : LAST_ACTIVE_CONVERSATION_PREFIX;
  return `${prefix}${coursewareId}`;
}

/** The last selected server conversation id (per courseware + mode); only a UI preference, not a message source. */
export function readLastActiveAgentConversationId(
  coursewareId: string,
  kind: EditorAiPanelMode = "agent",
): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage
      .getItem(makeLastActiveAgentConversationStorageKey(coursewareId, kind))
      ?.trim();
    return raw || undefined;
  } catch {
    return undefined;
  }
}

export function writeLastActiveAgentConversationId(
  coursewareId: string,
  conversationId: string | null | undefined,
  kind: EditorAiPanelMode = "agent",
): void {
  if (typeof window === "undefined") return;
  try {
    const key = makeLastActiveAgentConversationStorageKey(coursewareId, kind);
    const trimmed = conversationId?.trim();
    if (trimmed) {
      safeLocalStorageSetItem(key, trimmed);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export function resolvePreferredActiveSessionId(
  sessions: readonly EditorAgentSession[],
  options?: { preferredSessionId?: string; preferredConversationId?: string },
): string | undefined {
  const preferredSessionId = options?.preferredSessionId?.trim();
  if (preferredSessionId) {
    const bySession = sessions.find((s) => s.id === preferredSessionId);
    if (bySession) return bySession.id;
  }
  const preferredConversationId = options?.preferredConversationId?.trim();
  if (preferredConversationId) {
    const byConversation = sessions.find((s) => s.conversationId === preferredConversationId);
    if (byConversation) return byConversation.id;
  }
  return sessions[0]?.id;
}

function makeSessionsStorageKey(coursewareId: string): string {
  return makeEditorAgentSessionsStorageKey(coursewareId);
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseChatMessages(raw: unknown): CoursewareAiChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: CoursewareAiChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : null;
    const role = rec.role === "user" || rec.role === "assistant" ? rec.role : null;
    if (!id || !role) continue;
    out.push({
      id,
      role,
      content: typeof rec.content === "string" ? rec.content : "",
    });
  }
  return out;
}

function parseSession(raw: unknown): EditorAgentSession | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : null;
  if (!id) return null;
  const title = normalizeAgentSessionTitle(
    typeof rec.title === "string" ? rec.title : undefined,
  );
  const createdAt = typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt) ? rec.createdAt : Date.now();
  const updatedAt = typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt) ? rec.updatedAt : createdAt;
  return {
    id,
    title,
    conversationId:
      typeof rec.conversationId === "string" && rec.conversationId.trim() ? rec.conversationId.trim() : undefined,
    claudeSessionId:
      typeof rec.claudeSessionId === "string" && rec.claudeSessionId.trim() ? rec.claudeSessionId.trim() : undefined,
    livePreviewSessionId:
      typeof rec.livePreviewSessionId === "string" && rec.livePreviewSessionId.trim()
        ? rec.livePreviewSessionId.trim()
        : undefined,
    chatMessages: parseChatMessages(rec.chatMessages),
    messageCount:
      typeof rec.messageCount === "number" && Number.isFinite(rec.messageCount)
        ? Math.max(0, Math.floor(rec.messageCount))
        : undefined,
    createdAt,
    updatedAt,
  };
}

function migrateFromLegacyThread(coursewareId: string): EditorAgentSessionsState | null {
  const legacy = readEditorAgentThreadFromStorage(coursewareId);
  const hasLegacy =
    legacy.conversationId ||
    legacy.claudeSessionId ||
    (legacy.chatMessages && legacy.chatMessages.length > 0);
  if (!hasLegacy) return null;
  const id = newSessionId();
  const now = Date.now();
  const session: EditorAgentSession = {
    id,
    title: "",
    conversationId: legacy.conversationId,
    claudeSessionId: legacy.claudeSessionId,
    livePreviewSessionId: legacy.livePreviewSessionId,
    chatMessages: legacy.chatMessages ?? [],
    createdAt: now,
    updatedAt: now,
  };
  return { activeSessionId: id, sessions: [session] };
}

export function createEmptyAgentSession(): EditorAgentSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    title: "",
    chatMessages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function readEditorAgentSessions(coursewareId: string): EditorAgentSessionsState {
  if (typeof window === "undefined") {
    const session = createEmptyAgentSession();
    return { activeSessionId: session.id, sessions: [session] };
  }
  try {
    const raw = localStorage.getItem(makeSessionsStorageKey(coursewareId));
    if (raw?.trim()) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        const activeSessionId =
          typeof rec.activeSessionId === "string" && rec.activeSessionId.trim()
            ? rec.activeSessionId.trim()
            : "";
        const sessions = Array.isArray(rec.sessions)
          ? rec.sessions.map(parseSession).filter((s): s is EditorAgentSession => s != null)
          : [];
        if (sessions.length > 0) {
          const active = sessions.some((s) => s.id === activeSessionId)
            ? activeSessionId
            : sessions[0]!.id;
          return dedupeEditorAgentSessions({ activeSessionId: active, sessions });
        }
      }
    }
  } catch {
    /* fall through */
  }
  const migrated = migrateFromLegacyThread(coursewareId);
  if (migrated) {
    writeEditorAgentSessions(coursewareId, migrated);
    return migrated;
  }
  const session = createEmptyAgentSession();
  return { activeSessionId: session.id, sessions: [session] };
}

export function writeEditorAgentSessions(coursewareId: string, state: EditorAgentSessionsState): void {
  if (typeof window === "undefined") return;
  try {
    const deduped = dedupeEditorAgentSessions(state);
    const active = deduped.sessions.find((s) => s.id === deduped.activeSessionId) ?? deduped.sessions[0];
    safeLocalStorageSetItem(makeSessionsStorageKey(coursewareId), JSON.stringify(deduped));
    if (active) {
      const threadPatch: EditorAgentThreadPersisted = {
        conversationId: active.conversationId,
        claudeSessionId: active.claudeSessionId,
        livePreviewSessionId: active.livePreviewSessionId,
        chatMessages: active.chatMessages,
      };
      safeLocalStorageSetItem(makeEditorAgentThreadStorageKey(coursewareId), JSON.stringify(threadPatch));
    }
  } catch {
    /* ignore */
  }
}

export function getActiveAgentSession(state: EditorAgentSessionsState): EditorAgentSession {
  return state.sessions.find((s) => s.id === state.activeSessionId) ?? state.sessions[0]!;
}

function sessionRichness(session: EditorAgentSession): number {
  return session.chatMessages.length;
}

/** When the same conversationId / session id repeats, keep the one with more messages. */
export function dedupeEditorAgentSessions(state: EditorAgentSessionsState): EditorAgentSessionsState {
  const sorted = [...state.sessions].sort((a, b) => {
    const richnessDiff = sessionRichness(b) - sessionRichness(a);
    if (richnessDiff !== 0) return richnessDiff;
    return b.updatedAt - a.updatedAt;
  });

  const sessions: EditorAgentSession[] = [];
  const seenIds = new Set<string>();
  const seenConversationIds = new Set<string>();

  for (const session of sorted) {
    if (seenIds.has(session.id)) continue;
    if (session.conversationId) {
      if (seenConversationIds.has(session.conversationId)) continue;
      seenConversationIds.add(session.conversationId);
    }
    seenIds.add(session.id);
    sessions.push(session);
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);

  const activeSessionId = sessions.some((s) => s.id === state.activeSessionId)
    ? state.activeSessionId
    : sessions[0]?.id ?? state.activeSessionId;

  return { activeSessionId, sessions };
}

function remoteConversationTimestampMs(value: string, fallback: number): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

export type RemoteConversationListItem = {
  conversationId: string;
  title: string | null;
  claudeSessionId: string | null;
  livePreviewSessionId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Merge the server conversation list with the local multi-conversation cache.
 * Before the first message of a new conversation returns its conversationId, avoids creating two duplicate records "local draft + empty remote conversation".
 */
export function mergeRemoteConversationSessions(
  localState: EditorAgentSessionsState,
  conversations: readonly RemoteConversationListItem[],
): EditorAgentSessionsState {
  if (conversations.length === 0) return dedupeEditorAgentSessions(localState);

  const byConversationId = new Map<string, EditorAgentSession>();
  const localPending: EditorAgentSession[] = [];

  for (const session of localState.sessions) {
    if (session.conversationId) {
      const prev = byConversationId.get(session.conversationId);
      if (!prev || sessionRichness(session) > sessionRichness(prev)) {
        byConversationId.set(session.conversationId, session);
      }
    } else {
      localPending.push(session);
    }
  }

  const matchedPendingIds = new Set<string>();
  const remoteSessions: EditorAgentSession[] = [];

  for (const item of conversations) {
    let existing = byConversationId.get(item.conversationId);

    if (!existing) {
      const pendingCandidates = localPending
        .filter((s) => !matchedPendingIds.has(s.id) && s.chatMessages.length > 0)
        .sort((a, b) => {
          if (a.id === localState.activeSessionId) return -1;
          if (b.id === localState.activeSessionId) return 1;
          return b.updatedAt - a.updatedAt;
        });
      const pending = pendingCandidates[0];
      if (pending) {
        matchedPendingIds.add(pending.id);
        existing = {
          ...pending,
          conversationId: item.conversationId,
          claudeSessionId: item.claudeSessionId ?? pending.claudeSessionId,
          livePreviewSessionId: item.livePreviewSessionId ?? pending.livePreviewSessionId,
        };
        byConversationId.set(item.conversationId, existing);
      }
    }

    const base = byConversationId.get(item.conversationId);
    const remoteTitle = normalizeAgentSessionTitle(item.title ?? undefined);
    const localTitle = normalizeAgentSessionTitle(base?.title);
    remoteSessions.push({
      id: base?.id ?? item.conversationId,
      title: remoteTitle || localTitle,
      conversationId: item.conversationId,
      claudeSessionId: item.claudeSessionId ?? base?.claudeSessionId,
      livePreviewSessionId: item.livePreviewSessionId ?? base?.livePreviewSessionId,
      chatMessages: base?.chatMessages ?? [],
      messageCount: item.messageCount,
      createdAt: remoteConversationTimestampMs(item.createdAt, base?.createdAt ?? Date.now()),
      updatedAt: remoteConversationTimestampMs(item.updatedAt, base?.updatedAt ?? Date.now()),
    });
  }

  const remainingPending = localPending.filter(
    (s) =>
      !matchedPendingIds.has(s.id) &&
      (s.chatMessages.length > 0 || s.id === localState.activeSessionId),
  );

  const merged: EditorAgentSessionsState = {
    activeSessionId: localState.activeSessionId,
    sessions: [...remainingPending, ...remoteSessions],
  };

  const activeInLocal = getActiveAgentSession(localState);
  const activeSessionId =
    merged.sessions.some((s) => s.id === localState.activeSessionId)
      ? localState.activeSessionId
      : (activeInLocal.conversationId
          ? merged.sessions.find((s) => s.conversationId === activeInLocal.conversationId)?.id
          : undefined) ??
        resolvePreferredActiveSessionId(merged.sessions, {
          preferredSessionId: localState.activeSessionId,
        }) ??
        remoteSessions[0]?.id ??
        merged.sessions[0]?.id ??
        localState.activeSessionId;

  return dedupeEditorAgentSessions({ activeSessionId, sessions: merged.sessions });
}

export function truncateSessionTitleFromPrompt(text: string, maxLen = 28): string {
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!line) return "";
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

export function patchEditorAgentSessionThreadIds(
  coursewareId: string,
  sessionId: string,
  patch: {
    conversationId?: string;
    claudeSessionId?: string;
    livePreviewSessionId?: string;
  },
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(makeSessionsStorageKey(coursewareId));
    if (!raw?.trim()) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return;
    const rec = parsed as Record<string, unknown>;
    const sessions = Array.isArray(rec.sessions)
      ? rec.sessions.map(parseSession).filter((s): s is EditorAgentSession => s != null)
      : [];
    if (sessions.length === 0) return;
    const now = Date.now();
    const nextSessions = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        ...(patch.conversationId ? { conversationId: patch.conversationId } : {}),
        ...(patch.claudeSessionId ? { claudeSessionId: patch.claudeSessionId } : {}),
        ...(patch.livePreviewSessionId ? { livePreviewSessionId: patch.livePreviewSessionId } : {}),
        updatedAt: now,
      };
    });
    const activeSessionId =
      typeof rec.activeSessionId === "string" && rec.activeSessionId.trim()
        ? rec.activeSessionId.trim()
        : nextSessions[0]!.id;
    writeEditorAgentSessions(coursewareId, { activeSessionId, sessions: nextSessions });
  } catch {
    /* ignore */
  }
}

export function clearEditorAgentSessions(coursewareId: string): EditorAgentSessionsState {
  const session = createEmptyAgentSession();
  const state: EditorAgentSessionsState = { activeSessionId: session.id, sessions: [session] };
  writeEditorAgentSessions(coursewareId, state);
  return state;
}

/** Reset only the messages and thread id of the given conversation, keeping the others. */
export function resetEditorAgentSession(
  state: EditorAgentSessionsState,
  sessionId: string,
): EditorAgentSessionsState {
  const now = Date.now();
  const sessions = state.sessions.map((s) =>
    s.id === sessionId
      ? {
          ...s,
          title: "",
          conversationId: undefined,
          claudeSessionId: undefined,
          livePreviewSessionId: undefined,
          chatMessages: [],
          messageCount: 0,
          updatedAt: now,
        }
      : s,
  );
  return dedupeEditorAgentSessions({ activeSessionId: state.activeSessionId, sessions });
}
