// SPDX-License-Identifier: AGPL-3.0-only
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import {
  evaluateAgentToolUse,
  evaluatePlanModeToolUse,
  type AgentToolPolicyContext,
} from './agent-tool-policy.ts';
import {
  parseAskUserQuestionInput,
  type ChatUiEvent,
  type ChatUiUserQuestion,
  type ChatUiUserQuestionOption,
} from './chat-ui-events.ts';

export type AgentUserQuestionOption = ChatUiUserQuestionOption;
export type AgentUserQuestion = ChatUiUserQuestion;
export { parseAskUserQuestionInput };

type PendingPermission = {
  resolve: (updatedInput: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  baseInput: Record<string, unknown>;
  clearTimer: () => void;
  requestId: string;
  toolUseId: string;
};

const pendingByRequestId = new Map<string, PendingPermission>();
const pendingByToolUseId = new Map<string, PendingPermission>();

const PERMISSION_WAIT_MS = Number(process.env.AGENT_PERMISSION_WAIT_MS ?? 600_000) || 600_000;

function isAskUserQuestionTool(toolName: string): boolean {
  return toolName === 'AskUserQuestion';
}

export function buildAskUserQuestionRequestId(
  conversationId: string | undefined,
  toolUseId: string,
): string {
  return `${conversationId?.trim() || 'session'}:${toolUseId}`;
}

function toolUseIdFromRequestId(requestId: string): string {
  const trimmed = requestId.trim();
  if (!trimmed) return '';
  const idx = trimmed.lastIndexOf(':');
  if (idx < 0) return trimmed;
  return trimmed.slice(idx + 1).trim();
}

function findPendingPermission(requestId: string): PendingPermission | null {
  const direct = pendingByRequestId.get(requestId);
  if (direct) return direct;

  const toolUseId = toolUseIdFromRequestId(requestId);
  if (toolUseId) {
    const byTool = pendingByToolUseId.get(toolUseId);
    if (byTool) return byTool;
  }

  // Accept bare toolUseId or any `*:toolUseId` alias the UI may have cached.
  for (const entry of pendingByRequestId.values()) {
    if (entry.toolUseId === requestId || entry.toolUseId === toolUseId) {
      return entry;
    }
  }
  return null;
}

function clearPendingPermission(entry: PendingPermission): void {
  entry.clearTimer();
  if (pendingByRequestId.get(entry.requestId) === entry) {
    pendingByRequestId.delete(entry.requestId);
  }
  if (pendingByToolUseId.get(entry.toolUseId) === entry) {
    pendingByToolUseId.delete(entry.toolUseId);
  }
}

export function buildUserQuestionUiEvent(args: {
  requestId: string;
  toolUseId: string;
  questions: AgentUserQuestion[];
}): ChatUiEvent {
  return {
    kind: 'user_question',
    requestId: args.requestId,
    toolUseId: args.toolUseId,
    questions: args.questions,
  };
}

export function waitForUserQuestionAnswer(
  requestId: string,
  baseInput: Record<string, unknown>,
  signal?: AbortSignal,
  toolUseId?: string,
): Promise<Record<string, unknown>> {
  const resolvedToolUseId = (toolUseId?.trim() || toolUseIdFromRequestId(requestId)).trim();
  const existing = pendingByRequestId.get(requestId) ??
    (resolvedToolUseId ? pendingByToolUseId.get(resolvedToolUseId) : undefined);
  if (existing) {
    clearPendingPermission(existing);
    existing.reject(new Error('Superseded by a new permission request'));
  }

  return new Promise((resolve, reject) => {
    let entry: PendingPermission;

    const timeout = setTimeout(() => {
      if (pendingByRequestId.get(requestId) !== entry) return;
      clearPendingPermission(entry);
      reject(new Error('Timed out waiting for user to answer the question'));
    }, PERMISSION_WAIT_MS);

    const clearTimer = () => {
      clearTimeout(timeout);
    };

    entry = {
      resolve,
      reject,
      baseInput,
      clearTimer,
      requestId,
      toolUseId: resolvedToolUseId || requestId,
    };
    pendingByRequestId.set(requestId, entry);
    if (entry.toolUseId) {
      pendingByToolUseId.set(entry.toolUseId, entry);
    }

    const onAbort = () => {
      if (pendingByRequestId.get(requestId) !== entry) return;
      clearPendingPermission(entry);
      reject(new Error('Permission request aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type SubmitUserQuestionAnswerBody = {
  requestId?: string;
  answers?: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
};

export function submitUserQuestionAnswer(body: SubmitUserQuestionAnswerBody): {
  ok: boolean;
  error?: string;
} {
  const requestId = body.requestId?.trim();
  if (!requestId) {
    return { ok: false, error: 'Missing requestId' };
  }

  const entry = findPendingPermission(requestId);
  if (!entry) {
    return { ok: false, error: 'Unknown or expired requestId' };
  }

  const answers = body.answers;
  if (!answers || typeof answers !== 'object' || Object.keys(answers).length === 0) {
    return { ok: false, error: 'Missing answers' };
  }

  clearPendingPermission(entry);
  const updatedInput: Record<string, unknown> = {
    ...entry.baseInput,
    answers,
  };
  if (body.annotations && typeof body.annotations === 'object') {
    updatedInput.annotations = body.annotations;
  }
  entry.resolve(updatedInput);
  return { ok: true };
}

function allowToolUse(
  input: Record<string, unknown>,
  toolUseID: string,
): PermissionResult {
  return {
    behavior: 'allow',
    updatedInput: input,
    toolUseID,
  };
}

function denyToolUse(message: string, toolUseID: string, interrupt?: boolean): PermissionResult {
  return {
    behavior: 'deny',
    message,
    toolUseID,
    ...(interrupt ? { interrupt } : {}),
  };
}

export function createAgentCanUseTool(args: {
  conversationId?: string;
  policy: AgentToolPolicyContext;
  emitUi?: (event: ChatUiEvent) => void;
}): CanUseTool {
  return async (toolName, input, options) => {
    try {
      const policy = evaluateAgentToolUse(toolName, input, args.policy);
      if (!policy.allowed) {
        return denyToolUse(
          policy.message ?? 'Tool use blocked by agent policy',
          options.toolUseID,
        );
      }

      if (!isAskUserQuestionTool(toolName)) {
        return allowToolUse(input, options.toolUseID);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return denyToolUse(`Permission check failed: ${message}`, options.toolUseID);
    }

    if (!args.emitUi) {
      return denyToolUse('AskUserQuestion requires a streaming chat session', options.toolUseID);
    }

    const questions = parseAskUserQuestionInput(input);
    if (questions.length === 0) {
      return denyToolUse(
        'AskUserQuestion payload is missing valid questions',
        options.toolUseID,
      );
    }

    const requestId = buildAskUserQuestionRequestId(args.conversationId, options.toolUseID);
    args.emitUi!(
      buildUserQuestionUiEvent({
        requestId,
        toolUseId: options.toolUseID,
        questions,
      }),
    );

    try {
      const updatedInput = await waitForUserQuestionAnswer(
        requestId,
        input,
        options.signal,
        options.toolUseID,
      );
      return allowToolUse(updatedInput, options.toolUseID);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return denyToolUse(message, options.toolUseID, options.signal?.aborted);
    }
  };
}

/**
 * Plan mode canUseTool: allows AskUserQuestion + read-only research (doc/search/asset get) and Read/Grep/Glob;
 * refuses action tools such as editing the courseware, image generation and narration.
 */
export function createPlanModeCanUseTool(args: {
  conversationId?: string;
  policy: AgentToolPolicyContext;
  emitUi?: (event: ChatUiEvent) => void;
}): CanUseTool {
  return async (toolName, input, options) => {
    try {
      const policy = evaluatePlanModeToolUse(toolName, input, args.policy);
      if (!policy.allowed) {
        return denyToolUse(
          policy.message ?? 'Tool use blocked by plan-mode policy',
          options.toolUseID,
        );
      }

      if (!isAskUserQuestionTool(toolName)) {
        return allowToolUse(input, options.toolUseID);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return denyToolUse(`Permission check failed: ${message}`, options.toolUseID);
    }

    if (!args.emitUi) {
      return denyToolUse('AskUserQuestion requires a streaming chat session', options.toolUseID);
    }

    const questions = parseAskUserQuestionInput(input);
    if (questions.length === 0) {
      return denyToolUse(
        'AskUserQuestion payload is missing valid questions',
        options.toolUseID,
      );
    }

    const requestId = buildAskUserQuestionRequestId(args.conversationId, options.toolUseID);
    args.emitUi(
      buildUserQuestionUiEvent({
        requestId,
        toolUseId: options.toolUseID,
        questions,
      }),
    );

    try {
      const updatedInput = await waitForUserQuestionAnswer(
        requestId,
        input,
        options.signal,
        options.toolUseID,
      );
      return allowToolUse(updatedInput, options.toolUseID);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return denyToolUse(message, options.toolUseID, options.signal?.aborted);
    }
  };
}

/**
 * Hosted agent must route tools through canUseTool. dontAsk + allowedTools auto-approves
 * without invoking canUseTool (bypassing path/credential policy).
 */
export function resolveAgentPermissionMode(
  requested: string | undefined,
): 'default' | 'acceptEdits' | 'plan' {
  const mode = requested?.trim();
  if (mode === 'plan') return 'plan';
  if (mode === 'acceptEdits') return 'acceptEdits';
  return 'default';
}
