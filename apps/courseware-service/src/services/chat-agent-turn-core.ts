// SPDX-License-Identifier: AGPL-3.0-only
import { query, type Options, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { dataSource } from '../db/db.ts';
import type { CoursewareConversation } from '../models/courseware-conversation.ts';
import { CoursewareSessionTranscriptLine } from '../models/courseware-conversation.ts';
import {
  accumulateConversationTokenUsage,
  createThrottledConversationSync,
  syncConversationAfterAgentTurn,
} from './conversation-service.ts';
import {
  billAgentTurnCredits,
  extractAgentTurnTokenUsage,
  formatAgentTurnBillingForClient,
  preauthCreditsForAgentTurn,
  type AgentTurnBillingOutcome,
  type AgentTurnPreauthOutcome,
  type AgentTurnTokenUsage,
} from './agent-turn-credits.ts';
import {
  applyChatUiEventsToBlocks,
  createChatUiStreamState,
  extractLastAssistantText,
  mapSdkMessageToChatUiEvents,
  type ChatUiAssistantBlock,
  type ChatUiEvent,
} from './chat-ui-events.ts';
import { buildAskUserQuestionRequestId } from './agent-permission.ts';
import type { ChatSseMirror } from './chat-stream-mirror.ts';
import {
  createThrottledStreamingPreviewSync,
  setChatStreamingPreview,
} from './conversation-streaming-preview.ts';
import type { CoursewareActorContext } from '../auth/ainobi-org-access.ts';
import { flushPendingAgentWorkspaceLivePreview } from './agent-live-preview-flush.ts';
import {
  flushNonEmptyPersistenceAfterAgentTurn,
  scheduleAgentWorkspacePersistenceOnLivePreview,
} from './agent-persistence-flush.ts';
import {
  buildAgentCreditsInsufficientUiEvent,
  isAgentCreditsInsufficientError,
  throwAgentCreditsPreauthFailure,
} from './agent-credits-errors.ts';

export type RunChatAgentTurnCoreArgs = {
  chatStreamSessionId: string;
  prompt: string;
  options: Options;
  conversation: CoursewareConversation | null;
  authorizedSession?: AinobiAuthorizedSession | null;
  coursewareOrgId?: string | null;
  sessionProjectKeyRef: { current: string };
  workspaceDir: string;
  livePreviewSessionId?: string;
  coursewareKey?: string;
  coursewareActor?: CoursewareActorContext;
  initialSessionId?: string;
  mirror: ChatSseMirror;
  abortController: AbortController;
  onUiEvent?: (event: ChatUiEvent) => void;
  creditsServiceCode?: string | null;
  /**
   * On a session-lost retry, reuse the credits pre-authorization of the first attempt (avoids reserving twice); undefined
   * = the normal path, which pre-authorizes itself from authorizedSession.
   */
  preauthOverride?: AgentTurnPreauthOutcome | null;
};

export type RunChatAgentTurnCoreResult = {
  sessionId?: string;
  conversationId?: string;
  result: string;
  tokenUsage?: AgentTurnTokenUsage;
  billing?: AgentTurnBillingOutcome;
  preauth?: AgentTurnPreauthOutcome | null;
};

/**
 * The Claude session transcript lives on the pod's local disk: after a deployment rollout / KEDA reclaim swaps the pod,
 * the `resume` target is missing → the SDK returns `error_during_execution` ("No conversation found
 * with session ID: …"). That failure is unrelated to the prompt and deterministic, so runChatAgentTurnCore
 * catches it and retries once **without resume, rebuilding the session**; other errors are thrown as usual.
 */
export class ChatSessionLostError extends Error {
  readonly preauth: AgentTurnPreauthOutcome | null;

  constructor(message: string, preauth: AgentTurnPreauthOutcome | null) {
    super(message);
    this.name = 'ChatSessionLostError';
    this.preauth = preauth;
  }
}

const CLAUDE_SESSION_LOST_PATTERN = /no conversation found with session id/i;

async function runChatAgentTurnCoreOnce(
  args: RunChatAgentTurnCoreArgs,
): Promise<RunChatAgentTurnCoreResult> {
  let conversationSync: ReturnType<typeof createThrottledConversationSync> | null = null;
  let streamingPreviewSync: ReturnType<typeof createThrottledStreamingPreviewSync> | null = null;

  let sessionId = args.initialSessionId;
  let streamSessionId = sessionId;
  const streamConversationId = args.conversation?.id;
  let result = "";
  let resultMessage: SDKResultMessage | undefined;
  // The last non-empty assistant text of this turn (fallback for an empty result from OpenAI bridge models)
  let lastAssistantText = "";

  const notifyConversationMeta = (fields: {
    claudeSessionId: string;
    sessionProjectKey?: string;
  }): void => {
    conversationSync?.notify(fields);
  };

  const uiState = createChatUiStreamState();
  let streamPreviewBlocks: ChatUiAssistantBlock[] = [];
  let preauth: AgentTurnPreauthOutcome | null =
    args.preauthOverride !== undefined ? args.preauthOverride : null;

  const emitUi = (event: ChatUiEvent): void => {
    // Keep streaming preview in sync with canUseTool cards (AskUserQuestion), not only SDK map.
    streamPreviewBlocks = applyChatUiEventsToBlocks(streamPreviewBlocks, [event]);
    if (streamPreviewBlocks.length > 0) {
      streamingPreviewSync?.notify(streamPreviewBlocks);
    }
    if (args.onUiEvent) {
      args.onUiEvent(event);
      return;
    }
    void args.mirror.emit('ui', {
      sessionId: streamSessionId,
      conversationId: streamConversationId,
      ...event,
    });
  };

  if (dataSource.isInitialized && args.conversation) {
    conversationSync = createThrottledConversationSync(args.conversation.id);
    streamingPreviewSync = createThrottledStreamingPreviewSync(args.conversation.id);
    await setChatStreamingPreview(args.conversation.id, {
      active: true,
      updatedAt: new Date().toISOString(),
      content: '',
      blocks: [],
    });
    if (sessionId) {
      notifyConversationMeta({
        claudeSessionId: sessionId,
        sessionProjectKey: args.sessionProjectKeyRef.current || undefined,
      });
    }
  }

  if (args.authorizedSession && args.preauthOverride === undefined) {
    preauth = await preauthCreditsForAgentTurn({
      session: args.authorizedSession,
      coursewareOrgId: args.coursewareOrgId,
      conversationId: streamConversationId,
      claudeSessionId: sessionId,
      creditsServiceCode: args.creditsServiceCode,
    });
    if (preauth?.ok === false) {
      if (isAgentCreditsInsufficientError(preauth.error)) {
        emitUi(buildAgentCreditsInsufficientUiEvent(args.coursewareOrgId, preauth.error));
      }
      throwAgentCreditsPreauthFailure(args.coursewareOrgId, preauth.error);
    }
  }

  console.info(
      '[turn-diag] sessionStore=', Boolean(args.options.sessionStore),
      '| flush=', args.options.sessionStoreFlush ?? '(default)',
      '| resume=', args.options.resume ?? null,
      '| cwd=', args.options.cwd,
      '| env.HOME=', args.options.env?.HOME,
      '| env.CLAUDE_CONFIG_DIR=', args.options.env?.CLAUDE_CONFIG_DIR ?? '(unset)',
      '| env keys=', Object.keys(args.options.env ?? {}).length,
    );
  try {
    for await (let message of query({ prompt: args.prompt, options: args.options })) {
      if (args.abortController.signal.aborted) {
        break;
      }
      if ('session_id' in message && message.session_id) {
        sessionId = message.session_id;
        streamSessionId = sessionId;
        notifyConversationMeta({
          claudeSessionId: sessionId,
          sessionProjectKey: args.sessionProjectKeyRef.current || undefined,
        });
      }

      if (message.type === 'assistant') {
        const text = extractLastAssistantText(
          (message.message as { content?: unknown } | undefined)?.content,
        );
        if (text) {
          lastAssistantText = text;
        }
      }

      // The reasoning output of OpenAI bridge models (the gpt-6 twins, through the openai_responses protocol bridge) gets
      // encoded by the gateway into a redacted_thinking content block at the end of the message; the CLI splits that block into this turn's last
      // text-less assistant message, so the success result comes back empty (although the model did reply).
      // Before mirroring/reading the value, rewrite it with the last assistant text as a fallback, so the SSE result message, the done event
      // and the /chat response all get the real reply; the UI side dedupes through seenTextBlocks, so nothing shows twice.
      if (
        message.type === 'result' &&
        message.subtype === 'success' &&
        !message.result &&
        lastAssistantText
      ) {
        message = { ...message, result: lastAssistantText };
      }

      await args.mirror.emit('message', {
        sessionId,
        conversationId: streamConversationId,
        message,
      });
      // Live AskUserQuestion uses the same requestId as canUseTool so preview/SSE/permission align.
      for (const ui of mapSdkMessageToChatUiEvents(uiState, message, {
        askUserQuestionRequestId: (toolUseId) =>
          buildAskUserQuestionRequestId(streamConversationId, toolUseId),
      })) {
        emitUi(ui);
      }
      if (streamPreviewBlocks.length > 0) {
        streamingPreviewSync?.notify(streamPreviewBlocks);
      }

      if (message.type === 'result') {
        resultMessage = message;
        if (message.subtype === 'success') {
          result = message.result;
        } else {
          const errText = message.errors?.join('\n') || message.subtype;
          if (CLAUDE_SESSION_LOST_PATTERN.test(errText)) {
            // No SSE error to the client — the outer wrapper rebuilds without resume and retries.
            throw new ChatSessionLostError(errText, preauth);
          }
          await args.mirror.emit('error', {
            ok: false,
            sessionId,
            conversationId: streamConversationId,
            error: errText,
          });
          throw new Error(errText);
        }
      }
    }
  } finally {
    // Failure/interrupt paths never reach the preview cleanup after the loop — clean it up here as a fallback,
    // or chatStreamingPreview.active hangs forever (red team R1: the frontend plan panel freezes).
    if (dataSource.isInitialized && args.conversation?.id) {
      try {
        await setChatStreamingPreview(args.conversation.id, null);
      } catch {
        /* best effort */
      }
    }
    // Never force-persist cancelled/failed turns — partial CLI scenes must not overwrite DB.
    await flushLivePreviewAfterAgentTurn({
      workspaceDir: args.workspaceDir,
      livePreviewSessionId: args.livePreviewSessionId,
      coursewareKey: args.coursewareKey,
      coursewareOrgId: args.coursewareOrgId,
      coursewareActor: args.coursewareActor,
      persistCourseware:
        !args.abortController.signal.aborted && resultMessage?.subtype === 'success',
    });
  }

  if (sessionId) {
    notifyConversationMeta({
      claudeSessionId: sessionId,
      sessionProjectKey: args.sessionProjectKeyRef.current || undefined,
    });
  }
  await conversationSync?.flush();
  await streamingPreviewSync?.flush();
  if (args.conversation?.id) {
    await setChatStreamingPreview(args.conversation.id, null);
  }
  if (dataSource.isInitialized && args.conversation && sessionId) {
    await syncConversationAfterAgentTurn(dataSource.manager, args.conversation.id, {
      claudeSessionId: sessionId,
      sessionProjectKey: args.sessionProjectKeyRef.current || undefined,
    });
  }

  let billing: AgentTurnBillingOutcome | undefined;
  let tokenUsage: AgentTurnTokenUsage | undefined =
    resultMessage ? extractAgentTurnTokenUsage(resultMessage) : undefined;

  if (
    !args.abortController.signal.aborted &&
    resultMessage &&
    args.authorizedSession
  ) {
    const billingOutcome = await billAgentTurnCredits({
      session: args.authorizedSession,
      coursewareOrgId: args.coursewareOrgId,
      resultMessage,
      conversationId: streamConversationId,
      claudeSessionId: sessionId,
      preauth,
      creditsServiceCode: args.creditsServiceCode,
    });
    if (billingOutcome) {
      billing = billingOutcome;
      tokenUsage = billingOutcome.usage;
    }
  }

  if (
    dataSource.isInitialized &&
    args.conversation?.id &&
    tokenUsage &&
    !args.abortController.signal.aborted
  ) {
    try {
      await accumulateConversationTokenUsage(dataSource.manager, args.conversation.id, {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        cacheTokens: tokenUsage.cacheCreationInputTokens + tokenUsage.cacheReadInputTokens,
      });
    } catch (error) {
      console.warn(
        '[conversation] token usage accumulate failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!args.abortController.signal.aborted) {
    await args.mirror.emit('done', {
      ok: true,
      sessionId,
      conversationId: streamConversationId,
      result,
      ...formatAgentTurnBillingForClient(billing ?? null),
      ...(tokenUsage && !billing
        ? {
            tokenUsage: {
              totalTokens: tokenUsage.totalTokens,
              inputTokens: tokenUsage.inputTokens,
              outputTokens: tokenUsage.outputTokens,
              cacheTokens:
                tokenUsage.cacheCreationInputTokens + tokenUsage.cacheReadInputTokens,
              cacheCreationInputTokens: tokenUsage.cacheCreationInputTokens,
              cacheReadInputTokens: tokenUsage.cacheReadInputTokens,
            },
          }
        : {}),
    });
  }

  conversationSync?.dispose();
  streamingPreviewSync?.dispose();

  return {
    sessionId,
    conversationId: streamConversationId,
    result,
    tokenUsage,
    billing,
    preauth,
  };
}

async function flushLivePreviewAfterAgentTurn(args: {
  workspaceDir: string;
  livePreviewSessionId?: string;
  coursewareKey?: string;
  coursewareOrgId?: string | null;
  coursewareActor?: CoursewareActorContext;
  /**
   * When false, still publish live preview if configured, but do not write the
   * courseware DB (cancelled / failed turns must not overwrite with partial scenes).
   * Defaults to true.
   */
  persistCourseware?: boolean;
}): Promise<void> {
  const persistCourseware = args.persistCourseware !== false;

  if (args.livePreviewSessionId?.trim()) {
    try {
      const published = await flushPendingAgentWorkspaceLivePreview(args.workspaceDir, {
        livePreviewSessionId: args.livePreviewSessionId,
      });
      if (published && persistCourseware) {
        const coursewareKey = args.coursewareKey?.trim();
        if (coursewareKey) {
          scheduleAgentWorkspacePersistenceOnLivePreview(
            args.workspaceDir,
            coursewareKey,
            args.coursewareActor,
            args.coursewareOrgId,
          );
        }
      }
    } catch (error) {
      console.warn(
        '[live-preview] end-of-turn flush failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!persistCourseware) {
    return;
  }

  // Home AI courseware has no livePreview: still force-persist non-empty CLI scenes.
  await flushNonEmptyPersistenceAfterAgentTurn({
    workspaceDir: args.workspaceDir,
    coursewareKey: args.coursewareKey,
    coursewareOrgId: args.coursewareOrgId,
    coursewareActor: args.coursewareActor,
  });
}


/**
 * Find the last session id of this conversation that **has transcript rows**. projectKey encodes the workspace's
 * absolute path (its form changes when the deploy root changes, e.g. /code → /app), but the conversationId is always embedded in
 * the path, so a LIKE lookup finds it across migration forms; empty sessions (failed attempts with no rows) are naturally excluded.
 */
async function findLastSessionIdWithTranscript(
  conversationId: string | undefined,
): Promise<string | undefined> {
  if (!conversationId?.trim() || !dataSource.isInitialized) {
    return undefined;
  }
  // ★PG folds unquoted aliases to lowercase: getRawMany's keys are session_id/last_at,
  // not camelCase (production once read rows[0].sessionId, got undefined and silently fell back to a new session).
  const rows = await dataSource
    .getRepository(CoursewareSessionTranscriptLine)
    .createQueryBuilder('t')
    .select('t.session_id', 'session_id')
    .addSelect('MAX(t.created_at)', 'last_at')
    .where('t.project_key LIKE :pattern', { pattern: `%${conversationId.trim()}%` })
    .groupBy('t.session_id')
    .orderBy('last_at', 'DESC')
    .limit(1)
    .getRawMany<{ session_id: string }>();
  const sessionId = rows[0]?.session_id?.trim();
  return sessionId || undefined;
}

/**
 * Session recovery: when no transcript is found for the resume target (a deploy root change broke the projectKey match /
 * the pointer points at a failed attempt that wrote no rows), recover the last resumable session from the DB and continue —
 * memory intact; only when the DB has no rows at all does it degrade to a brand-new session.
 */
export async function runChatAgentTurnCore(
  args: RunChatAgentTurnCoreArgs,
): Promise<RunChatAgentTurnCoreResult> {
  try {
    return await runChatAgentTurnCoreOnce(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sessionLost =
      error instanceof ChatSessionLostError || CLAUDE_SESSION_LOST_PATTERN.test(message);
    if (!sessionLost || !args.initialSessionId) {
      throw error;
    }
    console.warn(
      '[chat] claude session transcript not found for resume target; looking up last durable session:',
      message,
    );
    const preauth = error instanceof ChatSessionLostError ? error.preauth : null;

    // The history context isn't really lost: the PgSessionStore persists the SDK transcript line by line. A failed resume
    // usually just means "projectKey encodes the workspace's absolute path and can't be found after the deploy root changed (/code → /app)"
    // or "the conversation pointer points at a failed attempt that never wrote a row". Here we find
    // the conversation's **last session with a transcript** in the DB and resume it — memory intact; only when there is
    // none does it degrade to a brand-new session.
    let recoveredSessionId: string | undefined;
    try {
      recoveredSessionId = await findLastSessionIdWithTranscript(args.conversation?.id);
    } catch (lookupError) {
      console.warn(
        '[chat] last durable session lookup failed:',
        lookupError instanceof Error ? lookupError.message : lookupError,
      );
    }
    if (recoveredSessionId && recoveredSessionId === args.initialSessionId) {
      // The pointer points at exactly that and it still can't be found → a fault beyond projectKey, degrade to a new session
      recoveredSessionId = undefined;
    }

    const notice = recoveredSessionId
      ? '检测到服务切换导致会话连接中断,已从数据库恢复对话上下文,继续执行。'
      : '检测到会话历史暂不可用,已作为新会话继续执行。';
    try {
      await args.onUiEvent?.({ kind: 'prose', text: notice });
      await args.mirror.emit('ui', {
        sessionId: undefined,
        conversationId: args.conversation?.id,
        kind: 'prose',
        text: notice,
      });
    } catch {
      // best effort
    }
    // resume lives not only in initialSessionId but is also baked into the options.resume the caller built
    // — strip the stale value; if a resumable session was recovered from the DB, swap it in.
    const { resume: _droppedResume, continue: _droppedContinue, ...optionsForRetry } =
      args.options;
    void _droppedResume;
    void _droppedContinue;
    const retryOptions = {
      ...optionsForRetry,
      ...(recoveredSessionId ? { resume: recoveredSessionId } : {}),
    } as typeof args.options;
    return await runChatAgentTurnCoreOnce({
      ...args,
      initialSessionId: recoveredSessionId ?? undefined,
      options: retryOptions,
      preauthOverride: preauth,
    });
  }
}
