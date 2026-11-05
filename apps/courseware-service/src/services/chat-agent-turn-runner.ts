// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from 'node:http';

import { getAuthorizedSession } from '../api-auth.ts';
import { resolveRedisConfig } from '../db/redis-stream.ts';
import { runChatAgentTurnCore } from './chat-agent-turn-core.ts';
import { createChatSseMirrorPublishOnly } from './chat-stream-mirror.ts';
import { CHAT_STREAM_RECOVERY_USER_PROMPT } from '../session/transcript-editor-context.ts';
import type { ChatTurnRequestSnapshot } from './chat-turn-registry.ts';
import {
  getChatTurn,
  tryAcquireChatResumeLock,
  releaseChatResumeLock,
  updateChatTurnStatus,
} from './chat-turn-registry.ts';

const localActiveTurns = new Set<string>();
const localAbortControllers = new Map<string, AbortController>();

export function isChatTurnActiveLocally(chatStreamSessionId: string): boolean {
  return localActiveTurns.has(chatStreamSessionId.trim());
}

export function registerLocalChatTurn(chatStreamSessionId: string): void {
  localActiveTurns.add(chatStreamSessionId.trim());
}

export function unregisterLocalChatTurn(chatStreamSessionId: string): void {
  localActiveTurns.delete(chatStreamSessionId.trim());
}

export function registerChatTurnAbort(chatStreamSessionId: string, controller: AbortController): void {
  localAbortControllers.set(chatStreamSessionId.trim(), controller);
}

export function unregisterChatTurnAbort(chatStreamSessionId: string): void {
  localAbortControllers.delete(chatStreamSessionId.trim());
}

/** Abort the in-process agent turn for this stream id, if any. */
export function abortLocalChatTurn(chatStreamSessionId: string): boolean {
  const controller = localAbortControllers.get(chatStreamSessionId.trim());
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

/**
 * After server restart or client GET reconnect: resume SDK session when turn is still `running`
 * in Redis but no in-process runner exists.
 */
export async function maybeResumeInterruptedChatTurn(
  req: IncomingMessage,
  chatStreamSessionId: string,
): Promise<void> {
  const streamId = chatStreamSessionId.trim();
  if (!streamId || !resolveRedisConfig()) {
    return;
  }
  if (isChatTurnActiveLocally(streamId)) {
    return;
  }

  const turn = await getChatTurn(streamId);
  if (!turn || turn.status !== 'running') {
    return;
  }

  const session = getAuthorizedSession(req);
  if (turn.userId && session?.userId && turn.userId !== session.userId) {
    return;
  }

  const locked = await tryAcquireChatResumeLock(streamId);
  if (!locked) {
    return;
  }

  void runResumedChatTurn(req, turn).finally(() => {
    void releaseChatResumeLock(streamId);
  });
}

async function runResumedChatTurn(
  req: IncomingMessage,
  turn: NonNullable<Awaited<ReturnType<typeof getChatTurn>>>,
): Promise<void> {
  const streamId = turn.chatStreamSessionId;
  registerLocalChatTurn(streamId);
  const abortController = new AbortController();
  registerChatTurnAbort(streamId, abortController);
  const mirror = createChatSseMirrorPublishOnly(streamId);

  try {
    const recoveryBody: ChatTurnRequestSnapshot = {
      ...turn.request,
      prompt: CHAT_STREAM_RECOVERY_USER_PROMPT,
      message: CHAT_STREAM_RECOVERY_USER_PROMPT,
      resumeInterruptedTurn: true,
      chatStreamSessionId: streamId,
      sessionId: turn.claudeSessionId ?? turn.request.sessionId,
      conversationId: turn.conversationId ?? turn.request.conversationId,
    };

    const { readChatInput } = await import('./chat-http.ts');
    const input = await readChatInput(
      req,
      {
        abortController,
        onUiEvent: (event) => {
          void mirror.emit('ui', {
            sessionId: turn.claudeSessionId,
            conversationId: turn.conversationId,
            ...event,
          });
        },
      },
      recoveryBody,
    );

    await mirror.emit('recovered', {
      ok: true,
      chatStreamSessionId: streamId,
      reason: 'interrupted_turn_resume',
    });

    const result = await runChatAgentTurnCore({
      chatStreamSessionId: streamId,
      prompt: input.prompt,
      options: input.options,
      conversation: input.conversation,
      authorizedSession: getAuthorizedSession(req),
      coursewareOrgId: input.coursewareOrgId,
      sessionProjectKeyRef: input.sessionProjectKeyRef,
      workspaceDir: input.workspaceDir,
      livePreviewSessionId: input.livePreviewSessionId,
      coursewareKey: input.coursewareKey,
      coursewareActor: input.coursewareActor,
      initialSessionId: input.sessionId,
      mirror,
      abortController,
    });

    if (abortController.signal.aborted) {
      await updateChatTurnStatus(streamId, 'cancelled');
      await mirror.emit('aborted', {
        ok: true,
        chatStreamSessionId: streamId,
        reason: 'user_cancelled',
      });
    } else {
      await updateChatTurnStatus(streamId, 'done', {
        claudeSessionId: result.sessionId,
        conversationId: result.conversationId ?? turn.conversationId,
      });
    }
  } catch (error) {
    console.warn(
      '[chat-stream] resume interrupted turn failed:',
      error instanceof Error ? error.message : error,
    );
    await mirror.emit('error', {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    await updateChatTurnStatus(streamId, 'error');
  } finally {
    unregisterLocalChatTurn(streamId);
    unregisterChatTurnAbort(streamId);
  }
}
