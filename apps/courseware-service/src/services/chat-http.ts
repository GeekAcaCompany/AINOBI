// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { query, type Options, type PermissionMode, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { extractAuthorizationToken, getAuthorizedSession } from "../api-auth.ts";
import { actorFromSession, type CoursewareActorContext } from "../auth/ainobi-org-access.ts";
import { resolveClaudeCodeExecutable } from "../claude-code-executable.ts";
import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { corsHeaders } from "../http/cors.ts";
import { chatErrorStatus, readJsonBody, sendJson, writeSse } from "../http/request.ts";
import type { CoursewareConversation } from "../models/courseware-conversation.ts";
import { coursewareCliRoot, projectRoot } from "../runtime-paths.ts";
import { createPgSessionStore } from "../session/pg-session-store.ts";
import { stripForeignThinkingBlocks } from "../session/provider-thinking-filter.ts";
import { buildAgentQueryPrompt } from "../session/transcript-editor-context.ts";
import type { PendingTranscriptPromptSplit } from "../session/transcript-editor-context.ts";
import {
  createAgentCanUseTool,
  createPlanModeCanUseTool,
  resolveAgentPermissionMode,
  submitUserQuestionAnswer,
  type SubmitUserQuestionAnswerBody,
} from "./agent-permission.ts";
import { formatAgentCurrentTime } from "./agent-current-time.ts";
import { createAgentHooks } from "./agent-hooks.ts";
import { getAinobiCliHelpContext } from "./ainobi-cli-help-context.ts";
import {
  getToolResultArchiveTurnStats,
  resetToolResultArchiveTurnStats,
} from "./agent-tool-result-archive.ts";
import { buildHtmlBuilderSubagent, HTML_BUILDER_SUBAGENT_NAME } from "./agent-html-subagent.ts";
import { summarizeSceneDiff, writeSceneSyncDiffReport } from "./agent-courseware-scene-diff.ts";
import { assessCliSessionVsDatabase, clearAgentWorkspaceCliSession } from "./agent-courseware-scene-sync.ts";
import { buildAgentSystemPromptAppend, buildPlanModeSystemPrompt } from "./agent-system-prompt.ts";
import {
  flushPendingAgentWorkspaceLivePreview,
  hasAgentWorkspaceCliSession,
  readAgentWorkspaceCliWorkDir,
  readAgentWorkspaceSession,
  seedLivePreviewSceneCache,
  syncLivePreviewSessionInWorkspace,
} from "./agent-live-preview-flush.ts";
import { detectUntrustedInstructionPatterns } from "./agent-security.ts";
import { buildAgentSandboxSettings } from "./agent-sandbox.ts";
import { pickAgentSubprocessEnv } from "./agent-subprocess-env.ts";
import { coursewareAssetUrlPrefixes } from "@ainobi/courseware-cli/cli/url-policy.ts";
import { buildAgentToolPolicyContext } from "./agent-tool-policy.ts";
import { fetchSectionKnowledgeAgentCatalog } from "./ainobi-section-knowledge.ts";
import { findLatestSectionBindingForCourseware } from "./courseware-section-binding-service.ts";
import {
  agentAinobiStateDir,
  agentScenePath,
  AGENT_SCENE_FILENAME,
  ensureAgentWorkspaceLayout,
  hasAgentReadSkillMd,
  markAgentReadSkillMd,
  readAgentSkillMdForPrompt,
  resolveAgentWorkspaceDir,
  SECTION_KNOWLEDGE_CATALOG_FILENAME,
} from "./agent-workspace.ts";
import {
  applyChatUiEventsToBlocks,
  createChatUiStreamState,
  extractLastAssistantText,
  mapSdkMessageToChatUiEvents,
  type ChatUiAssistantBlock,
  type ChatUiEvent,
} from "./chat-ui-events.ts";
import {
  writeSceneJsonAndAinobiLoad,
  writeSceneJsonToAgentWorkspace,
} from "./courseware-cli-preload.ts";
import {
  buildReferencedDesignTemplatesEditorSection,
  getDesignTemplatesByIds,
} from "./courseware-design-templates-service.ts";
import {
  buildReferencedContentTemplatesEditorSection,
  getContentTemplatesByIds,
} from "./courseware-content-templates-service.ts";
import {
  stageReferencedCoursewareForAgent,
  type ReferencedCoursewareInput,
} from "./courseware-reference-stage.ts";
import { recordCoursewareAuditLog } from "./courseware-audit-log-service.ts";
import { assertCoursewareRequestAccess } from "./courseware-org-guard.ts";
import { getCoursewareEntityById } from "./courseware-service.ts";
import {
  createThrottledConversationSync,
  resolveConversationForChat,
  syncConversationAfterAgentTurn,
  accumulateConversationTokenUsage,
} from "./conversation-service.ts";
import { ensureConversationTitleFromPrompt } from "./conversation-title-service.ts";
import {
  createThrottledStreamingPreviewSync,
  setChatStreamingPreview,
} from "./conversation-streaming-preview.ts";
import { scheduleAgentWorkspacePersistenceOnLivePreview, flushNonEmptyPersistenceAfterAgentTurn } from "./agent-persistence-flush.ts";
import { resolveRedisConfig } from "../db/redis-stream.ts";
import {
  assertAgentChatModelSupported,
  agentChatModelEnvSuffix,
  resolveAgentChatModel,
  resolveAgentChatModelEndpoint,
  type AgentChatModelOption,
} from "./agent-chat-models.ts";
import { ensureOpenAiAnthropicBridgeBaseUrl, bridgeNoProxyEnvPatch } from "./openai-anthropic-bridge.ts";
import {
  billAgentTurnCredits,
  extractAgentTurnTokenUsage,
  formatAgentTurnBillingForClient,
  preauthCreditsForAgentTurn,
} from "./agent-turn-credits.ts";
import { runChatAgentTurnCore } from "./chat-agent-turn-core.ts";
import { throwAgentCreditsPreauthFailure } from "./agent-credits-errors.ts";
import {
  abortLocalChatTurn,
  registerChatTurnAbort,
  registerLocalChatTurn,
  unregisterChatTurnAbort,
  unregisterLocalChatTurn,
} from "./chat-agent-turn-runner.ts";
import { createChatSseMirror, createChatSseMirrorPublishOnly } from "./chat-stream-mirror.ts";
import {
  getChatTurn,
  saveChatTurn,
  updateChatTurnStatus,
  type ChatTurnRequestSnapshot,
} from "./chat-turn-registry.ts";

export type ChatRequest = {
  prompt?: string;
  message?: string;
  editorContext?: string;
  sessionId?: string;
  conversationId?: string;
  coursewareKey?: string;
  coursewareId?: string;
  /** section_id on the URL when the editor is opened from course management; the knowledge-base fallback when the binding lookup fails. */
  sectionId?: string;
  /** course_id on the editor URL (written into the CLI env when passed together with sectionId). */
  courseId?: string;
  newConversation?: boolean;
  livePreviewSessionId?: string;
  /** Per assistant-run id; client may supply. Events are mirrored to Redis for GET reconnect. */
  chatStreamSessionId?: string;
  model?: string;
  baseUrl?: string;
  maxTurns?: number;
  permissionMode?: PermissionMode;
  /** Resume after host/stream interruption: hidden nudge only, no duplicate editor context. */
  resumeInterruptedTurn?: boolean;
  /** Editor UI language (zh/en/ja); used to summarize the conversation title */
  preferredUiLanguage?: string;
  /** Default courseware generation language (zh/en/ja); controls the language of new content and page text. */
  language?: string;
  /** Conversation kind; Plan mode passes `plan`, default `agent`. Separates conversations by kind (Plan/Agent each with their own history). */
  conversationKind?: "agent" | "plan";
  /**
   * Plan mode: acts as a "courseware design planner" that only converses, asks structured questions and produces a markdown design draft,
   * without loading the ainobi CLI or rewriting the courseware. When true, forces `conversationKind = plan`.
   */
  planMode?: boolean;
  /** Other coursewares the user @-referenced from the courseware library; the host preloads them as `./reference/*.scene.json` in the workspace. */
  referencedCourseware?: ReferencedCoursewareInput[];
  /** Organization design templates the user @-referenced; the host injects the markdown into editorContext. */
  referencedDesignTemplates?: ReferencedDesignTemplateInput[];
  /** Organization content templates the user @-referenced; the host injects the markdown into editorContext. */
  referencedContentTemplates?: ReferencedContentTemplateInput[];
};

export type ReferencedDesignTemplateInput = {
  id: string;
  name: string;
};

export type ReferencedContentTemplateInput = {
  id: string;
  name: string;
};

type ChatResponse = {
  ok: boolean;
  sessionId?: string;
  conversationId?: string;
  result?: string;
  messages?: SDKMessage[];
  error?: string;
};

type ChatInput = {
  prompt: string;
  sessionId?: string;
  options: Options;
  conversation: CoursewareConversation | null;
  sessionProjectKeyRef: { current: string };
  workspaceDir: string;
  livePreviewSessionId?: string;
  coursewareKey?: string;
  coursewareOrgId?: string | null;
  coursewareActor?: CoursewareActorContext;
  agentChatModel: AgentChatModelOption;
};

const systemPath =
  process.env.PATH?.trim() || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const binPath = [
  resolve(projectRoot, "bin"),
  resolve(coursewareCliRoot, "bin"),
  resolve(coursewareCliRoot, "node_modules", ".bin"),
  resolve(projectRoot, "node_modules", ".bin"),
  systemPath,
]
  .filter(Boolean)
  .join(delimiter);

const claudeCodeExecutable = resolveClaudeCodeExecutable();
const port = Number(process.env.PORT ?? 5633);
const defaultMaxTurns = Number(process.env.AGENT_MAX_TURNS ?? 40) || 40;
const defaultAgentDisplayName =
  process.env.AINOBI_AGENT_DISPLAY_NAME?.trim() || "AINOBI Courseware Assistant";

const EDITOR_CONTEXT_MAX_CHARS = 12_000;

function truncateEditorContext(text: string, maxChars = EDITOR_CONTEXT_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}\n\n…(editor context truncated for context limit)`;
}

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const authorizedSession = getAuthorizedSession(req);
    const {
      prompt,
      sessionId: initialSessionId,
      options,
      conversation,
      sessionProjectKeyRef,
      workspaceDir,
      livePreviewSessionId,
      coursewareKey,
      coursewareOrgId,
      coursewareActor,
      agentChatModel,
    } = await readChatInput(req);

    const messages: SDKMessage[] = [];
    let result = "";
    let sessionId = initialSessionId;
    let creditsPayload: Record<string, unknown> = {};
    let resultMessage: Extract<SDKMessage, { type: "result" }> | undefined;
    // The last non-empty assistant text of this turn (fallback for an empty result from OpenAI bridge models; see the comment in the loop)
    let lastAssistantText = "";

    const preauth = authorizedSession
      ? await preauthCreditsForAgentTurn({
          session: authorizedSession,
          coursewareOrgId,
          conversationId: conversation?.id,
          claudeSessionId: sessionId,
          creditsServiceCode: agentChatModel.creditsServiceCode,
        })
      : null;
    if (preauth?.ok === false) {
      throwAgentCreditsPreauthFailure(coursewareOrgId, preauth.error);
    }

    for await (let message of query({ prompt, options })) {
      if (message.type === "assistant") {
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
      // Before queuing/reading the value, rewrite it with the last assistant text as a fallback, so the /chat response gets the real reply.
      if (
        message.type === "result" &&
        message.subtype === "success" &&
        !message.result &&
        lastAssistantText
      ) {
        message = { ...message, result: lastAssistantText };
      }

      messages.push(message);

      if ("session_id" in message && message.session_id) {
        sessionId = message.session_id;
      }

      if (message.type === "result") {
        resultMessage = message;
        if (authorizedSession) {
          const billing = await billAgentTurnCredits({
            session: authorizedSession,
            coursewareOrgId,
            resultMessage: message,
            conversationId: conversation?.id,
            claudeSessionId: sessionId,
            preauth,
            creditsServiceCode: agentChatModel.creditsServiceCode,
          });
          creditsPayload = formatAgentTurnBillingForClient(billing);
        }

        if (message.subtype === "success") {
          result = message.result;
        } else {
          sendJson(res, 500, {
            ok: false,
            sessionId,
            conversationId: conversation?.id,
            messages,
            error: message.errors?.join("\n") || message.subtype,
            ...creditsPayload,
          } satisfies ChatResponse);
          return;
        }
      }
    }

    if (dataSource.isInitialized && conversation?.id && resultMessage) {
      const tokenUsage = extractAgentTurnTokenUsage(resultMessage);
      try {
        await accumulateConversationTokenUsage(dataSource.manager, conversation.id, {
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          cacheTokens:
            tokenUsage.cacheCreationInputTokens + tokenUsage.cacheReadInputTokens,
        });
      } catch (error) {
        console.warn(
          "[conversation] token usage accumulate failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (dataSource.isInitialized && conversation && sessionId) {
      await syncConversationAfterAgentTurn(dataSource.manager, conversation.id, {
        claudeSessionId: sessionId,
        sessionProjectKey: sessionProjectKeyRef.current || undefined,
      });
    }

    await flushLivePreviewAfterAgentTurn({
      workspaceDir,
      livePreviewSessionId,
      coursewareKey,
      coursewareOrgId,
      coursewareActor,
    });

    sendJson(res, 200, {
      ok: true,
      sessionId,
      conversationId: conversation?.id,
      result,
      messages,
      ...creditsPayload,
    } satisfies ChatResponse);
  } catch (error) {
    sendJson(res, chatErrorStatus(error), {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ChatResponse);
  }
}

export type ChatStreamAbortBody = {
  chatStreamSessionId?: string;
};

/** `POST /chat/stream/abort` — stop an in-flight agent turn (Redis mode keeps POST alive after client disconnect). */
export async function handleChatStreamAbort(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody<ChatStreamAbortBody>(req);
    const chatStreamSessionId = body.chatStreamSessionId?.trim();
    if (!chatStreamSessionId) {
      sendJson(res, 400, { ok: false, error: "Missing chatStreamSessionId" });
      return;
    }

    const authSession = getAuthorizedSession(req);
    const turn = await getChatTurn(chatStreamSessionId);
    if (turn?.userId && authSession?.userId && turn.userId !== authSession.userId) {
      sendJson(res, 403, { ok: false, error: "Forbidden" });
      return;
    }

    const wasRunning = turn?.status === "running";
    const abortedLocally = abortLocalChatTurn(chatStreamSessionId);
    const redisMirroring = resolveRedisConfig() != null;

    if (wasRunning) {
      await updateChatTurnStatus(chatStreamSessionId, "cancelled");
      if (redisMirroring) {
        const mirror = createChatSseMirrorPublishOnly(chatStreamSessionId);
        await mirror.emit("aborted", {
          ok: true,
          chatStreamSessionId,
          reason: "user_cancelled",
        });
      }
    }

    sendJson(res, 200, {
      ok: true,
      chatStreamSessionId,
      abortedLocally,
      wasRunning,
    });
  } catch (error) {
    sendJson(res, chatErrorStatus(error), {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleChatPermission(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody<SubmitUserQuestionAnswerBody>(req);
    const result = submitUserQuestionAnswer(body);
    if (!result.ok) {
      sendJson(res, 404, { ok: false, error: result.error ?? "Failed" });
      return;
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, chatErrorStatus(error), {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleChatStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<ChatRequest>(req);
  const chatStreamSessionId = body.chatStreamSessionId?.trim() || randomUUID();
  const redisMirroring = resolveRedisConfig() != null;

  const abortController = new AbortController();
  registerChatTurnAbort(chatStreamSessionId, abortController);
  let sdkIterating = false;
  let workspaceDirForPreview = "";
  let livePreviewSessionIdForPreview: string | undefined;
  let coursewareKeyForPreview: string | undefined;
  let coursewareActorForPreview: CoursewareActorContext | undefined;
  let clientConnected = true;

  const onClientClose = () => {
    clientConnected = false;
    if (!redisMirroring && sdkIterating) {
      abortController.abort();
    }
  };

  res.on("close", onClientClose);

  let mirror: ReturnType<typeof createChatSseMirror> | null = null;

  try {
    let streamSessionId: string | undefined;
    let streamConversationId: string | undefined;

    mirror = createChatSseMirror({
      chatStreamSessionId,
      res,
      isClientConnected: () => clientConnected,
    });

    const emitUi = (event: ChatUiEvent): void => {
      void mirror?.emit("ui", {
        sessionId: streamSessionId,
        conversationId: streamConversationId,
        ...event,
      });
    };

    const {
      prompt,
      sessionId: initialSessionId,
      options,
      conversation,
      sessionProjectKeyRef,
      workspaceDir,
      livePreviewSessionId: streamLivePreviewSessionId,
      coursewareKey,
      coursewareOrgId,
      coursewareActor,
      agentChatModel,
    } = await readChatInput(req, {
      abortController,
      onUiEvent: emitUi,
    }, body);
    workspaceDirForPreview = workspaceDir;
    livePreviewSessionIdForPreview = streamLivePreviewSessionId;
    coursewareKeyForPreview = coursewareKey;
    coursewareActorForPreview = coursewareActor;
    let result = "";
    let sessionId = initialSessionId;
    streamSessionId = sessionId;
    streamConversationId = conversation?.id;

    const turnSnapshot: ChatTurnRequestSnapshot = { ...body };
    const authSession = getAuthorizedSession(req);
    if (redisMirroring) {
      await saveChatTurn({
        status: "running",
        chatStreamSessionId,
        conversationId: conversation?.id,
        claudeSessionId: sessionId,
        coursewareId: body.coursewareId?.trim() || conversation?.coursewareId || undefined,
        livePreviewSessionId: streamLivePreviewSessionId,
        coursewareKey,
        request: turnSnapshot,
        userId: authSession?.userId,
        updatedAt: new Date().toISOString(),
      });
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...corsHeaders(),
    });
    await mirror.emit("ready", {
      ok: true,
      sessionId,
      conversationId: conversation?.id,
      chatStreamSessionId,
      model: agentChatModel.apiModel,
    });

    registerLocalChatTurn(chatStreamSessionId);
    sdkIterating = true;
    try {
      const turnResult = await runChatAgentTurnCore({
        chatStreamSessionId,
        prompt,
        options,
        conversation,
        authorizedSession: authSession,
        coursewareOrgId,
        sessionProjectKeyRef,
        workspaceDir,
        livePreviewSessionId: streamLivePreviewSessionId,
        coursewareKey,
        coursewareActor,
        initialSessionId: sessionId,
        mirror,
        abortController,
        onUiEvent: emitUi,
        creditsServiceCode: agentChatModel.creditsServiceCode,
      });
      sessionId = turnResult.sessionId;
      streamSessionId = sessionId;
      result = turnResult.result;
      if (redisMirroring) {
        if (abortController.signal.aborted) {
          await updateChatTurnStatus(chatStreamSessionId, "cancelled");
          await mirror.emit("aborted", {
            ok: true,
            chatStreamSessionId,
            reason: "user_cancelled",
          });
        } else {
          await updateChatTurnStatus(chatStreamSessionId, "done", {
            claudeSessionId: sessionId,
            conversationId: turnResult.conversationId,
          });
        }
      } else if (abortController.signal.aborted) {
        await mirror.emit("aborted", {
          ok: true,
          chatStreamSessionId,
          reason: "user_cancelled",
        });
      }
    } finally {
      sdkIterating = false;
      unregisterLocalChatTurn(chatStreamSessionId);
      unregisterChatTurnAbort(chatStreamSessionId);
    }

    res.end();
  } catch (error) {
    if (abortController.signal.aborted) {
      try {
        if (redisMirroring) {
          await updateChatTurnStatus(chatStreamSessionId, "cancelled");
        }
        if (mirror) {
          await mirror.emit("aborted", {
            ok: true,
            chatStreamSessionId,
            reason: "user_cancelled",
          });
        }
      } catch {
        // Response may already be closed.
      }
      return;
    }
    if (!res.headersSent) {
      res.writeHead(chatErrorStatus(error), {
        "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
        ...corsHeaders(),
      });
    }
    try {
      if (redisMirroring) {
        await updateChatTurnStatus(chatStreamSessionId, "error");
      }
      unregisterLocalChatTurn(chatStreamSessionId);
      unregisterChatTurnAbort(chatStreamSessionId);
      if (mirror) {
        await mirror.emit("error", {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        writeSse(res, "error", {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      res.end();
    } catch {
      // Response already torn down (e.g. client abort).
    }
  } finally {
    res.removeListener("close", onClientClose);
    unregisterChatTurnAbort(chatStreamSessionId);
  }
}

export async function readChatInput(
  req: IncomingMessage,
  streamOpts?: {
    abortController?: AbortController;
    conversationId?: string;
    onUiEvent?: (event: ChatUiEvent) => void;
    onConversationMetaChange?: (fields: {
      claudeSessionId: string;
      sessionProjectKey?: string;
    }) => void;
  },
  parsedBody?: ChatRequest,
): Promise<ChatInput> {
  const body = parsedBody ?? (await readJsonBody<ChatRequest>(req));
  const userPrompt = (body.prompt ?? body.message)?.trim();

  if (!userPrompt) {
    throw new Error("Missing prompt");
  }

  // Plan mode: the planner persona, conversation kind forced to plan; CLI preload and live preview off.
  // Plan and agent conversations are separated by kind and never appear in each other's history.
  const planMode = body.planMode === true;
  body.conversationKind = planMode ? "plan" : body.conversationKind === "plan" ? "plan" : "agent";

  const requestedModel = body.model?.trim() || undefined;
  const agentChatModel = requestedModel
    ? assertAgentChatModelSupported(requestedModel)
    : resolveAgentChatModel(undefined);
  body.model = agentChatModel.apiModel;
  if (agentChatModel.apiModel !== agentChatModel.id) {
    console.info(
      `[chat] model surface=${agentChatModel.id} api=${agentChatModel.apiModel} credits=${agentChatModel.creditsServiceCode}` +
        (requestedModel ? ` requested=${requestedModel}` : ''),
    );
  }

  const modelEndpoint = resolveAgentChatModelEndpoint(agentChatModel);
  // Security: body.baseUrl is an address the caller controls, while the SDK sends the server's per-model key
  // as x-api-key to the base URL — accepting a caller override would ship the server credential
  // out. The base URL always follows the server config (body.baseUrl is kept only for field compatibility;
  // its value is ignored).
  let baseUrl = modelEndpoint.baseUrl;
  if (!baseUrl && agentChatModel.viaOpenAiBridge) {
    // Upstream has no official Anthropic endpoint (e.g. xAI Grok): start the built-in OpenAI ↔ Anthropic protocol bridge.
    // Pass the actual apiModel, so a model redirected through AINOBI_GROK_4_6_API_ID is in the gateway's route list too.
    baseUrl = await ensureOpenAiAnthropicBridgeBaseUrl(
      agentChatModel.id,
      agentChatModel.apiModel,
    );
  }

  if (!baseUrl) {
    // Consistent with the actual lookup in resolveAgentChatModelEndpoint (envSuffix override)
    const suffix = agentChatModel.envSuffix ?? agentChatModelEnvSuffix(agentChatModel.id);
    throw new Error(
      `Missing baseUrl for model "${agentChatModel.id}". Configure ANTHROPIC_${suffix}_BASE_URL (or ANTHROPIC_BASE_URL) .`,
    );
  }

  try {
    await ensureDataSource();
  } catch (error) {
    console.warn(
      "[chat] Database unavailable; set DB_* env and run migrations. Chat works but Claude sessions are not mirrored:",
      error instanceof Error ? error.message : error,
    );
  }

  const authorizedSession = getAuthorizedSession(req);
  const actor = authorizedSession ? actorFromSession(authorizedSession) : undefined;

  const effectiveCwIdForAccess = (body.coursewareId?.trim() || body.coursewareKey?.trim()) ?? undefined;
  if (dataSource.isInitialized && authorizedSession && effectiveCwIdForAccess) {
    const cwForAccess = await getCoursewareEntityById(effectiveCwIdForAccess);
    if (cwForAccess) {
      await assertCoursewareRequestAccess(authorizedSession, cwForAccess, "write");
    }
  }

  let conversation: CoursewareConversation | null = null;
  if (dataSource.isInitialized) {
    conversation = await resolveConversationForChat(body, actor);
  }
  if (conversation && userPrompt) {
    try {
      await ensureConversationTitleFromPrompt(conversation, userPrompt, {
        preferredUiLanguage: body.preferredUiLanguage,
      });
    } catch (error) {
      console.warn(
        "[conversation-title] async title update failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (actor && conversation) {
    const cwIdForAudit = conversation.coursewareId ?? body.coursewareId?.trim() ?? null;
    let orgId = conversation.orgId;
    if (cwIdForAudit) {
      const cw = await getCoursewareEntityById(cwIdForAudit);
      orgId = cw?.orgId ?? orgId;
    }
    await recordCoursewareAuditLog({
      action: "chat.turn",
      actor,
      orgId: orgId ?? actor.orgId,
      coursewareId: cwIdForAudit,
      conversationId: conversation.id,
      detail: {
        newConversation: body.newConversation === true,
        hasCoursewareKey: Boolean(body.coursewareKey?.trim()),
      },
    });
  }

  const sessionProjectKeyRef = { current: "" };
  const claudeSessionIdRef = { current: conversation?.claudeSessionId?.trim() || "" };
  const ainobiShellSession = resolveAinobiShellSession(body, conversation);
  const resumeInterruptedTurn = body.resumeInterruptedTurn === true;
  const livePreviewSessionId =
    body.livePreviewSessionId?.trim() || conversation?.livePreviewSessionId?.trim();
  const editorContextParts = resumeInterruptedTurn
    ? []
    : [body.editorContext?.trim()].filter((part): part is string => Boolean(part && part.length > 0));
  let editorContextCombined = editorContextParts.join("\n\n");
  if (editorContextCombined) {
    editorContextCombined = truncateEditorContext(editorContextCombined);
  }

  const accessToken =
    getAuthorizedSession(req)?.accessToken ?? extractAuthorizationToken(req.headers.authorization);
  if (!accessToken) {
    throw new Error("Missing authorization token");
  }

  const env = buildClaudeEnv(body, baseUrl, ainobiShellSession, accessToken, modelEndpoint.apiKey);
  const agentNow = formatAgentCurrentTime();
  env.AINOBI_AGENT_NOW_ISO = agentNow.isoUtc;
  env.AINOBI_AGENT_TIMEZONE = agentNow.timeZone;
  env.AINOBI_AGENT_NOW_LOCAL = agentNow.localLabel;
  // Plan mode injects only the research hosts (search/doc/asset/recall); the action ones (narration/image generation/persistence) are left to the agent.
  if (!planMode) {
    applyPersistenceHostFlushEnv(env);
    applyNarrationHostFlushEnv(env);
    applyImageReplicateHostFlushEnv(env);
    applyImageGenerateHostFlushEnv(env);
    applyAiTeachersHostFlushEnv(env);
    applyTtsHostFlushEnv(env);
    applyDesignTemplateHostFlushEnv(env);
    applyContentTemplateHostFlushEnv(env);
  }
  applySearchHostFlushEnv(env);
  applyDocHostFlushEnv(env);
  applyKnowledgeHostFlushEnv(env);
  applyAssetHostFlushEnv(env);
  applyToolResultRecallHostEnv(env);
  if (livePreviewSessionId) {
    applyLivePreviewAgentEnv(env, accessToken);
  }

  const resumeSessionId =
    conversation?.claudeSessionId?.trim() || body.sessionId?.trim() || undefined;

  const effectiveCwId =
    (body.coursewareId?.trim() ||
      body.coursewareKey?.trim() ||
      conversation?.coursewareId) ??
    undefined;
  const workspaceDir = resolveAgentWorkspaceDir({
    coursewareCliRoot,
    conversationId: conversation?.id,
    preloadCoursewareId: !conversation?.id ? effectiveCwId : undefined,
    ephemeralKey: !conversation?.id && !effectiveCwId ? ainobiShellSession : undefined,
  });
  ensureAgentWorkspaceLayout({
    workspaceDir,
    projectRoot,
  });

  env.AINOBI_STATE_DIR = agentAinobiStateDir(workspaceDir);
  if (conversation?.id) {
    env.AINOBI_CONVERSATION_ID = conversation.id;
  if (conversation.claudeSessionId?.trim()) {
    env.AINOBI_CLAUDE_SESSION_ID = conversation.claudeSessionId.trim();
  }
  } else {
    delete env.AINOBI_CONVERSATION_ID;
  }

  let coursewareOrgId: string | null | undefined;

  let preload:
    | {
        sceneRelPath: string;
        coursewareKey: string;
        coursewareId: string;
        refreshedFromDb?: boolean;
        refreshHadUnsavedCliChanges?: boolean;
        sceneChangeSummary?: string;
      }
    | undefined;
  const skipPreload = process.env.CHAT_PRELOAD_COURSEWARE === "false";
  if (planMode && dataSource.isInitialized && effectiveCwId) {
    // Plan mode doesn't preload the scene / ainobi load, but injects the persistence URL asset get needs.
    const cw = await getCoursewareEntityById(effectiveCwId);
    if (!cw) {
      throw new Error(`Unknown coursewareId: ${effectiveCwId}`);
    }
    if (authorizedSession) {
      await assertCoursewareRequestAccess(authorizedSession, cw, "write");
    }
    coursewareOrgId = cw.orgId;
    applyCoursewarePersistenceEnv(env, cw.key, accessToken, cw.id, cw.orgId);
  } else if (!skipPreload && dataSource.isInitialized && effectiveCwId) {
    const cw = await getCoursewareEntityById(effectiveCwId);
    if (!cw) {
      throw new Error(`Unknown coursewareId: ${effectiveCwId}`);
    }
    if (authorizedSession) {
      await assertCoursewareRequestAccess(authorizedSession, cw, "write");
    }
    coursewareOrgId = cw.orgId;
    applyCoursewarePersistenceEnv(env, cw.key, accessToken, cw.id, cw.orgId);
    const scenePath = agentScenePath(workspaceDir);
    const dbUpdatedAtIso = cw.updatedAt.toISOString();
    let sessionAlreadyLoaded = await hasAgentWorkspaceCliSession(workspaceDir);
    let reloadedStaleCliSession = false;
    let refreshHadUnsavedCliChanges = false;
    let sceneChangeSummary: string | undefined;

    if (sessionAlreadyLoaded) {
      const existing = await readAgentWorkspaceSession(workspaceDir);
      const assessment =
        existing?.scene != null
          ? assessCliSessionVsDatabase(existing, cw.content, cw.updatedAt)
          : { status: 'in_sync' as const };

      if (assessment.status === 'stale') {
        if (existing?.scene != null) {
          const { report, relativePath } = await writeSceneSyncDiffReport(
            workspaceDir,
            existing.scene,
            cw.content,
          );
          sceneChangeSummary = summarizeSceneDiff(existing.scene, cw.content);
          console.info('[courseware-sync] reloading stale ainobi CLI session from database', {
            workspace: workspaceDir,
            coursewareKey: cw.key,
            reason: assessment.reason,
            hadUnsavedCliChanges: assessment.hadUnsavedCliChanges,
            diffReportPath: relativePath,
            totalChanges: report.total_changes,
            totalPages: report.total_pages,
            diffLines: sceneChangeSummary?.split('\n').length ?? 0,
          });
          const maxDiffLogLines = 200;
          if (report.total_changes === 0) {
            console.info('[courseware-sync] diff: (no field-level changes)');
          } else if (report.lines.length <= maxDiffLogLines) {
            console.info(
              `[courseware-sync] diff:\n${report.lines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`,
            );
          } else {
            console.info(
              `[courseware-sync] diff (first ${maxDiffLogLines}/${report.total_changes}):\n${report.lines
                .slice(0, maxDiffLogLines)
                .map((line, index) => `${index + 1}. ${line}`)
                .join('\n')}\n… see ${relativePath} or ainobi inspect scene-sync`,
            );
          }
        }
        reloadedStaleCliSession = true;
        refreshHadUnsavedCliChanges = assessment.hadUnsavedCliChanges;
        await clearAgentWorkspaceCliSession(workspaceDir);
        sessionAlreadyLoaded = false;
      }
    }

    if (sessionAlreadyLoaded) {
      // The CLI matches the database: keep the in-memory state and only sync the scene file for reference
      writeSceneJsonToAgentWorkspace({ scenePath, content: cw.content });
      preload = {
        sceneRelPath: AGENT_SCENE_FILENAME,
        coursewareKey: cw.key,
        coursewareId: cw.id,
      };
      if (livePreviewSessionId) {
        await syncLivePreviewSessionInWorkspace(workspaceDir, livePreviewSessionId);
        const existing = await readAgentWorkspaceSession(workspaceDir);
        seedLivePreviewSceneCache(
          workspaceDir,
          existing?.scene ?? cw.content,
          livePreviewSessionId,
        );
      }
    } else {
      const loadRes = writeSceneJsonAndAinobiLoad({
        scenePath,
        content: cw.content,
        cwd: workspaceDir,
        env,
        coursewareUpdatedAt: dbUpdatedAtIso,
      });
      if (loadRes.ok === false) {
        const detail = [loadRes.stderr, loadRes.stdout]
          .filter(Boolean)
          .join("\n---\n")
          .slice(0, 8000);
        throw new Error(`ainobi load failed (exit ${loadRes.status ?? "n/a"}): ${detail}`);
      }
      preload = {
        sceneRelPath: AGENT_SCENE_FILENAME,
        coursewareKey: cw.key,
        coursewareId: cw.id,
        ...(reloadedStaleCliSession
          ? {
              refreshedFromDb: true,
              refreshHadUnsavedCliChanges,
              sceneChangeSummary,
            }
          : {}),
      };
      if (livePreviewSessionId) {
        seedLivePreviewSceneCache(workspaceDir, cw.content, livePreviewSessionId);
      }
    }
  }

  // Platform resource URL allowlist: derived by the host from the full env (including the OCI S3-compat form) and passed to the
  // subprocess as a non-secret env — without storage credentials the subprocess can't derive it itself, and validate would
  // falsely flag every platform audio URL (the 2026-09-06 session case).
  env.AINOBI_COURSEWARE_ASSET_BASE_URLS = coursewareAssetUrlPrefixes().join(',');
  if (!env.AINOBI_COURSEWARE_KEY?.trim()) {
    const keyFromBody = body.coursewareKey?.trim();
    if (keyFromBody) {
      const cw = await getCoursewareEntityById(keyFromBody);
      if (cw) {
        coursewareOrgId = cw.orgId ?? coursewareOrgId;
        applyCoursewarePersistenceEnv(env, cw.key, accessToken, cw.id, cw.orgId);
      } else {
        applyCoursewarePersistenceEnv(env, keyFromBody, accessToken, undefined, coursewareOrgId);
      }
    } else if (conversation?.coursewareId) {
      const cw = await getCoursewareEntityById(conversation.coursewareId);
      if (cw) {
        coursewareOrgId = cw.orgId ?? coursewareOrgId;
        applyCoursewarePersistenceEnv(env, cw.key, accessToken, cw.id, cw.orgId);
      }
    }
  }

  const editorCoursewareId = body.coursewareId?.trim();
  if (editorCoursewareId) {
    env.AINOBI_COURSEWARE_ID = editorCoursewareId;
  }

  if (
    !resumeInterruptedTurn &&
    dataSource.isInitialized &&
    Array.isArray(body.referencedCourseware) &&
    body.referencedCourseware.length > 0
  ) {
    try {
      const { editorContextSection, staged } = await stageReferencedCoursewareForAgent({
        workspaceDir,
        refs: body.referencedCourseware,
        session: authorizedSession,
        editingCoursewareKey: preload?.coursewareKey ?? env.AINOBI_COURSEWARE_KEY?.trim(),
        editingCoursewareId: effectiveCwId,
      });
      if (editorContextSection.trim()) {
        editorContextCombined = editorContextCombined
          ? `${editorContextCombined}\n\n${editorContextSection}`
          : editorContextSection;
      }
      if (staged.length > 0) {
        console.info("[courseware-reference] staged reference courseware", {
          count: staged.length,
          paths: staged.map((item) => item.sceneRelPath),
        });
      }
    } catch (error) {
      console.warn(
        "[courseware-reference] staging failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (
    !resumeInterruptedTurn &&
    dataSource.isInitialized &&
    Array.isArray(body.referencedDesignTemplates) &&
    body.referencedDesignTemplates.length > 0 &&
    coursewareOrgId?.trim()
  ) {
    try {
      const ids = body.referencedDesignTemplates
        .map((item) => item.id?.trim())
        .filter((id): id is string => Boolean(id));
      const templates = await getDesignTemplatesByIds(coursewareOrgId.trim(), ids);
      const section = buildReferencedDesignTemplatesEditorSection(templates);
      if (section.trim()) {
        editorContextCombined = editorContextCombined
          ? `${editorContextCombined}\n\n${section}`
          : section;
      }
      if (templates.length > 0) {
        console.info("[design-template] injected referenced templates", {
          count: templates.length,
          ids: templates.map((item) => item.id),
        });
      }
    } catch (error) {
      console.warn(
        "[design-template] inject failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (
    !resumeInterruptedTurn &&
    dataSource.isInitialized &&
    Array.isArray(body.referencedContentTemplates) &&
    body.referencedContentTemplates.length > 0 &&
    coursewareOrgId?.trim()
  ) {
    try {
      const ids = body.referencedContentTemplates
        .map((item) => item.id?.trim())
        .filter((id): id is string => Boolean(id));
      const templates = await getContentTemplatesByIds(coursewareOrgId.trim(), ids);
      const section = buildReferencedContentTemplatesEditorSection(templates);
      if (section.trim()) {
        editorContextCombined = editorContextCombined
          ? `${editorContextCombined}\n\n${section}`
          : section;
      }
      if (templates.length > 0) {
        console.info("[content-template] injected referenced templates", {
          count: templates.length,
          ids: templates.map((item) => item.id),
        });
      }
    } catch (error) {
      console.warn(
        "[content-template] inject failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  let sectionKnowledgePromptLine: string | undefined;
  if (!resumeInterruptedTurn && dataSource.isInitialized && (effectiveCwId || body.sectionId?.trim())) {
    try {
      const preferredSectionId = body.sectionId?.trim() || null;
      const binding = effectiveCwId
        ? await findLatestSectionBindingForCourseware(effectiveCwId, preferredSectionId)
        : null;
      // Editor URL section wins when present; binding fills gaps / library-only opens.
      const sectionId = (preferredSectionId || binding?.sectionId || "").trim();
      const courseId = (body.courseId?.trim() || binding?.courseId || "").trim();
      if (sectionId) {
        env.AINOBI_SECTION_ID = sectionId;
        if (courseId) {
          env.AINOBI_COURSE_ID = courseId;
        }
        const catalog = await fetchSectionKnowledgeAgentCatalog(
          accessToken,
          sectionId,
        );
        const catalogPath = resolve(workspaceDir, SECTION_KNOWLEDGE_CATALOG_FILENAME);
        writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
        const fileCount = catalog.files?.length ?? 0;
        const via = preferredSectionId
          ? "request.sectionId"
          : binding?.sectionId
            ? "binding"
            : "unknown";
        sectionKnowledgePromptLine =
          fileCount > 0
            ? `**Section knowledge base:** Course section \`${sectionId}\` has ${fileCount} knowledge file(s) (${via}). Catalog is in \`${SECTION_KNOWLEDGE_CATALOG_FILENAME}\` (internal — do not name this file to the user). Prefer summaries first; body text via \`ainobi knowledge read --file-id <uuid>\`. Refer to it in the user's language as the course knowledge base / section materials (e.g. 课程知识库 in a Chinese chat) + document titles.`
            : `**Section knowledge base:** Course section \`${sectionId}\` (${via}) has no knowledge files yet. Proceed without section KB text. Do not claim KB materials exist.`;
        console.info("[section-knowledge] catalog written", {
          effectiveCwId: effectiveCwId ?? null,
          sectionId,
          fileCount,
          via,
          path: SECTION_KNOWLEDGE_CATALOG_FILENAME,
        });
      } else {
        console.warn("[section-knowledge] no binding and no sectionId", {
          effectiveCwId: effectiveCwId ?? null,
          bodySectionId: body.sectionId ?? null,
        });
        sectionKnowledgePromptLine =
          "**Section knowledge base:** No courseware↔section binding found for this courseware. Section knowledge files are unavailable. Do not invent course knowledge materials.";
      }
    } catch (error) {
      console.warn(
        "[section-knowledge] catalog inject failed:",
        error instanceof Error ? error.message : error,
      );
      sectionKnowledgePromptLine =
        "**Section knowledge base:** Failed to load section knowledge catalog; continue without it. Tell the user briefly that course knowledge materials could not be loaded if they ask.";
    }
  }

  const { queryPrompt } = buildAgentQueryPrompt({
    userPrompt,
    editorContext: editorContextCombined || undefined,
  });
  const untrustedPromptSignals = detectUntrustedInstructionPatterns(queryPrompt);
  if (untrustedPromptSignals.length > 0) {
    console.info("[agent-security] untrusted-instruction signals in user turn:", untrustedPromptSignals);
  }
  const transcriptPromptSplitRef: { current: PendingTranscriptPromptSplit | undefined } = {
    current:
      !resumeInterruptedTurn && editorContextCombined.length > 0
        ? { userPrompt, editorContext: editorContextCombined, queryPrompt }
        : undefined,
  };

  resetToolResultArchiveTurnStats(conversation?.id);

  const permissionMode = resolveAgentPermissionMode(body.permissionMode);
  // Plan mode doesn't force reading SKILL.md; the research CLI doesn't depend on the skill bootstrap.
  // Build mode inlines SKILL.md into the system prompt by default and treats it as read: in production 46% of sessions hit
  // the "Read SKILL.md first" gate (268 failed calls). AINOBI_AGENT_INLINE_SKILL_MD=false falls back to the Read gate.
  const inlineSkillMd =
    !planMode && process.env.AINOBI_AGENT_INLINE_SKILL_MD?.trim().toLowerCase() !== 'false'
      ? readAgentSkillMdForPrompt(workspaceDir)
      : null;
  if (inlineSkillMd && !hasAgentReadSkillMd(workspaceDir)) {
    markAgentReadSkillMd(workspaceDir);
  }
  const skillMdRead = planMode || Boolean(inlineSkillMd) || hasAgentReadSkillMd(workspaceDir);
  const cliWorkDir = await readAgentWorkspaceCliWorkDir(workspaceDir);
  // Agents used to derive work_dir via `$(ainobi scene info --verbose | jq/python …)` — both blocked.
  if (cliWorkDir) env.AINOBI_WORK_DIR = cliWorkDir;
  const toolPolicy = buildAgentToolPolicyContext({
    agentCwd: workspaceDir,
    serviceRoot: projectRoot,
    scenePreloaded: Boolean(preload),
    skillMdRead,
    cliWorkDir,
    livePreviewSessionId,
    coursewareKey: env.AINOBI_COURSEWARE_KEY?.trim() || null,
    coursewareActor: actor ?? null,
    coursewareOrgId: coursewareOrgId ?? null,
  });
  const sandbox = buildAgentSandboxSettings(
    baseUrl,
    workspaceDir,
    env,
    cliWorkDir,
    projectRoot,
  );
  const options: Options = {
    cwd: workspaceDir,
    additionalDirectories: [],
    // Do not load repo-root `.claude` via `project` — it injects skills with the wrong base directory.
    settingSources: [],
    // Plan mode doesn't load the full authoring skill (so it isn't tempted to edit the courseware); the research abilities are in the Plan system prompt.
    skills: planMode ? [] : ["ainobi-courseware-cli"],
    // Agent mode mounts the dedicated HTML authoring subagent: complex/interactive/presentation-style html elements are delegated to it through Task,
    // so the main agent can focus on courseware structure and timeline while the subagent builds creative HTML on its own (with search and image generation).
    ...(planMode
      ? {}
      : {
          agents: {
            [HTML_BUILDER_SUBAGENT_NAME]: buildHtmlBuilderSubagent({
              preferredUiLanguage: body.preferredUiLanguage,
              language: body.language,
              agentNowPromptLine: agentNow.promptLine,
            }),
          },
        }),
    permissionMode: planMode ? "default" : permissionMode,
    maxTurns: body.maxTurns ?? defaultMaxTurns,
    model: body.model,
    resume: resumeSessionId,
    ...(claudeCodeExecutable ? { pathToClaudeCodeExecutable: claudeCodeExecutable } : {}),
    systemPrompt: planMode
      ? buildPlanModeSystemPrompt({
          agentDisplayName: defaultAgentDisplayName,
          preferredUiLanguage: body.preferredUiLanguage,
          language: body.language,
          agentNow,
          sectionKnowledgeLine: sectionKnowledgePromptLine,
        })
      : {
          type: "preset",
          preset: "claude_code",
          append: buildAgentSystemPromptAppend({
            agentDisplayName: defaultAgentDisplayName,
            language: body.language,
            preferredUiLanguage: body.preferredUiLanguage,
            livePreviewSessionId,
            preload,
            skillMdRead,
            cliHelpContext: getAinobiCliHelpContext({
              cwd: coursewareCliRoot,
              path: binPath,
            }),
            agentNow,
            sectionKnowledgeLine: sectionKnowledgePromptLine,
            skillMdContent: inlineSkillMd,
            cliWorkDir,
          }),
        },
    env,
    sandbox,
    // Flag-settings layer — ensures nested-sandbox + bwrap/socat paths reach the Claude CLI on FC.
    // autoCompactEnabled: shrink history when the context window fills (stubs + index reinject via hooks).
    settings: { sandbox, autoCompactEnabled: true },
    hooks: createAgentHooks(toolPolicy, {
      livePreviewEnabled: planMode ? false : Boolean(livePreviewSessionId),
      archive: dataSource.isInitialized
        ? {
            dataSource,
            conversationId: conversation?.id ?? null,
            sessionId: claudeSessionIdRef.current || resumeSessionId || null,
          }
        : null,
      getSessionId: () => claudeSessionIdRef.current || resumeSessionId || null,
    }),
    canUseTool: planMode
      ? createPlanModeCanUseTool({
          conversationId: conversation?.id ?? streamOpts?.conversationId,
          policy: toolPolicy,
          emitUi: streamOpts?.onUiEvent,
        })
      : createAgentCanUseTool({
          conversationId: conversation?.id ?? streamOpts?.conversationId,
          policy: toolPolicy,
          emitUi: streamOpts?.onUiEvent,
        }),
    ...(streamOpts?.abortController ? { abortController: streamOpts.abortController } : {}),
  };

  if (dataSource.isInitialized) {
    // Frames in batched mode flush at a threshold/result — but after the OKE migration production turns persisted nothing,
    // so it switched to eager per-frame persistence, sidestepping the batch timing problem (red-blue exercise, the 2026-09-06 session-not-loading case).
    options.sessionStoreFlush = 'eager';
    options.sessionStore = createPgSessionStore(dataSource, {
      afterAppend(key) {
        sessionProjectKeyRef.current = key.projectKey;
        claudeSessionIdRef.current = key.sessionId;
        streamOpts?.onConversationMetaChange?.({
          claudeSessionId: key.sessionId,
          sessionProjectKey: key.projectKey,
        });
      },
      getPendingTranscriptPromptSplit: () => transcriptPromptSplitRef.current,
      consumePendingTranscriptPromptSplit: () => {
        transcriptPromptSplitRef.current = undefined;
      },
      toolResultArchive: {
        dataSource,
        conversationId: conversation?.id ?? null,
        sessionId: claudeSessionIdRef.current || resumeSessionId || null,
      },
      // Switching models mid-conversation can cross protocol families (DeepSeek ↔ the ai-gateway):
      // the stored reasoning blocks then mean nothing to the target and the bridge's translation
      // even makes OpenAI reject the turn. Drop the foreign family's blocks on load.
      transformLoadedEntries: (entries) =>
        stripForeignThinkingBlocks(entries, { viaOpenAiBridge: agentChatModel.viaOpenAiBridge === true }),
    });
  }

  return {
    prompt: queryPrompt,
    sessionId: resumeSessionId,
    options,
    conversation,
    sessionProjectKeyRef,
    workspaceDir,
    livePreviewSessionId,
    coursewareKey: env.AINOBI_COURSEWARE_KEY?.trim() || undefined,
    coursewareOrgId,
    coursewareActor: actor,
    agentChatModel,
  };
}

async function flushLivePreviewAfterAgentTurn(args: {
  workspaceDir: string;
  livePreviewSessionId?: string;
  coursewareKey?: string;
  coursewareOrgId?: string | null;
  coursewareActor?: CoursewareActorContext;
  /** When false, skip courseware DB writes (cancelled/failed turns). Defaults to true. */
  persistCourseware?: boolean;
}): Promise<void> {
  const persistCourseware = args.persistCourseware !== false;

  if (args.livePreviewSessionId?.trim()) {
    try {
      const published = await flushPendingAgentWorkspaceLivePreview(args.workspaceDir, {
        livePreviewSessionId: args.livePreviewSessionId,
      });
      if (published && persistCourseware) {
        console.info('[live-preview] end-of-turn flush published', {
          livePreviewSessionId: args.livePreviewSessionId,
        });
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

  await flushNonEmptyPersistenceAfterAgentTurn({
    workspaceDir: args.workspaceDir,
    coursewareKey: args.coursewareKey,
    coursewareOrgId: args.coursewareOrgId,
    coursewareActor: args.coursewareActor,
  });
}

function resolveAinobiShellSession(body: ChatRequest, conversation: CoursewareConversation | null): string {
  if (conversation) {
    return `agent-cw-${conversation.id}`;
  }
  if (body.sessionId) {
    return `agent-${body.sessionId}`;
  }

  return `agent-${randomUUID()}`;
}

function applyCoursewarePersistenceEnv(
  env: NodeJS.ProcessEnv,
  coursewareKey: string,
  accessToken: string,
  coursewareId?: string,
  coursewareOrgId?: string | null,
): void {
  const key = coursewareKey.trim();
  if (!key) {
    return;
  }
  env.AINOBI_COURSEWARE_KEY = key;
  env.AINOBI_AGENT_API_KEY = accessToken;
  const id = coursewareId?.trim();
  if (id) {
    env.AINOBI_COURSEWARE_ID = id;
  }
  const orgId = coursewareOrgId?.trim();
  if (orgId) {
    env.AINOBI_COURSEWARE_ORG_ID = orgId;
  } else {
    delete env.AINOBI_COURSEWARE_ORG_ID;
  }
  if (!env.AINOBI_COURSEWARE_PERSISTENCE_URL?.trim()) {
    env.AINOBI_COURSEWARE_PERSISTENCE_URL = `http://127.0.0.1:${port}/courseware`;
  }
  env.AINOBI_COURSEWARE_ASSET_UPLOAD_URL = `http://127.0.0.1:${port}/courseware/assets/upload`;
  env.AINOBI_COURSEWARE_ASSET_GET_URL = `http://127.0.0.1:${port}/courseware/assets/get`;
}

function applyPersistenceHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** CLI skips sandbox-blocked PUT to localhost; host PostToolUse calls saveCourseware. */
  env.AINOBI_PERSISTENCE_HOST_FLUSH = '1';
}

function applyNarrationHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/narration/run` (TTS + OSS with full credentials). */
  env.AINOBI_NARRATION_HOST_FLUSH = '1';
  env.AINOBI_NARRATION_HOST_URL = `http://127.0.0.1:${port}/courseware/narration/run`;
}

function applySearchHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/search/run` (Tavily with host `TAVILY_API_KEY`). */
  env.AINOBI_SEARCH_HOST_FLUSH = '1';
  env.AINOBI_SEARCH_HOST_URL = `http://127.0.0.1:${port}/courseware/search/run`;
}

function applyDocHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/doc/read` (markitdown-ts + host `OPENAI_*` for images). */
  env.AINOBI_DOC_HOST_FLUSH = '1';
  env.AINOBI_DOC_HOST_URL = `http://127.0.0.1:${port}/courseware/doc/read`;
}

function applyKnowledgeHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/knowledge/read` (education text_slice). */
  env.AINOBI_KNOWLEDGE_HOST_FLUSH = '1';
  env.AINOBI_KNOWLEDGE_HOST_URL = `http://127.0.0.1:${port}/courseware/knowledge/read`;
}

function applyImageReplicateHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/image/replicate-html` (multimodal `OPENAI_*` → HTML). */
  env.AINOBI_IMAGE_REPLICATE_HOST_FLUSH = '1';
  env.AINOBI_IMAGE_REPLICATE_HOST_URL = `http://127.0.0.1:${port}/courseware/image/replicate-html`;
}

function applyImageGenerateHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/image/generate` (gpt-image-2 → courseware asset, billed). */
  env.AINOBI_IMAGE_GENERATE_HOST_FLUSH = '1';
  env.AINOBI_IMAGE_GENERATE_HOST_URL = `http://127.0.0.1:${port}/courseware/image/generate`;
}

function applyAiTeachersHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/ai-teachers/list` (platform API proxied with user session). */
  env.AINOBI_AI_TEACHERS_HOST_FLUSH = '1';
  env.AINOBI_AI_TEACHERS_HOST_URL = `http://127.0.0.1:${port}/courseware/ai-teachers/list`;
}

function applyTtsHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs to host `/courseware/tts/list` (platform TTS catalog). */
  env.AINOBI_TTS_HOST_FLUSH = '1';
  env.AINOBI_TTS_HOST_URL = `http://127.0.0.1:${port}/courseware/tts/list`;
}

function applyToolResultRecallHostEnv(env: NodeJS.ProcessEnv): void {
  env.AINOBI_TOOL_RESULT_RECALL_HOST_URL = `http://127.0.0.1:${port}/courseware/tool-result/recall`;
}

function applyDesignTemplateHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs/GETs to host `/courseware/design-templates` for org template CRUD/extract. */
  env.AINOBI_DESIGN_TEMPLATE_HOST_FLUSH = '1';
  env.AINOBI_DESIGN_TEMPLATE_HOST_BASE = `http://127.0.0.1:${port}/courseware/design-templates`;
}

function applyContentTemplateHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs/GETs to host `/courseware/content-templates` for org template CRUD/extract. */
  env.AINOBI_CONTENT_TEMPLATE_HOST_FLUSH = '1';
  env.AINOBI_CONTENT_TEMPLATE_HOST_BASE = `http://127.0.0.1:${port}/courseware/content-templates`;
}

function applyAssetHostFlushEnv(env: NodeJS.ProcessEnv): void {
  /** Sandbox POSTs multipart to host `/courseware/assets/upload` (OSS + DB on the host). */
  env.AINOBI_ASSET_HOST_FLUSH = '1';
  /** Plan/Agent both need asset get for @ library file_id → signed URL. */
  if (!env.AINOBI_COURSEWARE_ASSET_GET_URL?.trim()) {
    env.AINOBI_COURSEWARE_ASSET_GET_URL = `http://127.0.0.1:${port}/courseware/assets/get`;
  }
}

function applyLivePreviewAgentEnv(env: NodeJS.ProcessEnv, accessToken: string): void {
  env.AINOBI_AGENT_API_KEY = accessToken;
  /** CLI skips sandbox-blocked HTTP/Redis publish; host PostToolUse flushes patches. */
  env.AINOBI_LIVE_PREVIEW_HOST_FLUSH = '1';
}

function applyClaudeSdkEnv(
  env: NodeJS.ProcessEnv,
  baseUrl: string,
  model: string | undefined,
  apiKey?: string,
): void {
  const resolvedKey =
    apiKey?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (resolvedKey) {
    env.ANTHROPIC_API_KEY = resolvedKey;
  }
  env.ANTHROPIC_BASE_URL = baseUrl;
  // Loopback bridge addresses bypass HTTP(S)_PROXY: otherwise the CLI might send 127.0.0.1 requests to the proxy
  // (the request fails, and x-api-key leaks to the proxy too). Applies only to http loopback addresses.
  for (const [key, value] of Object.entries(bridgeNoProxyEnvPatch(baseUrl))) {
    env[key] = value;
  }
  if (model) {
    env.ANTHROPIC_MODEL = model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = model;
  }
  for (const key of [
    "API_TIMEOUT_MS",
    "CLAUDE_CODE_MAX_RETRIES",
    "CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS",
  ] as const) {
    const value = process.env[key]?.trim();
    if (value) {
      env[key] = value;
    }
  }
}

function buildClaudeEnv(
  body: ChatRequest,
  baseUrl: string,
  ainobiShellSession: string,
  accessToken: string,
  apiKey?: string,
): NodeJS.ProcessEnv {
  const model = body.model;

  const env = pickAgentSubprocessEnv(process.env, {
    PATH: binPath,
    AINOBI_SHELL_SESSION: ainobiShellSession,
    AINOBI_CLI_RUNTIME: "agent",
    AINOBI_AGENT_API_KEY: accessToken,
    CLAUDE_AGENT_SDK_CLIENT_APP: "ainobi-courseware-agent/0.0.0",
  });
  applyClaudeSdkEnv(env, baseUrl, model, apiKey);

  if (process.platform === "linux" && env.LD_LIBRARY_PATH?.includes("/code")) {
    env.LD_LIBRARY_PATH =
      "/usr/lib/x86_64-linux-gnu:/usr/lib64:/usr/lib:/lib/x86_64-linux-gnu:/lib64:/lib";
  }

  return env;
}
