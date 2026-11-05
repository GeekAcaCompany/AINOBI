// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';

import {
  scheduleAgentWorkspaceLivePreviewFlush,
  shouldFlushLivePreviewAfterAinobiBash,
} from './agent-live-preview-flush.ts';
import {
  flushAgentWorkspacePersistenceWhenIdle,
  scheduleAgentWorkspacePersistenceOnLivePreview,
  shouldFlushPersistenceAfterAinobiBash,
} from './agent-persistence-flush.ts';
import {
  archiveToolResultIfLarge,
  formatToolResultIndexContext,
  listRecentToolResultIndex,
  shouldSkipArchiveForReadPath,
  stringifyToolResponse,
  type ToolResultArchiveContext,
} from './agent-tool-result-archive.ts';
import { markAgentReadSkillMd } from './agent-workspace.ts';
import {
  evaluateAgentToolUse,
  isAgentSkillMdReadPath,
  type AgentToolPolicyContext,
} from './agent-tool-policy.ts';

const READ_PATH_KEYS = ['file_path', 'path', 'filePath', 'target_file', 'file'] as const;

const HOST_FLUSH_FAILURE_MARKER = '[ainobi host_flush] FAILED';

function appendHostFlushFailureNotice(
  previous: unknown,
  reason: string,
): string {
  const base =
    typeof previous === 'string'
      ? previous
      : previous === undefined || previous === null
        ? ''
        : stringifyToolResponse(previous);
  const notice = `${HOST_FLUSH_FAILURE_MARKER}: ${reason}\nThe courseware was NOT written to the database. Re-run \`ainobi save\` (no path) until host flush succeeds.`;
  return base.trim() ? `${base.trim()}\n\n${notice}` : notice;
}

function extractReadFilePath(input: Record<string, unknown>): string | null {
  for (const key of READ_PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export type CreateAgentHooksOptions = {
  livePreviewEnabled?: boolean;
  archive?: ToolResultArchiveContext | null;
  getSessionId?: () => string | null | undefined;
};

/**
 * Runs before/after tool execution even when tools are pre-listed in allowedTools.
 * Defense in depth alongside canUseTool.
 */
export function createAgentHooks(
  policy: AgentToolPolicyContext,
  options?: CreateAgentHooksOptions,
): NonNullable<Options['hooks']> {
  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return {};
    }

    const toolInput =
      input.tool_input && typeof input.tool_input === 'object'
        ? (input.tool_input as Record<string, unknown>)
        : {};

    const result = evaluateAgentToolUse(input.tool_name, toolInput, policy);
    if (result.allowed) {
      return {};
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: result.message ?? 'Tool use blocked by agent policy',
      },
    };
  };

  const postToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PostToolUse') {
      return {};
    }

    const toolInput =
      input.tool_input && typeof input.tool_input === 'object'
        ? (input.tool_input as Record<string, unknown>)
        : {};

    if (input.tool_name === 'Read' && !policy.skillMdRead) {
      const readPath = extractReadFilePath(toolInput);
      if (readPath && isAgentSkillMdReadPath(readPath, policy)) {
        markAgentReadSkillMd(policy.agentCwd);
        policy.skillMdRead = true;
      }
    }

    let updatedToolOutput: unknown | undefined;

    const archive = options?.archive;
    if (archive?.dataSource?.isInitialized) {
      const readPath = input.tool_name === 'Read' ? extractReadFilePath(toolInput) : null;
      const skipArchive =
        input.tool_name === 'Read' && shouldSkipArchiveForReadPath(readPath);
      const raw = stringifyToolResponse(input.tool_response);
      const sessionId = options?.getSessionId?.() ?? archive.sessionId;
      try {
        const outcome = await archiveToolResultIfLarge(
          { ...archive, sessionId },
          {
            toolUseId: input.tool_use_id,
            toolName: input.tool_name,
            toolInput,
            rawOutput: raw,
            skipArchive,
          },
        );
        if (outcome.archived && outcome.stub) {
          updatedToolOutput = outcome.stub;
        }
      } catch (error) {
        console.warn(
          '[tool-result-archive] PostToolUse archive failed:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (input.tool_name === 'Bash') {
      const command = typeof toolInput.command === 'string' ? toolInput.command : '';

      if (options?.livePreviewEnabled && shouldFlushLivePreviewAfterAinobiBash(command)) {
        scheduleAgentWorkspaceLivePreviewFlush(policy.agentCwd, {
          livePreviewSessionId: policy.livePreviewSessionId,
        });
        const coursewareKey = policy.coursewareKey?.trim();
        if (coursewareKey) {
          scheduleAgentWorkspacePersistenceOnLivePreview(
            policy.agentCwd,
            coursewareKey,
            policy.coursewareActor ?? undefined,
            policy.coursewareOrgId,
          );
        }
      }

      if (shouldFlushPersistenceAfterAinobiBash(command)) {
        const coursewareKey = policy.coursewareKey?.trim();
        if (!coursewareKey) {
          console.warn('[persistence] host flush skipped: no courseware key on this chat');
          updatedToolOutput = appendHostFlushFailureNotice(
            updatedToolOutput ?? input.tool_response,
            'no courseware key bound to this chat',
          );
        } else {
          try {
            const saved = await flushAgentWorkspacePersistenceWhenIdle(
              policy.agentCwd,
              coursewareKey,
              policy.coursewareActor ?? undefined,
              policy.coursewareOrgId,
            );
            if (saved) {
              console.info('[persistence] host flush saved', {
                workspace: policy.agentCwd,
                coursewareKey: saved.key,
                versionCount: saved.versionCount,
              });
            } else {
              console.warn('[persistence] host flush skipped: no CLI session scene on disk');
              updatedToolOutput = appendHostFlushFailureNotice(
                updatedToolOutput ?? input.tool_response,
                'no CLI session scene found on disk after save',
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[persistence] host flush failed:', message);
            updatedToolOutput = appendHostFlushFailureNotice(
              updatedToolOutput ?? input.tool_response,
              message,
            );
          }
        }
      }
    }

    if (updatedToolOutput !== undefined) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput,
        },
      };
    }

    return {};
  };

  const sessionStart: HookCallback = async (input) => {
    if (input.hook_event_name !== 'SessionStart') {
      return {};
    }
    if (input.source !== 'compact') {
      return {};
    }
    const archive = options?.archive;
    if (!archive?.dataSource?.isInitialized) {
      return {};
    }
    try {
      const entries = await listRecentToolResultIndex({
        dataSource: archive.dataSource,
        conversationId: archive.conversationId,
        sessionId: options?.getSessionId?.() ?? archive.sessionId,
        limit: 30,
      });
      const ctx = formatToolResultIndexContext(entries);
      if (!ctx) {
        return {};
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: ctx,
        },
      };
    } catch (error) {
      console.warn(
        '[tool-result-archive] SessionStart compact index failed:',
        error instanceof Error ? error.message : error,
      );
      return {};
    }
  };

  const postCompact: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PostCompact') {
      return {};
    }
    const archive = options?.archive;
    if (!archive?.dataSource?.isInitialized) {
      return {};
    }
    try {
      const entries = await listRecentToolResultIndex({
        dataSource: archive.dataSource,
        conversationId: archive.conversationId,
        sessionId: options?.getSessionId?.() ?? archive.sessionId,
        limit: 30,
      });
      const ctx = formatToolResultIndexContext(entries);
      if (!ctx) {
        return {};
      }
      return { systemMessage: ctx };
    } catch (error) {
      console.warn(
        '[tool-result-archive] PostCompact index failed:',
        error instanceof Error ? error.message : error,
      );
      return {};
    }
  };

  return {
    PreToolUse: [{ hooks: [guard] }],
    PostToolUse: [{ hooks: [postToolUse] }],
    SessionStart: [{ hooks: [sessionStart] }],
    PostCompact: [{ hooks: [postCompact] }],
  };
}

/** @deprecated Use {@link createAgentHooks}. */
export function createAgentPreToolUseHooks(
  policy: AgentToolPolicyContext,
): NonNullable<Options['hooks']> {
  return createAgentHooks(policy);
}

/** @internal re-export for tests */
export type { DataSource };
