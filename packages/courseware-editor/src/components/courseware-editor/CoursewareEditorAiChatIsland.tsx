// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import coursewareAgentApi, {
  coursewareAgentApiCoursewareIdOrUndefined,
  isCoursewareApiConfigured,
  type CoursewareAgentConversationListItem,
  type CoursewareAgentConversationHistoryMessage,
} from "@ainobi/courseware-player/api/courseware_agent";
import {
  writeEditorAgentThreadToStorage,
  type EditorAgentThreadPatch,
} from "@ainobi/courseware-player/lib/editorAgentThreadStorage";
import {
  createEmptyAgentSession,
  EDITOR_AGENT_DEFAULT_SESSION_TITLE_KEY,
  getActiveAgentSession,
  isPlaceholderAgentSessionTitle,
  mergeRemoteConversationSessions,
  normalizeAgentSessionTitle,
  readEditorAiPanelMode,
  readLastActiveAgentConversationId,
  resetEditorAgentSession,
  resolvePreferredActiveSessionId,
  truncateSessionTitleFromPrompt,
  writeEditorAiPanelMode,
  writeLastActiveAgentConversationId,
  type EditorAgentSession,
  type EditorAgentSessionsState,
  type EditorAiPanelMode,
} from "@ainobi/courseware-player/lib/editorAgentSessions";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import type { TranslationKey } from "@ainobi/courseware-player/lib/i18n/index";
import {
  CoursewareEditorAiPanel,
  type CoursewareAgentSessionView,
  type CoursewareAiChatMessage,
  type CoursewareEditorAiPanelProps,
} from "@ainobi/courseware-player/components/courseware-editor/CoursewareEditorAiPanel";

export type AgentSessionContext = {
  activeSessionId: string;
  conversationId?: string;
  claudeSessionId?: string;
  pendingNewConversation: boolean;
};

type IslandProps = Omit<
  CoursewareEditorAiPanelProps,
  | "chatMessages"
  | "onChatMessagesChange"
  | "onClearHistory"
  | "agentSessions"
  | "sessionTitle"
  | "onAgentSessionSelect"
  | "onAgentSessionCreate"
> & {
  coursewareId: string | null;
  /** Clear the current conversation's history on the server; without a configured API only the local current conversation is cleared */
  onClearAgentServerHistory?: (conversationId: string) => void | Promise<void>;
  onAgentSessionContextChange?: (ctx: AgentSessionContext) => void;
};

function toPanelMessages(msgs: CoursewareAgentConversationHistoryMessage[]): CoursewareAiChatMessage[] {
  const seen = new Set<string>();
  const out: CoursewareAiChatMessage[] = [];
  for (const m of msgs) {
    const id = typeof m.id === "string" && m.id.trim() ? m.id.trim() : `hist_${out.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
      ...(m.blocks && m.blocks.length > 0 ? { blocks: m.blocks } : {}),
    });
  }
  return out;
}

function sessionDisplayTitle(
  session: EditorAgentSession,
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string,
): string {
  if (isPlaceholderAgentSessionTitle(session.title)) {
    return t(EDITOR_AGENT_DEFAULT_SESSION_TITLE_KEY);
  }
  return session.title.trim();
}

function timestampMs(value: string | null | undefined, fallback = Date.now()): number {
  if (!value) return fallback;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function sessionFromRemoteConversation(item: CoursewareAgentConversationListItem): EditorAgentSession {
  const createdAt = timestampMs(item.createdAt);
  return {
    id: item.conversationId,
    title: normalizeAgentSessionTitle(item.title),
    conversationId: item.conversationId,
    claudeSessionId: item.claudeSessionId ?? undefined,
    livePreviewSessionId: item.livePreviewSessionId ?? undefined,
    chatMessages: [],
    messageCount: item.messageCount,
    createdAt,
    updatedAt: timestampMs(item.updatedAt, createdAt),
  };
}

function stateFromRemoteConversations(
  conversations: readonly CoursewareAgentConversationListItem[],
  preferredConversationId?: string,
): EditorAgentSessionsState {
  const sessions = conversations.map(sessionFromRemoteConversation);
  if (sessions.length === 0) {
    const session = createEmptyAgentSession();
    return { activeSessionId: session.id, sessions: [session] };
  }
  const activeSessionId =
    resolvePreferredActiveSessionId(sessions, { preferredConversationId }) ?? sessions[0]!.id;
  return { activeSessionId, sessions };
}

/**
 * Isolates the assistant conversation state in this component, so hanging it on the courseware editor root doesn't re-render the whole page on every SSE / input.
 */
export function CoursewareEditorAiChatIsland({
  coursewareId,
  onClearAgentServerHistory,
  onAgentSessionContextChange,
  onAssistantStreamEnd,
  ...panelRest
}: IslandProps) {
  const { t } = useI18nNew();

  const [sessionsState, setSessionsState] = useState<EditorAgentSessionsState>(() => {
    const session = createEmptyAgentSession();
    return { activeSessionId: session.id, sessions: [session] };
  });
  const [chatMessages, setChatMessages] = useState<CoursewareAiChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [pendingNewConversation, setPendingNewConversation] = useState(false);
  const [panelMode, setPanelMode] = useState<EditorAiPanelMode>(() =>
    readEditorAiPanelMode(coursewareId),
  );
  /** Plan → Agent handoff: after switching to Agent and creating a conversation, the draft + token are written, and the panel sends once automatically. */
  const [draftHandoff, setDraftHandoff] = useState<{ token: number; draft: string } | null>(null);

  const messagesRef = useRef(chatMessages);
  messagesRef.current = chatMessages;
  const sessionsStateRef = useRef(sessionsState);
  sessionsStateRef.current = sessionsState;
  const pendingNewConversationRef = useRef(pendingNewConversation);
  pendingNewConversationRef.current = pendingNewConversation;
  const panelModeRef = useRef(panelMode);
  panelModeRef.current = panelMode;
  /** Record the draft to hand over: after switching to Agent mode and finishing loading, load creates a new conversation and dispatches it to the panel. */
  const pendingHandoffDraftRef = useRef<string | null>(null);
  const handoffTokenRef = useRef(0);

  const threadEpochRef = useRef(0);
  const coursewareIdRef = useRef(coursewareId);
  coursewareIdRef.current = coursewareId;
  const refreshRemoteSessionsRef = useRef<(() => void) | null>(null);

  const notifySessionContext = useCallback(
    (state: EditorAgentSessionsState, pending: boolean) => {
      const active = getActiveAgentSession(state);
      onAgentSessionContextChange?.({
        activeSessionId: active.id,
        conversationId: pending ? undefined : active.conversationId,
        claudeSessionId: pending ? undefined : active.claudeSessionId,
        pendingNewConversation: pending,
      });
    },
    [onAgentSessionContextChange],
  );

  const persistActiveSelection = useCallback(
    (cwId: string, state: EditorAgentSessionsState, pending: boolean) => {
      const kind = panelModeRef.current;
      if (pending) {
        writeLastActiveAgentConversationId(cwId, null, kind);
        return;
      }
      const active = getActiveAgentSession(state);
      if (active.conversationId) {
        writeLastActiveAgentConversationId(cwId, active.conversationId, kind);
      }
    },
    [],
  );

  // When the courseware switches, restore the panel mode per courseware and clear any unfinished handoff.
  useEffect(() => {
    const mode = readEditorAiPanelMode(coursewareId);
    panelModeRef.current = mode;
    setPanelMode(mode);
    pendingHandoffDraftRef.current = null;
    setDraftHandoff(null);
  }, [coursewareId]);

  useEffect(() => {
    const epoch = (threadEpochRef.current += 1);
    const cwId = coursewareId;
    let cancelled = false;

    const applyLoaded = (
      state: EditorAgentSessionsState,
      msgs: CoursewareAiChatMessage[],
      pending: boolean,
    ): void => {
      if (cancelled || threadEpochRef.current !== epoch || coursewareIdRef.current !== cwId) return;
      sessionsStateRef.current = state;
      messagesRef.current = msgs;
      pendingNewConversationRef.current = pending;
      setSessionsState(state);
      setChatMessages(msgs.length > 0 ? msgs : []);
      setPendingNewConversation(pending);
      setIsLoadingHistory(false);
      notifySessionContext(state, pending);
      if (cwId) persistActiveSelection(cwId, state, pending);
    };

    const kind = panelMode;

    const dispatchPendingHandoff = (): void => {
      const draft = pendingHandoffDraftRef.current;
      pendingHandoffDraftRef.current = null;
      if (!draft) return;
      handoffTokenRef.current += 1;
      setDraftHandoff({ token: handoffTokenRef.current, draft });
    };

    const load = async (): Promise<void> => {
      if (!cwId) {
        const session = createEmptyAgentSession();
        applyLoaded({ activeSessionId: session.id, sessions: [session] }, [], false);
        return;
      }

      // Plan → Agent handoff: after switching to Agent, no history conversation is selected; a new empty conversation with the draft to send is created directly.
      if (kind === "agent" && pendingHandoffDraftRef.current) {
        const session = createEmptyAgentSession();
        applyLoaded({ activeSessionId: session.id, sessions: [session] }, [], true);
        dispatchPendingHandoff();
        return;
      }

      setIsLoadingHistory(true);
      setPendingNewConversation(false);
      const apiCoursewareId = coursewareAgentApiCoursewareIdOrUndefined(cwId);

      if (!isCoursewareApiConfigured() || !apiCoursewareId) {
        const session = createEmptyAgentSession();
        applyLoaded({ activeSessionId: session.id, sessions: [session] }, [], true);
        return;
      }

      try {
        const remoteList = await coursewareAgentApi.fetchConversationsList({
          coursewareId: apiCoursewareId,
          kind,
        });
        if (cancelled || threadEpochRef.current !== epoch) return;
        const remoteState = stateFromRemoteConversations(
          remoteList.ok ? remoteList.conversations ?? [] : [],
          readLastActiveAgentConversationId(cwId, kind),
        );
        const active = getActiveAgentSession(remoteState);
        if (!active.conversationId) {
          applyLoaded(remoteState, [], true);
          return;
        }
        const remote = await coursewareAgentApi.fetchConversationHistory({
          coursewareId: apiCoursewareId,
          conversationId: active.conversationId,
        });
        if (cancelled || threadEpochRef.current !== epoch) return;
        if (!remote.ok) {
          applyLoaded(remoteState, [], false);
          return;
        }
        const remoteMsgs = remote.messages?.length ? toPanelMessages(remote.messages) : [];
        // Plan conversations don't write the Agent thread cache, so they don't pollute Agent follow-ups.
        if (kind === "agent") {
          const threadPatch: EditorAgentThreadPatch = {};
          if (remote.conversationId) threadPatch.conversationId = remote.conversationId;
          if (remote.claudeSessionId) threadPatch.claudeSessionId = remote.claudeSessionId;
          if (remote.livePreviewSessionId) threadPatch.livePreviewSessionId = remote.livePreviewSessionId;
          if (Object.keys(threadPatch).length > 0) {
            writeEditorAgentThreadToStorage(cwId, threadPatch);
          }
        }
        const nextState: EditorAgentSessionsState = {
          activeSessionId: remoteState.activeSessionId,
          sessions: remoteState.sessions.map((s) =>
            s.id === active.id
              ? {
                  ...s,
                  ...(remote.title ? { title: normalizeAgentSessionTitle(remote.title) } : {}),
                  ...(remote.claudeSessionId ? { claudeSessionId: remote.claudeSessionId } : {}),
                  ...(remote.livePreviewSessionId ? { livePreviewSessionId: remote.livePreviewSessionId } : {}),
                  chatMessages: remoteMsgs,
                  messageCount: remoteMsgs.length,
                  ...(remote.createdAt ? { createdAt: timestampMs(remote.createdAt, s.createdAt) } : {}),
                  ...(remote.updatedAt ? { updatedAt: timestampMs(remote.updatedAt, s.updatedAt) } : {}),
                }
              : s,
          ),
        };
        applyLoaded(nextState, remoteMsgs, false);
      } catch {
        if (cancelled || threadEpochRef.current !== epoch) return;
        const session = createEmptyAgentSession();
        applyLoaded({ activeSessionId: session.id, sessions: [session] }, [], true);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [coursewareId, panelMode, notifySessionContext, persistActiveSelection]);

  const onChatMessagesChange = useCallback(
    (update: SetStateAction<CoursewareAiChatMessage[]>) => {
      const cwId = coursewareIdRef.current;
      const epoch = threadEpochRef.current;
      setChatMessages((prev) => {
        if (threadEpochRef.current !== epoch || coursewareIdRef.current !== cwId) return prev;
        const next = typeof update === "function" ? update(prev) : update;
        if (cwId) {
          const state = sessionsStateRef.current;
          const active = getActiveAgentSession(state);
          let nextTitle = normalizeAgentSessionTitle(active.title);
          if (!nextTitle) {
            const latestUser = [...next].reverse().find((m) => m.role === "user");
            if (latestUser?.content.trim()) {
              nextTitle = truncateSessionTitleFromPrompt(latestUser.content);
            }
          }
          const nextSessions = state.sessions.map((s) =>
            s.id === active.id
              ? {
                  ...s,
                  title: nextTitle,
                  chatMessages: next,
                  updatedAt: Date.now(),
                }
              : s,
          );
          const nextState = { activeSessionId: state.activeSessionId, sessions: nextSessions };
          sessionsStateRef.current = nextState;
        messagesRef.current = next;
          setSessionsState(nextState);
        }
        return next;
      });
    },
    [],
  );

  const onAgentSessionSelect = useCallback(
    (sessionId: string) => {
      const cwId = coursewareIdRef.current;
      if (!cwId || sessionId === sessionsStateRef.current.activeSessionId) return;
      threadEpochRef.current += 1;
      const epoch = threadEpochRef.current;

      const prevState = sessionsStateRef.current;
      const target = prevState.sessions.find((s) => s.id === sessionId);
      if (!target) return;

      const nextState: EditorAgentSessionsState = {
        activeSessionId: sessionId,
        sessions: prevState.sessions,
      };
      sessionsStateRef.current = nextState;
      setSessionsState(nextState);
      setPendingNewConversation(!target.conversationId);
      setChatMessages([]);
      setIsLoadingHistory(false);
      notifySessionContext(nextState, !target.conversationId);
      persistActiveSelection(cwId, nextState, !target.conversationId);

      const apiCoursewareId = coursewareAgentApiCoursewareIdOrUndefined(cwId);
      if (isCoursewareApiConfigured() && apiCoursewareId && target.conversationId) {
        setIsLoadingHistory(true);
        void coursewareAgentApi
          .fetchConversationHistory({
            coursewareId: apiCoursewareId,
            conversationId: target.conversationId,
          })
          .then((remote) => {
            if (threadEpochRef.current !== epoch || coursewareIdRef.current !== cwId) return;
            if (!remote.ok) {
              setIsLoadingHistory(false);
              return;
            }
            const remoteMsgs = remote.messages?.length ? toPanelMessages(remote.messages) : [];
            const syncedState: EditorAgentSessionsState = {
              activeSessionId: nextState.activeSessionId,
              sessions: nextState.sessions.map((s) =>
                s.id === target.id
                  ? {
                      ...s,
                      ...(remote.title
                  ? { title: normalizeAgentSessionTitle(remote.title) }
                  : {}),
                      ...(remote.conversationId ? { conversationId: remote.conversationId } : {}),
                      ...(remote.claudeSessionId ? { claudeSessionId: remote.claudeSessionId } : {}),
                      ...(remote.livePreviewSessionId
                        ? { livePreviewSessionId: remote.livePreviewSessionId }
                        : {}),
                      ...(remote.createdAt ? { createdAt: timestampMs(remote.createdAt, s.createdAt) } : {}),
                      ...(remote.updatedAt ? { updatedAt: timestampMs(remote.updatedAt, s.updatedAt) } : {}),
                      messageCount: remoteMsgs.length,
                    }
                  : s,
              ),
            };
            sessionsStateRef.current = syncedState;
            setSessionsState(syncedState);
            setChatMessages(remoteMsgs);
            messagesRef.current = remoteMsgs;
            notifySessionContext(syncedState, false);
            setIsLoadingHistory(false);
          })
          .catch(() => {
            if (threadEpochRef.current === epoch) setIsLoadingHistory(false);
          });
      }
    },
    [notifySessionContext, persistActiveSelection],
  );

  const onAgentSessionCreate = useCallback(() => {
    const cwId = coursewareIdRef.current;
    if (!cwId) return;
    threadEpochRef.current += 1;

    const prevState = sessionsStateRef.current;
    const newSession = createEmptyAgentSession();
    const nextState: EditorAgentSessionsState = {
      activeSessionId: newSession.id,
      sessions: [newSession, ...prevState.sessions.filter((s) => s.conversationId)],
    };
    sessionsStateRef.current = nextState;
    setSessionsState(nextState);
    setChatMessages([]);
    messagesRef.current = [];
    setPendingNewConversation(true);
    setIsLoadingHistory(false);
    notifySessionContext(nextState, true);
    persistActiveSelection(cwId, nextState, true);
  }, [notifySessionContext, persistActiveSelection]);

  const onClearHistory = useCallback(async (): Promise<void> => {
    threadEpochRef.current += 1;

    const cwId = coursewareIdRef.current;
    const prevState = sessionsStateRef.current;
    const active = getActiveAgentSession(prevState);
    const conversationId = active.conversationId?.trim();

    if (conversationId && onClearAgentServerHistory) {
      await onClearAgentServerHistory(conversationId);
    }

    if (cwId) {
      const nextState = resetEditorAgentSession(prevState, active.id);
      sessionsStateRef.current = nextState;
      setSessionsState(nextState);
      notifySessionContext(nextState, true);
      persistActiveSelection(cwId, nextState, true);
    } else {
      setPendingNewConversation(true);
      pendingNewConversationRef.current = true;
      notifySessionContext(prevState, true);
    }

    setChatMessages([]);
    messagesRef.current = [];
    setPendingNewConversation(true);
    pendingNewConversationRef.current = true;
  }, [notifySessionContext, onClearAgentServerHistory, persistActiveSelection]);

  const refreshRemoteSessions = useCallback(() => {
    const cwId = coursewareIdRef.current;
    const apiCoursewareId = coursewareAgentApiCoursewareIdOrUndefined(cwId);
    if (!cwId || !apiCoursewareId || !isCoursewareApiConfigured()) return;
    void coursewareAgentApi
      .fetchConversationsList({ coursewareId: apiCoursewareId, kind: panelModeRef.current })
      .then((remoteList) => {
        if (!remoteList.ok) return;
        const conversations = remoteList.conversations ?? [];
        if (conversations.length === 0 && getActiveAgentSession(sessionsStateRef.current).conversationId) {
          const nextState = stateFromRemoteConversations([]);
          sessionsStateRef.current = nextState;
          setSessionsState(nextState);
          setChatMessages([]);
          messagesRef.current = [];
          setPendingNewConversation(true);
          pendingNewConversationRef.current = true;
          notifySessionContext(nextState, true);
          return;
        }
        if (conversations.length === 0) return;
        const merged = mergeRemoteConversationSessions(sessionsStateRef.current, conversations);
        const mergedActive = getActiveAgentSession(merged);
        const nextPending = !mergedActive.conversationId && pendingNewConversationRef.current;
        sessionsStateRef.current = merged;
        setSessionsState(merged);
        setChatMessages(mergedActive.chatMessages);
        messagesRef.current = mergedActive.chatMessages;
        setPendingNewConversation(nextPending);
        pendingNewConversationRef.current = nextPending;
        notifySessionContext(merged, nextPending);
        persistActiveSelection(cwId, merged, nextPending);
      })
      .catch(() => {
        /* ignore */
      });
  }, [notifySessionContext, persistActiveSelection]);

  refreshRemoteSessionsRef.current = refreshRemoteSessions;

  const handlePanelModeChange = useCallback(
    (mode: EditorAiPanelMode) => {
      if (mode === panelModeRef.current) return;
      const cwId = coursewareIdRef.current;
      writeEditorAiPanelMode(cwId, mode);
      panelModeRef.current = mode;
      setPanelMode(mode);
    },
    [],
  );

  const handleStartMakingWithDraft = useCallback(
    (draft: string) => {
      const trimmed = draft.trim();
      if (!trimmed) return;
      const cwId = coursewareIdRef.current;
      // Record the draft to hand over; after switching to Agent mode, load creates a new conversation and dispatches it (Plan and Agent conversations are independent).
      pendingHandoffDraftRef.current = trimmed;
      if (panelModeRef.current === "agent") {
        // Already in Agent mode: trigger one load manually (new empty conversation + dispatch the draft).
        onAgentSessionCreate();
        handoffTokenRef.current += 1;
        setDraftHandoff({ token: handoffTokenRef.current, draft: trimmed });
        pendingHandoffDraftRef.current = null;
        return;
      }
      writeEditorAiPanelMode(cwId, "agent");
      panelModeRef.current = "agent";
      setPanelMode("agent");
    },
    [onAgentSessionCreate],
  );

  const handleDraftHandoffConsumed = useCallback(() => {
    setDraftHandoff(null);
  }, []);

  const handleAssistantStreamEnd = useCallback(
    (reason: "completed" | "aborted") => {
      onAssistantStreamEnd?.(reason);
      // The title is written asynchronously in readChatInput; after an abort the list must refresh too, to show the LLM title
      refreshRemoteSessions();
      window.setTimeout(() => refreshRemoteSessions(), 3_000);
      window.setTimeout(() => refreshRemoteSessions(), 8_000);
    },
    [onAssistantStreamEnd, refreshRemoteSessions],
  );

  const activeSession = getActiveAgentSession(sessionsState);
  const sessionTitle = sessionDisplayTitle(activeSession, t);

  const agentSessions = useMemo((): CoursewareAgentSessionView[] => {
    return sessionsState.sessions.map((s) => ({
      id: s.id,
      title: sessionDisplayTitle(s, t),
      isActive: s.id === sessionsState.activeSessionId,
      messageCount:
        s.id === sessionsState.activeSessionId
          ? chatMessages.length || s.messageCount || 0
          : s.messageCount ?? s.chatMessages.length,
      updatedAt: s.updatedAt,
    }));
  }, [sessionsState, chatMessages.length, t]);

  return (
    <CoursewareEditorAiPanel
      coursewareId={coursewareId}
      {...panelRest}
      sessionTitle={sessionTitle}
      agentSessions={agentSessions}
      onAgentSessionSelect={onAgentSessionSelect}
      onAgentSessionCreate={onAgentSessionCreate}
      onAssistantStreamEnd={handleAssistantStreamEnd}
      chatMessages={chatMessages}
      onChatMessagesChange={onChatMessagesChange}
      onClearHistory={onClearHistory}
      isHistoryLoading={isLoadingHistory}
      panelMode={panelMode}
      onPanelModeChange={handlePanelModeChange}
      onStartMakingWithDraft={handleStartMakingWithDraft}
      pendingDraftHandoff={draftHandoff}
      onDraftHandoffConsumed={handleDraftHandoffConsumed}
    />
  );
}
