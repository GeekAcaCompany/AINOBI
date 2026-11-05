// SPDX-License-Identifier: AGPL-3.0-only
import { applyPatch, type Operation } from "fast-json-patch";
import type { CoursewareAssetItem } from "./courseware.ts";
import type { SupportedLanguage, TranslationKey } from "../lib/i18n/index.ts";
import { deserializeScene, serializeScene, type Scene } from "../lib/courseware/index.ts";
import { formatAssetMentionsForDisplay } from "../lib/courseware/ai-asset-mentions.ts";
import { formatCoursewareMentionsForDisplay } from "../lib/courseware/ai-courseware-mentions.ts";
import { formatDesignTemplateMentionsForDisplay } from "../lib/courseware/ai-design-template-mentions.ts";
import type { ReferencedDesignTemplateItem } from "../lib/courseware/ai-design-template-mentions.ts";
import {
  buildManualMarksEditorContextSection,
  type CoursewareManualMarkSession,
} from "../lib/courseware/ai-manual-marks.ts";
import logger from "../host/logger.ts";
import { coursewareApi } from "../host/requester.ts";
import sessionManager from "../host/session-manager.ts";
import { AINOBI_INSUFFICIENT_ORG_CREDITS, AINOBI_INSUFFICIENT_PERSONAL_CREDITS } from "@ainobi/api-contracts/core/credit-errors";

export function isCoursewareApiConfigured(): boolean {
  return Boolean(coursewareApi.baseUrl?.trim());
}

const COURSEWARE_AGENT_OPTS = { responseShape: "agent" as const };
const ASK_DEBUG_STORAGE_KEY = "ainobi:debug:ask";

function isAskDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const on = window.localStorage.getItem(ASK_DEBUG_STORAGE_KEY);
    return on === "1" || on === "true" || on === "on";
  } catch {
    return false;
  }
}

export function logAskDebug(event: string, payload?: Record<string, unknown>): void {
  if (!isAskDebugEnabled()) return;
  logger.info("[AskUserQuestionDebug]", event, {
    ts: Date.now(),
    ...payload,
  });
}

/** Same as the request body of courseware-service `POST /chat` and `POST /chat/stream` (see that service's `ChatRequest`). */
export type CoursewareAgentChatStreamBody = {
  /** User input (the sidebar display and the transcript user line keep only this part) */
  prompt?: string;
  message?: string;
  /**
   * Courseware editor context (current page, selected elements, @ resources, etc.).
   * Built by `buildCoursewareAgentEditorContext`; feeds the agent's reasoning this turn and is written to the transcript but not echoed to the frontend.
   */
  editorContext?: string;
  /** session_id returned by the Claude Agent SDK, required to continue the conversation */
  sessionId?: string;
  /** The server-side courseware_conversation row id, returned by SSE on the first turn and sent back to keep the workspace and transcript stable */
  conversationId?: string;
  /** Courseware business key, used to link the courseware row when creating a conversation */
  coursewareKey?: string;
  /** Courseware table uuid; used to preload the DB snapshot and ainobi load; usually the same string as the key of `GET/PUT /courseware?key=` */
  coursewareId?: string;
  /** section_id on the URL when the editor is opened from course management; lets the agent mount the chapter knowledge base */
  sectionId?: string;
  /** course_id on the URL when the editor is opened from course management */
  courseId?: string;
  livePreviewSessionId?: string;
  /** Stream id of each assistant run; POST mirrors it to Redis, and after a disconnect GET `/chat/stream` resumes reading */
  chatStreamSessionId?: string;
  model?: string;
  /** Override the model gateway (by default the agent service reads ANTHROPIC_BASE_URL) */
  baseUrl?: string;
  maxTurns?: number;
  permissionMode?: string;
  /** When true, forces a new courseware_conversation (courseware-service) */
  newConversation?: boolean;
  /** Editor UI language (zh/en/ja); the conversation title LLM prefers this language */
  preferredUiLanguage?: string;
  /** Default courseware generation language (zh/en/ja); controls the language of new text and content output. */
  language?: string;
  /** Conversation kind: `agent` (default) or `plan`; separates conversations by kind (Plan/Agent each with their own history) */
  conversationKind?: "agent" | "plan";
  /** Plan mode: the planner persona that only converses to produce a design draft and never rewrites the courseware; when true the backend forces kind=plan */
  planMode?: boolean;
  /**
   * Other coursewares the user @-referenced from the courseware library; the agent service preloads them as `./reference/*.scene.json` in the workspace.
   * `jsonUrl` may be omitted (the host fetches it from the DB).
   */
  referencedCourseware?: readonly CoursewareAgentReferencedCoursewareWire[];
  referencedDesignTemplates?: readonly CoursewareAgentReferencedDesignTemplateWire[];
  referencedContentTemplates?: readonly CoursewareAgentReferencedContentTemplateWire[];
};

export type CoursewareAgentReferencedDesignTemplateWire = {
  id: string;
  name: string;
};

export type CoursewareAgentReferencedContentTemplateWire = {
  id: string;
  name: string;
};

/** A reference courseware entry in the `POST /chat/stream` request body (wire format). */
export type CoursewareAgentReferencedCoursewareWire = {
  id: string;
  key: string;
  title: string;
  jsonUrl?: string;
  courseId?: string;
  courseTitle?: string;
};

const COURSEWARE_AGENT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returned only when the string is a valid uuid, otherwise undefined (avoids the agent returning 400 Unknown coursewareId). */
export function coursewareAgentApiCoursewareIdOrUndefined(
  id: string | null | undefined,
): string | undefined {
  const t = id?.trim();
  if (!t || !COURSEWARE_AGENT_UUID_RE.test(t)) return undefined;
  return t;
}

/**
 * Build the courseware assistant's streaming request body; empty fields are omitted for JSON serialization.
 */
export function buildCoursewareAgentChatStreamBody(params: {
  prompt: string;
  editorContext?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
  coursewareKey?: string | null;
  coursewareId?: string | null;
  sectionId?: string | null;
  courseId?: string | null;
  livePreviewSessionId?: string | null;
  chatStreamSessionId?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  maxTurns?: number | null;
  permissionMode?: string | null;
  newConversation?: boolean;
  preferredUiLanguage?: string | null;
  language?: string | null;
  conversationKind?: "agent" | "plan" | null;
  planMode?: boolean;
  referencedCourseware?: readonly CoursewareAgentReferencedCoursewareWire[] | null;
  referencedDesignTemplates?: readonly CoursewareAgentReferencedDesignTemplateWire[] | null;
  referencedContentTemplates?: readonly CoursewareAgentReferencedContentTemplateWire[] | null;
}): CoursewareAgentChatStreamBody {
  const planMode = params.planMode === true;
  const body: CoursewareAgentChatStreamBody = {
    prompt: params.prompt,
    permissionMode: params.permissionMode?.trim() || "default",
  };
  if (planMode) {
    body.planMode = true;
  }
  const conversationKind =
    params.conversationKind === "plan" || planMode
      ? "plan"
      : params.conversationKind === "agent"
        ? "agent"
        : undefined;
  if (conversationKind) {
    body.conversationKind = conversationKind;
  }
  const editorContext = params.editorContext?.trim();
  if (editorContext) {
    body.editorContext = editorContext;
  }
  if (params.maxTurns != null && Number.isFinite(params.maxTurns)) {
    body.maxTurns = Math.floor(params.maxTurns);
  }
  const sid = params.sessionId?.trim();
  if (sid) body.sessionId = sid;
  const cid = params.conversationId?.trim();
  if (cid) body.conversationId = cid;
  const ck = params.coursewareKey?.trim();
  if (ck) body.coursewareKey = ck;
  const cw = coursewareAgentApiCoursewareIdOrUndefined(params.coursewareId ?? undefined);
  if (cw) body.coursewareId = cw;
  // Always pass URL value as coursewareKey so agent can resolve key→id even when
  // coursewareId was filtered / equals the business key string.
  const keyFromId = params.coursewareId?.trim();
  const explicitKey = params.coursewareKey?.trim();
  const coursewareKey = explicitKey || keyFromId;
  if (coursewareKey) body.coursewareKey = coursewareKey;
  const sectionId = coursewareAgentApiCoursewareIdOrUndefined(params.sectionId ?? undefined);
  if (sectionId) body.sectionId = sectionId;
  const courseId = coursewareAgentApiCoursewareIdOrUndefined(params.courseId ?? undefined);
  if (courseId) body.courseId = courseId;
  const lp = params.livePreviewSessionId?.trim();
  if (lp) body.livePreviewSessionId = lp;
  const cs = params.chatStreamSessionId?.trim();
  if (cs) body.chatStreamSessionId = cs;
  const model = params.model?.trim();
  if (model) body.model = model;
  const bu = params.baseUrl?.trim();
  if (bu) body.baseUrl = bu;
  if (params.newConversation === true) body.newConversation = true;
  const lang = params.preferredUiLanguage?.trim();
  if (lang === "zh" || lang === "en" || lang === "ja") {
    body.preferredUiLanguage = lang;
  }
  const generationLanguage = params.language?.trim();
  if (
    generationLanguage === "zh" ||
    generationLanguage === "en" ||
    generationLanguage === "ja"
  ) {
    body.language = generationLanguage;
  }
  const refs = params.referencedCourseware?.filter((cw) => cw.key?.trim() && cw.title?.trim()) ?? [];
  if (refs.length > 0) {
    body.referencedCourseware = refs.map((cw) => ({
      id: cw.id,
      key: cw.key,
      title: cw.title,
      ...(cw.courseId ? { courseId: cw.courseId } : {}),
      ...(cw.courseTitle ? { courseTitle: cw.courseTitle } : {}),
    }));
  }
  const designTemplates =
    params.referencedDesignTemplates?.filter((item) => item.id?.trim() && item.name?.trim()) ?? [];
  if (designTemplates.length > 0) {
    body.referencedDesignTemplates = designTemplates.map((item) => ({
      id: item.id,
      name: item.name,
    }));
  }
  const contentTemplates =
    params.referencedContentTemplates?.filter((item) => item.id?.trim() && item.name?.trim()) ?? [];
  if (contentTemplates.length > 0) {
    body.referencedContentTemplates = contentTemplates.map((item) => ({
      id: item.id,
      name: item.name,
    }));
  }
  return body;
}

const COURSEWARE_AGENT_UPDATED_AT_KEYS = [
  "updatedAt",
  "updated_at",
  "coursewareUpdatedAt",
  "courseware_updated_at",
  "serverUpdatedAt",
  "server_updated_at",
] as const;

/** Read the server courseware `updatedAt` (ISO) from the agent SSE / patch payload, to refresh the optimistic lock base. */
export function readCoursewareAgentUpdatedAtIso(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const rec = payload as Record<string, unknown>;
  for (const key of COURSEWARE_AGENT_UPDATED_AT_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const inner = rec.payload;
  if (inner && typeof inner === "object") {
    return readCoursewareAgentUpdatedAtIso(inner);
  }
  return undefined;
}

/** Monotonically advance the editor's `baseUpdatedAt` (without changing the scene content or the saved snapshot). */
export function bumpCoursewareAgentBaseUpdatedAt(
  ref: { current: string | null },
  candidateIso: string,
): void {
  const next = candidateIso.trim();
  if (!next) return;
  const prev = ref.current?.trim();
  if (!prev) {
    ref.current = next;
    return;
  }
  const nextMs = Date.parse(next);
  const prevMs = Date.parse(prev);
  if (!Number.isNaN(nextMs) && !Number.isNaN(prevMs)) {
    if (nextMs >= prevMs) ref.current = next;
    return;
  }
  if (next >= prev) ref.current = next;
}

/** Read the conversation fields the agent returns from SSE data (ready / message / done may all carry them). */
export function readCoursewareAgentSseSessionFields(payload: unknown): {
  sessionId?: string;
  conversationId?: string;
  chatStreamSessionId?: string;
} {
  if (!payload || typeof payload !== "object") return {};
  const rec = payload as Record<string, unknown>;
  const sessionId = typeof rec.sessionId === "string" && rec.sessionId.trim() ? rec.sessionId.trim() : undefined;
  const conversationId =
    typeof rec.conversationId === "string" && rec.conversationId.trim()
      ? rec.conversationId.trim()
      : undefined;
  const chatStreamSessionId =
    typeof rec.chatStreamSessionId === "string" && rec.chatStreamSessionId.trim()
      ? rec.chatStreamSessionId.trim()
      : undefined;
  return { sessionId, conversationId, chatStreamSessionId };
}

/** Courseware DTO returned by courseware-service `GET/PUT /courseware?key=` (excerpt). */
export type CoursewareAgentPersistedDto = {
  key: string;
  /**
   * ID of the organization the courseware belongs to.
   * It may differ from `current_org_id` (the organization selected in the session),
   * so courseware-scoped APIs (the AI teacher list etc.) use this value first.
   */
  orgId?: string;
  title: string | null;
  coverUrl?: string | null;
  content: Record<string, unknown>;
  updatedAt: string;
  /** Visible within the organization; `false` locks student preview and editing (the editor is exempt with `canManage`) */
  isPublic?: boolean;
  isShare?: boolean;
  /** The current user has management rights over the courseware's organization (member or managed_list) */
  canManage?: boolean;
};

export type CoursewareAgentPersistenceResponse = {
  ok: boolean;
  courseware?: CoursewareAgentPersistedDto;
  error?: string;
  /** Present on HTTP 409 optimistic-lock conflict from PUT /courseware */
  serverUpdatedAt?: string;
  baseUpdatedAt?: string;
};

export type CoursewareVersionSummaryDto = {
  id: string;
  revision: number;
  createdAt: string;
};

export type CoursewareVersionsListResponse = {
  ok: boolean;
  key?: string;
  versions?: CoursewareVersionSummaryDto[];
  error?: string;
};

export function coursewareRemoteHasVersionHistory(
  list: Pick<CoursewareVersionsListResponse, "ok" | "versions">,
): boolean {
  return Boolean(list.ok && (list.versions?.length ?? 0) > 0);
}

export type CoursewareAgentCoverUploadResponse = {
  ok: boolean;
  coverUrl?: string;
  filePath?: string;
  /** The courseware's current `updatedAt` after upload (for the editor to sync its optimistic lock without fetching the full content). */
  updatedAt?: string;
  error?: string;
};

export function isCoursewareVersionConflictResponse(
  result: Pick<CoursewareAgentPersistenceResponse, "ok" | "error">,
): boolean {
  return result.ok === false && Boolean(result.error?.toLowerCase().includes("version conflict"));
}

export type CoursewareStreamEvent = {
  event_type: "scene.patch";
  live_preview_session_id: string;
  cli_session_id: string;
  scene_id: string;
  created_at: string;
  patch: unknown[];
};

export type AgentChatStreamState = {
  seenTextBlocks: Set<string>;
  seenToolIds: Set<string>;
  toolNamesById: Map<string, string>;
};

export const createAgentChatStreamState = (): AgentChatStreamState => ({
  seenTextBlocks: new Set(),
  seenToolIds: new Set(),
  toolNamesById: new Map(),
});

export type CoursewareAgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type CoursewareAgentTodoItem = {
  id?: string;
  content: string;
  status: CoursewareAgentTodoStatus;
};

export type CoursewareAgentUserQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

export type CoursewareAgentUserQuestion = {
  question: string;
  header: string;
  options: CoursewareAgentUserQuestionOption[];
  multiSelect: boolean;
  /** Ainobi extension: when true the host answers with a free input box and shows no option list */
  freeText?: boolean;
};

/** SSE `event: ui` payload: fields match courseware-service's `chat-ui-events.ts` */
export type HomeIntentCardUiKind =
  | "create"
  | "persona"
  | "preview"
  | "review"
  | "learn"
  | "practice"
  | "join"
  | "teach"
  | "report"
  | "manage"
  | "schedule";

export type HomeIntentCardUiPayload = {
  courseId?: string;
  courseName?: string;
  orgId?: string;
  nextSectionName?: string | null;
  nextChapterId?: string | null;
  nextSectionId?: string | null;
  targetSectionName?: string | null;
  targetChapterId?: string | null;
  targetSectionId?: string | null;
  topic?: string;
  contentBrief?: string;
  teachEmpty?: boolean;
  personaName?: string;
  modelId?: string;
  language?: string;
  personalityTags?: string[];
  customPrompt?: string;
  inviteCode?: string;
};

export type CoursewareAgentChatUiEvent =
  | { kind: "prose"; text: string }
  | { kind: "insufficient_org_credits" }
  | { kind: "insufficient_personal_credits" }
  | { kind: "agent_context_reset_required" }
  | { kind: "todos_update"; todos: CoursewareAgentTodoItem[]; merge?: boolean }
  | {
      kind: "user_question";
      requestId: string;
      toolUseId: string;
      questions: CoursewareAgentUserQuestion[];
    }
  | { kind: "user_question_answered"; requestId: string }
  | {
      kind: "intent_card";
      card: HomeIntentCardUiKind;
      bubble?: string;
      payload?: HomeIntentCardUiPayload;
    }
  | {
      kind: "tool_start";
      toolUseId: string;
      toolName: string;
      title: string;
      command?: string;
    }
  | { kind: "tool_output"; toolUseId: string; output: string };

/** Sidebar assistant message block (persisted + rendered) */
export type CoursewareAiAssistantBlock =
  | { type: "prose"; text: string }
  | { type: "insufficient_org_credits" }
  | { type: "insufficient_personal_credits" }
  | { type: "agent_context_reset_required" }
  | { type: "todos"; items: CoursewareAgentTodoItem[] }
  | {
      type: "user_question";
      requestId: string;
      toolUseId: string;
      questions: CoursewareAgentUserQuestion[];
      answered?: boolean;
      /** The requestId became invalid after the stream was interrupted / a new turn started */
      expired?: boolean;
    }
  | {
      type: "tool";
      id: string;
      toolName: string;
      title: string;
      command?: string;
      output?: string;
    };

function isTodoWriteToolName(name: string): boolean {
  return /todo/i.test(name);
}

/** AskUserQuestion is handled by the user_question UI card, so no tool name action bar is shown */
function isAskUserQuestionToolName(name: string): boolean {
  return name === "AskUserQuestion";
}

function isShowHomeIntentCardToolName(name: string): boolean {
  return name === "ShowHomeIntentCard" || name.endsWith("__ShowHomeIntentCard");
}

/** Fixed success text returned by tools such as TodoWrite; the agent may still send `tool_output` SSE, which would become an orphan "action" card since no tool card was created */
function isTodoToolResultOutputNoise(output: string): boolean {
  const t = output.trim().toLowerCase();
  if (!t) return false;
  if (t.includes("todos have been modified successfully")) return true;
  if (t.includes("todo list") && (t.includes("track your progress") || t.includes("tracking your progress")))
    return true;
  return false;
}

function normalizeTodoStatus(raw: string): CoursewareAgentTodoStatus {
  if (raw === "in_progress" || raw === "completed" || raw === "cancelled") return raw;
  return "pending";
}

export function parseTodoWriteToolInput(
  input: unknown,
): { todos: CoursewareAgentTodoItem[]; merge: boolean } | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if (!Array.isArray(rec.todos)) return null;
  const merge = rec.merge === true;
  const todos: CoursewareAgentTodoItem[] = [];
  for (const raw of rec.todos) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) continue;
    const status = normalizeTodoStatus(typeof item.status === "string" ? item.status : "pending");
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined;
    todos.push(id ? { id, content, status } : { content, status });
  }
  return { todos, merge };
}

/** UI / SSE `todos_update`: tolerates missing `status` and `id`, consistent with parseTodoWrite */
function sanitizeTodosFromUiPayload(items: unknown): CoursewareAgentTodoItem[] {
  if (!Array.isArray(items)) return [];
  const out: CoursewareAgentTodoItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) continue;
    const status = normalizeTodoStatus(typeof item.status === "string" ? item.status : "pending");
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined;
    out.push(id ? { id, content, status } : { content, status });
  }
  return out;
}

function mergeTodoItems(
  existing: readonly CoursewareAgentTodoItem[],
  incoming: readonly CoursewareAgentTodoItem[],
): CoursewareAgentTodoItem[] {
  const byId = new Map<string, CoursewareAgentTodoItem>();
  const order: string[] = [];
  const keyFor = (item: CoursewareAgentTodoItem, index: number): string =>
    item.id?.trim() || `__${index}_${item.content}`;

  existing.forEach((item, index) => {
    const key = keyFor(item, index);
    byId.set(key, item);
    order.push(key);
  });

  incoming.forEach((item, index) => {
    if (item.id && byId.has(item.id)) {
      byId.set(item.id, { ...byId.get(item.id)!, ...item });
      return;
    }
    const key = keyFor(item, existing.length + index);
    if (byId.has(key)) {
      byId.set(key, { ...byId.get(key)!, ...item });
      return;
    }
    byId.set(key, item);
    order.push(key);
  });

  return order.map((key) => byId.get(key)!);
}

function findLastTodosBlockIndex(blocks: readonly CoursewareAiAssistantBlock[]): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.type === "todos") return i;
  }
  return -1;
}

function formatTodoItemsPlainText(items: readonly CoursewareAgentTodoItem[]): string {
  const mark = (status: CoursewareAgentTodoStatus): string => {
    if (status === "completed") return "[x]";
    if (status === "cancelled") return "[-]";
    if (status === "in_progress") return "[~]";
    return "[ ]";
  };
  const lines = items.map((item) => `${mark(item.status)} ${item.content}`);
  return lines.length > 0 ? `Tasks\n${lines.join("\n")}` : "";
}

export function isTodoToolAssistantBlock(block: CoursewareAiAssistantBlock): boolean {
  return block.type === "tool" && isTodoWriteToolName(block.toolName);
}

export function isAskUserQuestionToolAssistantBlock(block: CoursewareAiAssistantBlock): boolean {
  return block.type === "tool" && isAskUserQuestionToolName(block.toolName);
}

function isCoursewareAgentChatUiEvent(value: unknown): value is CoursewareAgentChatUiEvent {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (rec.kind === "prose") return typeof rec.text === "string";
  if (rec.kind === "insufficient_org_credits") return true;
  if (rec.kind === "insufficient_personal_credits") return true;
  if (rec.kind === "agent_context_reset_required") return true;
  if (rec.kind === "tool_start") {
    return (
      typeof rec.toolUseId === "string" &&
      typeof rec.toolName === "string" &&
      typeof rec.title === "string"
    );
  }
  if (rec.kind === "tool_output") {
    return typeof rec.toolUseId === "string" && typeof rec.output === "string";
  }
  if (rec.kind === "todos_update") {
    return Array.isArray(rec.todos) && sanitizeTodosFromUiPayload(rec.todos).length > 0;
  }
  if (rec.kind === "user_question") {
    return (
      typeof rec.requestId === "string" &&
      typeof rec.toolUseId === "string" &&
      Array.isArray(rec.questions) &&
      rec.questions.length > 0
    );
  }
  if (rec.kind === "user_question_answered") {
    return typeof rec.requestId === "string";
  }
  if (rec.kind === "intent_card") {
    return typeof rec.card === "string";
  }
  return false;
}

/** Flow placeholder items in student practice cards (not knowledge options) */
export function isAskUserQuestionProcessOptionLabel(label: string): boolean {
  const n = label.replace(/\s+/g, "").toLowerCase();
  if (!n) return true;
  const exact = new Set([
    "跳过本题",
    "需要提示",
    "我来回答",
    "我来作答",
    "其他/填写答案",
    "跳过，看讲解",
    "跳过看讲解",
    "直接看讲解",
    "先自己想",
    "この問題をスキップ",
    "ヒントがほしい",
    "自分で答える",
    "解説を見る",
    "まず自分で考える",
    "skipthisquestion",
    "skipquestion",
    "needahint",
    "needhint",
    "i'llanswer",
    "illanswer",
    "showexplanation",
    "thinkfirst",
  ]);
  if (exact.has(n)) return true;
  return (
    n.includes("跳过本题") ||
    n.includes("需要提示") ||
    n.includes("我来回答") ||
    n.includes("我来作答") ||
    n.includes("填写答案") ||
    n.includes("直接看讲解") ||
    n.includes("スキップ") ||
    n.includes("ヒント") ||
    n.includes("解説を見る") ||
    n.includes("skipthis") ||
    n.includes("needahint") ||
    n.includes("showexplanation")
  );
}

function sanitizeUserQuestionsFromUiPayload(items: unknown): CoursewareAgentUserQuestion[] {
  if (!Array.isArray(items)) return [];
  const out: CoursewareAgentUserQuestion[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const question = typeof rec.question === "string" ? rec.question.trim() : "";
    const header = typeof rec.header === "string" ? rec.header.trim() : "";
    if (!question || !header) continue;
    const options: CoursewareAgentUserQuestionOption[] = [];
    if (Array.isArray(rec.options)) {
      for (const opt of rec.options) {
        if (!opt || typeof opt !== "object") continue;
        const o = opt as Record<string, unknown>;
        const label = typeof o.label === "string" ? o.label.trim() : "";
        const description = typeof o.description === "string" ? o.description.trim() : "";
        if (!label) continue;
        const preview =
          typeof o.preview === "string" && o.preview.trim() ? o.preview.trim() : undefined;
        options.push({ label, description, preview });
      }
    }
    // freeText: keep the description and option parsing for the editor; the practice server clears description itself
    if (rec.freeText === true) {
      out.push({
        question,
        header,
        options: [],
        multiSelect: false,
        freeText: true,
      });
      continue;
    }
    if (options.length < 2) continue;
    out.push({
      question,
      header,
      options,
      multiSelect: rec.multiSelect === true,
    });
  }
  return out;
}

function userQuestionSignature(questions: readonly CoursewareAgentUserQuestion[]): string {
  return questions
    .map((q) => {
      const optionsSig = q.options
        .map((o) => `${o.label.trim()}|${o.description.trim()}|${(o.preview ?? "").trim()}`)
        .join("||");
      return [
        q.header.trim(),
        q.question.trim(),
        q.multiSelect ? "multi" : "single",
        q.freeText ? "freeText" : "choice",
        optionsSig,
      ].join("::");
    })
    .join("\n---\n");
}

function isSessionScopedRequestId(requestId: string): boolean {
  return requestId.trim().startsWith("session:");
}

function choosePreferredRequestId(existing: string, incoming: string): string {
  const a = existing.trim();
  const b = incoming.trim();
  if (!a) return b;
  if (!b) return a;
  const aSession = isSessionScopedRequestId(a);
  const bSession = isSessionScopedRequestId(b);
  // Prefer the conversation-scoped requestId; the session: prefix 404s on some turns.
  if (!aSession && bSession) return a;
  if (aSession && !bSession) return b;
  // For the same kind of prefix, keep the latest value.
  return b;
}

/** Parse the data of an SSE `ui` event */
export function parseCoursewareAgentChatUiSsePayload(payload: unknown): CoursewareAgentChatUiEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const rec = payload as Record<string, unknown>;
  if (Array.isArray(rec.events)) {
    return rec.events.filter(isCoursewareAgentChatUiEvent);
  }
  if (isCoursewareAgentChatUiEvent(rec)) return [rec];
  return [];
}

function proseBlockAlreadyContains(blockText: string, text: string): boolean {
  const base = blockText.trim();
  const piece = text.trim();
  if (!piece) return true;
  if (base === piece) return true;
  if (base.startsWith(`${piece}\n\n`) || base.endsWith(`\n\n${piece}`)) return true;
  return base.includes(`\n\n${piece}\n\n`);
}

/** Merge UI events into the assistant message block list */
export function applyCoursewareAgentChatUiEvents(
  blocks: readonly CoursewareAiAssistantBlock[],
  events: readonly CoursewareAgentChatUiEvent[],
): CoursewareAiAssistantBlock[] {
  const next: CoursewareAiAssistantBlock[] = [...blocks];
  for (const ev of events) {
    if (ev.kind === "insufficient_org_credits") {
      if (!next.some((b) => b.type === "insufficient_org_credits")) {
        next.push({ type: "insufficient_org_credits" });
      }
      continue;
    }
    if (ev.kind === "insufficient_personal_credits") {
      if (!next.some((b) => b.type === "insufficient_personal_credits")) {
        next.push({ type: "insufficient_personal_credits" });
      }
      continue;
    }
    if (ev.kind === "agent_context_reset_required") {
      if (!next.some((b) => b.type === "agent_context_reset_required")) {
        next.push({ type: "agent_context_reset_required" });
      }
      continue;
    }
    if (ev.kind === "prose") {
      const text = ev.text.trim();
      if (!text) continue;
      const last = next[next.length - 1];
      if (last?.type === "prose") {
        if (proseBlockAlreadyContains(last.text, text)) continue;
        next[next.length - 1] = { type: "prose", text: `${last.text}\n\n${text}` };
      } else {
        const existingProse = next.find((b) => b.type === "prose" && proseBlockAlreadyContains(b.text, text));
        if (existingProse) continue;
        next.push({ type: "prose", text });
      }
      continue;
    }
    if (ev.kind === "user_question") {
      const questions = sanitizeUserQuestionsFromUiPayload(ev.questions);
      if (questions.length === 0) continue;
      logAskDebug("ui.user_question.received", {
        requestId: ev.requestId,
        toolUseId: ev.toolUseId,
        questionCount: questions.length,
      });
      const signature = userQuestionSignature(questions);
      // SSE reconnects/retries may give a new requestId with exactly the same question; overwrite the old card then to avoid rendering it twice.
      const sameQuestionIdx = next.findIndex(
        (b) =>
          b.type === "user_question" &&
          userQuestionSignature(b.questions) === signature,
      );
      const block = {
        type: "user_question" as const,
        requestId: ev.requestId,
        toolUseId: ev.toolUseId,
        questions,
        answered: false,
      };
      if (sameQuestionIdx >= 0) {
        const existing = next[sameQuestionIdx];
        if (existing?.type === "user_question") {
          const requestId = choosePreferredRequestId(existing.requestId, ev.requestId);
          // A replay of the same question (SSE reconnect / resend) inherits the local locked state, so the button doesn't flicker clickable.
          next[sameQuestionIdx] = {
            ...block,
            requestId,
            answered: existing.answered || block.answered,
            ...(existing.expired ? { expired: true } : {}),
          };
          logAskDebug("ui.user_question.same_signature_merged", {
            requestId,
            mergedFromRequestId: existing.requestId,
            incomingRequestId: ev.requestId,
            answeredInherited: Boolean(existing.answered),
            expiredInherited: Boolean(existing.expired),
          });
        } else {
          next[sameQuestionIdx] = block;
        }
        continue;
      }
      // Only the last question of a turn may be answered: when a new question arrives, earlier unsubmitted ones are marked expired.
      for (let i = 0; i < next.length; i += 1) {
        const prev = next[i];
        if (
          prev?.type === "user_question" &&
          prev.requestId !== ev.requestId &&
          !prev.answered &&
          !prev.expired
        ) {
          next[i] = { ...prev, expired: true };
          logAskDebug("ui.user_question.previous_expired", {
            expiredRequestId: prev.requestId,
            activeRequestId: ev.requestId,
          });
        }
      }
      const idx = next.findIndex(
        (b) => b.type === "user_question" && b.requestId === ev.requestId,
      );
      if (idx >= 0) {
        const existing = next[idx];
        if (existing?.type === "user_question") {
          const requestId = choosePreferredRequestId(existing.requestId, ev.requestId);
          next[idx] = {
            ...block,
            requestId,
            answered: existing.answered || block.answered,
            ...(existing.expired ? { expired: true } : {}),
          };
          logAskDebug("ui.user_question.same_request_updated", {
            requestId,
            incomingRequestId: ev.requestId,
            answeredInherited: Boolean(existing.answered),
            expiredInherited: Boolean(existing.expired),
          });
        } else {
          next[idx] = block;
        }
      } else {
        next.push(block);
        logAskDebug("ui.user_question.appended", {
          requestId: ev.requestId,
          questionCount: questions.length,
        });
      }
      continue;
    }
    if (ev.kind === "user_question_answered") {
      const idx = next.findIndex(
        (b) => b.type === "user_question" && b.requestId === ev.requestId,
      );
      if (idx >= 0) {
        const block = next[idx];
        if (block.type === "user_question") {
          next[idx] = { ...block, answered: true };
          logAskDebug("ui.user_question.answered_event", {
            requestId: ev.requestId,
          });
        }
      }
      continue;
    }
    if (ev.kind === "todos_update") {
      const items = sanitizeTodosFromUiPayload(ev.todos);
      if (items.length === 0) continue;
      const merge = ev.merge === true;
      const todosIdx = findLastTodosBlockIndex(next);
      if (merge && todosIdx >= 0) {
        const block = next[todosIdx];
        if (block.type === "todos") {
          next[todosIdx] = { type: "todos", items: mergeTodoItems(block.items, items) };
        }
      } else if (!merge && todosIdx >= 0) {
        next[todosIdx] = { type: "todos", items: [...items] };
      } else {
        next.push({ type: "todos", items: [...items] });
      }
      continue;
    }
    if (ev.kind === "tool_start") {
      if (isTodoWriteToolName(ev.toolName) || isAskUserQuestionToolName(ev.toolName)) continue;
      const idx = next.findIndex((b) => b.type === "tool" && b.id === ev.toolUseId);
      if (idx >= 0) continue;
      let title = ev.title.trim();
      if (isRawJsonLikeToolTitle(title)) {
        title = fallbackOpsCardTitleFromToolName(ev.toolName);
      }
      next.push({
        type: "tool",
        id: ev.toolUseId,
        toolName: ev.toolName,
        title,
        command: ev.command,
      });
      continue;
    }
    if (ev.kind === "tool_output") {
      if (isTodoToolResultOutputNoise(ev.output)) continue;
      const output = prettifyToolOutputText(ev.output);
      const idx = next.findIndex((b) => b.type === "tool" && b.id === ev.toolUseId);
      if (idx >= 0) {
        const tool = next[idx];
        if (tool.type === "tool") {
          if (isAskUserQuestionToolName(tool.toolName)) continue;
          next[idx] = { ...tool, output };
        }
      } else {
        next.push({
          type: "tool",
          id: ev.toolUseId,
          toolName: "tool",
          title: "Tool",
          output,
        });
      }
    }
  }
  return next;
}

/** Plain text fallback generated from blocks (storage / old UI) */
export function coursewareAiAssistantBlocksToPlainText(blocks: readonly CoursewareAiAssistantBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "prose") {
      parts.push(block.text);
      continue;
    }
    if (block.type === "insufficient_org_credits") {
      parts.push("Insufficient organization credits");
      continue;
    }
    if (block.type === "insufficient_personal_credits") {
      parts.push("Insufficient personal credits");
      continue;
    }
    if (block.type === "agent_context_reset_required") {
      parts.push("Assistant context is too large. Clear the assistant history and retry.");
      continue;
    }
    if (block.type === "todos") {
      const text = formatTodoItemsPlainText(block.items);
      if (text) parts.push(text);
      continue;
    }
    if (block.type === "user_question") {
      const lines = block.questions.map((q) => `? ${q.header}: ${q.question}`);
      parts.push(`${block.answered ? "Confirmed" : "Pending confirmation"}\n${lines.join("\n")}`);
      continue;
    }
    if (isTodoToolAssistantBlock(block)) continue;
    if (isAskUserQuestionToolAssistantBlock(block)) continue;
    parts.push(`· ${block.toolName}: ${block.title}`);
    if (block.command) parts.push(`  $ ${block.command}`);
    if (block.output) parts.push(`  → ${block.output}`);
  }
  return parts.join("\n\n").trim();
}

/** After the stream ends/is interrupted, unanswered AskUserQuestions are marked expired, so stale requestIds aren't submitted. */
export function expireUnresolvedUserQuestionBlocks(
  blocks: CoursewareAiAssistantBlock[] | undefined,
): CoursewareAiAssistantBlock[] | undefined {
  if (!blocks?.length) return blocks;
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== "user_question" || block.answered || block.expired) return block;
    changed = true;
    return { ...block, expired: true };
  });
  return changed ? next : blocks;
}

export function expireUnresolvedUserQuestionsInMessages<
  T extends { blocks?: CoursewareAiAssistantBlock[] },
>(messages: T[]): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!message.blocks?.length) return message;
    const nextBlocks = expireUnresolvedUserQuestionBlocks(message.blocks);
    if (nextBlocks === message.blocks) return message;
    changed = true;
    return { ...message, blocks: nextBlocks };
  });
  return changed ? next : messages;
}

export type CoursewareAgentElementBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CoursewareAgentSelectedElement = {
  element_id: string;
  element_type: string;
  /** Editor layer name (from the element's `name` field) */
  element_name?: string;
  /** Carries the `text` field content when `element_type: "text"` */
  text_content?: string;
  /** Canvas logical coordinates (top-level element position/size) */
  box?: CoursewareAgentElementBox;
  /** With `element_type: "quiz"`, links to `scene.quiz.questions[].question_id` */
  quiz_question_id?: string;
};

export type CoursewareAgentQuizElementOnSlide = {
  element_id: string;
  box: CoursewareAgentElementBox;
  quiz_question_id?: string;
};

type SlideChildForAgentSelection = Pick<CoursewareAgentSelectedElement, "element_id" | "element_type"> & {
  name?: unknown;
  text?: unknown;
  position?: { x?: unknown; y?: unknown };
  size?: { width?: unknown; height?: unknown };
  quiz_question_id?: unknown;
};

function elementNameFromSlideChild(el: SlideChildForAgentSelection): string | undefined {
  if (typeof el.name !== "string") return undefined;
  const trimmed = el.name.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function textContentFromSlideChild(el: SlideChildForAgentSelection): string | undefined {
  if (el.element_type !== "text" || typeof el.text !== "string") return undefined;
  const trimmed = el.text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function readElementBoxFromSlideChild(el: SlideChildForAgentSelection): CoursewareAgentElementBox | undefined {
  const x = readFiniteNumber(el.position?.x);
  const y = readFiniteNumber(el.position?.y);
  const width = readFiniteNumber(el.size?.width);
  const height = readFiniteNumber(el.size?.height);
  if (x == null || y == null || width == null || height == null) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function quizQuestionIdFromSlideChild(el: SlideChildForAgentSelection): string | undefined {
  if (el.element_type !== "quiz" || typeof el.quiz_question_id !== "string") return undefined;
  const trimmed = el.quiz_question_id.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatCoursewareAgentElementBox(box: CoursewareAgentElementBox): string {
  return `${Math.round(box.width)}×${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})`;
}

function formatCoursewareAgentSelectedElementFields(
  el: CoursewareAgentSelectedElement,
  separator: "，" | " | ",
): string {
  const parts = [`element_type: ${el.element_type}`, `element_id: ${el.element_id}`];
  if (el.element_name) parts.push(`element_name: ${JSON.stringify(el.element_name)}`);
  if (el.box) parts.push(`box: ${formatCoursewareAgentElementBox(el.box)}`);
  if (el.quiz_question_id) parts.push(`quiz_question_id: ${el.quiz_question_id}`);
  if (el.text_content) parts.push(`text_content: ${JSON.stringify(el.text_content)}`);
  return parts.join(separator);
}

/** Resolve the current page's elements in canvas selection order (top-level children_elements only). */
export function resolveCoursewareAgentSelectedElements(
  slideChildren: readonly SlideChildForAgentSelection[] | undefined,
  selectedElementIds: readonly string[],
): CoursewareAgentSelectedElement[] {
  if (!slideChildren?.length || selectedElementIds.length === 0) return [];
  const byId = new Map(slideChildren.map((el) => [el.element_id, el]));
  const out: CoursewareAgentSelectedElement[] = [];
  for (const id of selectedElementIds) {
    const el = byId.get(id);
    if (!el) continue;
    const element_name = elementNameFromSlideChild(el);
    const text_content = textContentFromSlideChild(el);
    const box = readElementBoxFromSlideChild(el);
    const quiz_question_id = quizQuestionIdFromSlideChild(el);
    out.push({
      element_id: el.element_id,
      element_type: el.element_type,
      ...(element_name ? { element_name } : {}),
      ...(box ? { box } : {}),
      ...(quiz_question_id ? { quiz_question_id } : {}),
      ...(text_content ? { text_content } : {}),
    });
  }
  return out;
}

export type CoursewareAgentReferencedCourseware = {
  id: string;
  key: string;
  title: string;
  jsonUrl: string;
  courseId?: string;
  courseTitle?: string;
};

export type CoursewareAgentPromptPartsArgs = {
  text: string;
  slideJson: string;
  pageIndex: number;
  totalPages: number;
  /** The editor's current courseware id; @ asset library items belong to this courseware (same as the list API's coursewareId). */
  libraryCoursewareId?: string | null;
  /** element_id of the current page's slide */
  currentSlideId?: string | null;
  /** Count of the current page's top-level children_elements; parsed from slideJson when not passed */
  currentSlideChildCount?: number;
  /** UI language set in the editor toolbar; agent replies and new courseware text prefer this language */
  preferredUiLanguage?: SupportedLanguage;
  /** The current courseware's default generation language; controls the default output language of new text and page content. */
  language?: SupportedLanguage;
  selectedElements?: readonly CoursewareAgentSelectedElement[];
  referencedAssets?: readonly Pick<
    CoursewareAssetItem,
    "id" | "name" | "extension" | "mimeType" | "size"
  >[];
  /** Other coursewares the user @-referenced from the courseware library (scene JSON URLs) */
  referencedCourseware?: readonly CoursewareAgentReferencedCourseware[];
  /** Organization design templates the user @-referenced */
  referencedDesignTemplates?: readonly Pick<ReferencedDesignTemplateItem, "id" | "name">[];
  /** Organization content templates the user @-referenced */
  referencedContentTemplates?: readonly { id: string; name: string }[];
  /** Canvas regions the user marked by hand (logical coordinates), merged into editorContext */
  manualMarkSession?: CoursewareManualMarkSession | null;
};

const COURSEWARE_AGENT_UI_LANGUAGE_LABELS: Record<
  SupportedLanguage,
  { englishName: string; nativeName: string }
> = {
  zh: { englishName: "Chinese", nativeName: "中文" },
  en: { englishName: "English", nativeName: "English" },
  ja: { englishName: "Japanese", nativeName: "日本語" },
};

/** Editor UI language → the agent's suggested language note (written into editorContext). */
export function formatCoursewareAgentPreferredUiLanguageLine(
  language: SupportedLanguage,
): string {
  const { englishName, nativeName } = COURSEWARE_AGENT_UI_LANGUAGE_LABELS[language];
  return (
    `Editor UI language: ${englishName} (${language}, ${nativeName}). ` +
    `Match the language of the user's messages for replies; ` +
    `when the message language is unclear, fall back to ${englishName}. ` +
    `Never let this line override the language the user actually writes in.`
  );
}

/** Note on the courseware's default generation language (written into editorContext, helping the backend tell the UI language from the content language). */
export function formatCoursewareAgentGenerationLanguageLine(
  language: SupportedLanguage,
): string {
  const { englishName, nativeName } = COURSEWARE_AGENT_UI_LANGUAGE_LABELS[language];
  return `Courseware generation language: ${englishName} (${language}, ${nativeName}). Use this as the default language for newly generated on-slide copy unless the user explicitly requests another output language.`;
}

/** Sidebar and transcript user message: only the user input (with @ resource display names, without the editor context). */
export function buildCoursewareAgentUserPrompt(args: CoursewareAgentPromptPartsArgs): string {
  return formatDesignTemplateMentionsForDisplay(
    formatCoursewareMentionsForDisplay(formatAssetMentionsForDisplay(args.text.trim())),
  );
}

type CoursewareAgentSlideJsonSlide = {
  background_color?: unknown;
  background_image_url?: unknown;
  background_image_fit?: unknown;
  children_elements?: unknown[] | null;
};

function readCurrentSlideFromSlideJson(slideJson: string): CoursewareAgentSlideJsonSlide | null {
  if (!slideJson.trim()) return null;
  try {
    const parsed = JSON.parse(slideJson) as {
      slide_elements?: CoursewareAgentSlideJsonSlide[];
    };
    return parsed.slide_elements?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Read the top-level children count from the current page's slideJson attached to the prompt (null when it can't be parsed). */
export function countCurrentSlideChildrenFromSlideJson(slideJson: string): number | null {
  const slide = readCurrentSlideFromSlideJson(slideJson);
  if (!slide) return null;
  const children = slide.children_elements;
  return Array.isArray(children) ? children.length : 0;
}

export type CoursewareAgentCurrentSlideBackground = {
  backgroundColor: string;
  backgroundImageUrl?: string;
  backgroundImageFit?: string;
};

/** Read the canvas background from the current page's slideJson (null when it can't be parsed or has no color). */
export function readCurrentSlideBackgroundFromSlideJson(
  slideJson: string,
): CoursewareAgentCurrentSlideBackground | null {
  const slide = readCurrentSlideFromSlideJson(slideJson);
  if (!slide) return null;
  const backgroundColor =
    typeof slide.background_color === "string" ? slide.background_color.trim() : "";
  if (!backgroundColor) return null;
  const out: CoursewareAgentCurrentSlideBackground = { backgroundColor };
  const backgroundImageUrl =
    typeof slide.background_image_url === "string" ? slide.background_image_url.trim() : "";
  if (backgroundImageUrl) {
    out.backgroundImageUrl = backgroundImageUrl;
    const fit =
      typeof slide.background_image_fit === "string" ? slide.background_image_fit.trim() : "";
    if (fit) out.backgroundImageFit = fit;
  }
  return out;
}

const COURSEWARE_AGENT_SLIDE_CANVAS_WIDTH = 1920;
const COURSEWARE_AGENT_SLIDE_CANVAS_HEIGHT = 1080;

/** Read the position and size of the quiz element (blue frame) on the canvas from the current page's slideJson. */
export function readQuizElementsFromSlideJson(
  slideJson: string,
): CoursewareAgentQuizElementOnSlide[] {
  const slide = readCurrentSlideFromSlideJson(slideJson);
  if (!slide || !Array.isArray(slide.children_elements)) return [];
  const out: CoursewareAgentQuizElementOnSlide[] = [];
  for (const raw of slide.children_elements) {
    if (!raw || typeof raw !== "object") continue;
    const child = raw as SlideChildForAgentSelection;
    if (child.element_type !== "quiz" || typeof child.element_id !== "string") continue;
    const box = readElementBoxFromSlideChild(child);
    if (!box) continue;
    const quiz_question_id = quizQuestionIdFromSlideChild(child);
    out.push({
      element_id: child.element_id,
      box,
      ...(quiz_question_id ? { quiz_question_id } : {}),
    });
  }
  return out;
}

/** Note on the quiz's three size layers and layout scale (written into editorContext). */
export function buildCoursewareAgentQuizSizingContextSection(
  quizElements: readonly CoursewareAgentQuizElementOnSlide[],
): string {
  if (quizElements.length === 0) return "";
  const lines = [
    "[Quiz layout on this slide]",
    `Slide canvas is ${COURSEWARE_AGENT_SLIDE_CANVAS_WIDTH}×${COURSEWARE_AGENT_SLIDE_CANVAS_HEIGHT} logical px. Each quiz element (editor blue frame) is a positioned box on that canvas; its react_layout <QuizContainer> must fill that box (style width/height "100%"), not a smaller centered card inside it.`,
    "Quiz JSX fontSize is CSS px inside the quiz box — not slide element font_size. For presentation readability on this 1920×1080 deck, target title fontSize 32–48, options/body 20–28, small labels ≥16; avoid web-page defaults (12–16) that look tiny on the slide. If content looks small, run quiz update --jsx first (full-bleed layout + larger typography), not only element update --set size.",
  ];
  for (const quiz of quizElements) {
    const qid = quiz.quiz_question_id ? `, quiz_question_id: ${quiz.quiz_question_id}` : "";
    lines.push(
      `- ${quiz.element_id}${qid} — quiz box ${formatCoursewareAgentElementBox(quiz.box)} on canvas`,
    );
  }
  return lines.join("\n");
}

/** Current page canvas background → a one-line note in editorContext. */
export function formatCoursewareAgentCurrentSlideBackgroundLine(
  background: CoursewareAgentCurrentSlideBackground,
): string {
  let line = `Current slide canvas background_color: ${background.backgroundColor}.`;
  if (background.backgroundImageUrl) {
    const fit = background.backgroundImageFit ?? "cover";
    line += ` background_image is set (fit: ${fit}).`;
  }
  line +=
    " When inserting or styling new elements (text, shapes, buttons, quiz or other elements...), choose fills and strokes that contrast with and harmonize with this slide background.";
  return line;
}

function resolveCurrentSlideChildCount(args: CoursewareAgentPromptPartsArgs): number | null {
  if (typeof args.currentSlideChildCount === "number" && Number.isFinite(args.currentSlideChildCount)) {
    return Math.max(0, Math.floor(args.currentSlideChildCount));
  }
  return countCurrentSlideChildrenFromSlideJson(args.slideJson);
}

/** The editor context block sent to the agent (the server's `editorContext` field). */
export function buildCoursewareAgentEditorContext(args: CoursewareAgentPromptPartsArgs): string {
  const slideId = args.currentSlideId?.trim();
  const pageLine =
    slideId && slideId.length > 0
      ? `Current Page: ${args.pageIndex + 1} of ${args.totalPages} (slide_id: ${slideId}).`
      : `Current Page: ${args.pageIndex + 1} of ${args.totalPages}.`;

  const lines = [
    "[Courseware Editor Context]",
    pageLine,
  ];

  if (args.preferredUiLanguage) {
    lines.push(formatCoursewareAgentPreferredUiLanguageLine(args.preferredUiLanguage));
  }
  if (args.language) {
    lines.push(formatCoursewareAgentGenerationLanguageLine(args.language));
  }

  const slideBackground = readCurrentSlideBackgroundFromSlideJson(args.slideJson);
  if (slideBackground) {
    lines.push(formatCoursewareAgentCurrentSlideBackgroundLine(slideBackground));
  }

  const childCount = resolveCurrentSlideChildCount(args);
  if (childCount === 0) {
    lines.push(
      "The current slide canvas is empty (no child elements on this slide yet).",
    );
  }

  const quizSizingSection = buildCoursewareAgentQuizSizingContextSection(
    readQuizElementsFromSlideJson(args.slideJson),
  );
  if (quizSizingSection) {
    lines.push("", quizSizingSection);
  }

  lines.push(
    "In ainobi CLI, the slide number parameter is an array index (page 1 is 0, page 2 is 1, etc.); prioritize using the index or slide_id from the slide list.",
    "The slide canvas is 1920×1080 logical px; origin (0,0) is the top-left corner. Element position.x/y are the box top-left (not the visual center); text align only affects glyphs inside the box.",
    "Before any edit on the current slide (element insert/update/delete, animation, highlight, flow-pause, etc.), you MUST run `ainobi slide get <index|slide_id>` first; add `--with-children` when the slide may already have elements (use `--full-children` or `element get` when output shows `_truncated`). Do not add or modify from memory alone—this avoids duplicate elements and missed updates.",
    "Flow pause (`flow_pause_points` on slide JSON): do NOT add by default on text/rich-only slides or at arbitrary slide tails. Proactively add only after inserting an `html` element — `ainobi flow-pause add <slide> --element <html_ref>` (default places pause at that element's `timeline.end_at`). Also add when the user explicitly asks for a pause / 停留点 / Continue gate. When adding: do NOT use `--when start` or `--at 0` (pauses at appearance/slide start, often before fade-in). `--when start` only when you must stop immediately after fade-in (rare). Never on quiz/quiz_score_summary or overlapping quiz timelines.",
    "When changing one element, review all siblings on that slide: update related elements together when needed (groups, narration/vtuber pairs, question members, labels tied to visuals, shared timelines) and check position/size/z_index for overlap or unintended occlusion on the 1920×1080 canvas; run `ainobi inspect overlaps <index|slide_id>` after layout-heavy edits.",
    "@ainobi-courseware-cli Please operate the courseware according to user needs; if you need to modify the content, please complete it through ainobi CLI.",
  );

  const selected = args.selectedElements ?? [];
  if (selected.length > 0) {
    lines.push("", "[Canvas Selected Elements]");
    if (selected.length === 1) {
      lines.push(`Selected 1 element: ${formatCoursewareAgentSelectedElementFields(selected[0]!, "，")}`);
    } else {
      lines.push(`Selected ${selected.length} elements (multi-select):`);
      for (const el of selected) {
        lines.push(`- ${formatCoursewareAgentSelectedElementFields(el, " | ")}`);
      }
    }
  }

  const refs = args.referencedAssets?.filter((a) => a.id && a.name) ?? [];
  if (refs.length > 0) {
    lines.push("", "[User @ Referenced Library Files]");
    const libraryCwId = args.libraryCoursewareId?.trim();
    if (libraryCwId) {
      lines.push(`Library courseware_id: ${libraryCwId} (assets below belong to this courseware).`);
    }
    lines.push(
      "Resolve download URLs with `ainobi asset get <file_id>` (signed URL); do not guess URLs from chat history.",
    );
    for (const asset of refs) {
      lines.push(
        `- ${asset.name} | file_id: ${asset.id} | extension: ${asset.extension} | mime: ${asset.mimeType} | size: ${asset.size}`,
      );
    }
  }


  const marks = args.manualMarkSession?.regions ?? [];
  if (marks.length > 0 && args.manualMarkSession) {
    lines.push("", buildManualMarksEditorContextSection(args.manualMarkSession));
  }

  return lines.join("\n");
}

/**
 * Lightweight editor context dedicated to Plan mode (the courseware planner): gives the planner only minimal courseware awareness
 * (current courseware size, @-referenced assets with file_id, UI language), without the canvas editing CLI instructions —
 * the planner persona and output requirements are in the backend system prompt. Referenced documents must be read with `ainobi doc read` by file_id.
 */
export function buildCoursewarePlanEditorContext(args: {
  totalPages?: number;
  preferredUiLanguage?: SupportedLanguage;
  language?: SupportedLanguage;
  referencedAssets?: readonly Pick<CoursewareAssetItem, "id" | "name" | "extension">[];
}): string {
  const lines = ["[Courseware Plan Context]"];
  if (typeof args.totalPages === "number" && Number.isFinite(args.totalPages)) {
    lines.push(
      args.totalPages > 0
        ? `The current courseware already has ${args.totalPages} slide(s). The user may want to plan a redesign or an extension.`
        : "The current courseware is empty (no slides yet); you are planning it from scratch.",
    );
  }
  if (args.preferredUiLanguage) {
    lines.push(formatCoursewareAgentPreferredUiLanguageLine(args.preferredUiLanguage));
  }
  if (args.language) {
    lines.push(formatCoursewareAgentGenerationLanguageLine(args.language));
  }
  const refs = args.referencedAssets?.filter((a) => a.id && a.name) ?? [];
  if (refs.length > 0) {
    lines.push(
      "",
      "[User @ Referenced Library Files]",
      "Read reference documents with `ainobi doc read --file-id <uuid>` (file_id is the UUID below; never pass the filename as --file-id).",
    );
    for (const asset of refs) {
      lines.push(`- ${asset.name} | file_id: ${asset.id} | extension: ${asset.extension}`);
    }
  }

  return lines.join("\n");
}

export function sanitizeJsonPatchOperations(raw: unknown): Operation[] {
  if (!Array.isArray(raw)) return [];
  const out: Operation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { op?: unknown; path?: unknown; value?: unknown };
    if (rec.op !== "add" && rec.op !== "remove" && rec.op !== "replace") continue;
    if (typeof rec.path !== "string") continue;
    if (rec.op === "remove") {
      out.push({ op: "remove", path: rec.path });
    } else {
      out.push({ op: rec.op, path: rec.path, value: rec.value });
    }
  }
  return out;
}

/** Numeric index when path ends with `/N` (not `-`). */
function arrayIndexFromJsonPointer(path: string): number | null {
  const last = path.split("/").filter(Boolean).pop();
  if (last === undefined || last === "-") return null;
  if (!/^\d+$/.test(last)) return null;
  return Number(last);
}

/** Parent pointer for array element paths, e.g. `/a/0/b/10` → `/a/0/b`. */
function parentArrayPath(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === undefined || !/^\d+$/.test(last)) return null;
  segments.pop();
  return segments.length === 0 ? "" : `/${segments.join("/")}`;
}

/**
 * Reorder patch ops so fast-json-patch can apply them (RFC 6902 array rules).
 * Matches ainobi CLI `createElementIdKeyedArrayPatch`: removes high→low, adds low→high.
 * Defends against legacy agent patches and out-of-order stream batches.
 */
export function normalizeJsonPatchOperationsForApply(ops: Operation[]): Operation[] {
  const removes: Operation[] = [];
  const replaces: Operation[] = [];
  const adds: Operation[] = [];
  const rest: Operation[] = [];

  for (const op of ops) {
    if (op.op === "remove") removes.push(op);
    else if (op.op === "replace") replaces.push(op);
    else if (op.op === "add") adds.push(op);
    else rest.push(op);
  }

  const compareArrayIndex = (a: Operation, b: Operation, order: "asc" | "desc"): number => {
    const parentA = parentArrayPath(a.path) ?? a.path;
    const parentB = parentArrayPath(b.path) ?? b.path;
    if (parentA !== parentB) return parentA.localeCompare(parentB);
    const ai = arrayIndexFromJsonPointer(a.path);
    const bi = arrayIndexFromJsonPointer(b.path);
    if (ai === null && bi === null) return a.path.localeCompare(b.path);
    if (ai === null) return order === "asc" ? -1 : 1;
    if (bi === null) return order === "asc" ? 1 : -1;
    return order === "asc" ? ai - bi : bi - ai;
  };

  removes.sort((a, b) => compareArrayIndex(a, b, "desc"));
  adds.sort((a, b) => compareArrayIndex(a, b, "asc"));

  return [...removes, ...replaces, ...adds, ...rest];
}

export function applyJsonPatchesToSerializedScene(
  scene: Scene,
  patches: Operation[],
): unknown {
  const doc = JSON.parse(JSON.stringify(serializeScene(scene))) as object;
  const ordered = normalizeJsonPatchOperationsForApply(patches);
  const { newDocument } = applyPatch(doc, ordered, true, false);
  return newDocument;
}

/** Drop duplicate slide element_id entries (replay / bad add patches); keep first occurrence. */
export function dedupeSlideElementsByElementId(scene: Scene): Scene {
  const seen = new Set<string>();
  const slide_elements = scene.slide_elements.filter((slide) => {
    if (seen.has(slide.element_id)) return false;
    seen.add(slide.element_id);
    return true;
  });
  return slide_elements.length === scene.slide_elements.length ? scene : { ...scene, slide_elements };
}

/** Drop duplicate element_id siblings within each slide; keep first occurrence. */
export function dedupeSceneChildrenByElementId(scene: Scene): Scene {
  let mutated = false;
  const slide_elements = scene.slide_elements.map((slide) => {
    const seen = new Set<string>();
    const children_elements = slide.children_elements.filter((el) => {
      if (seen.has(el.element_id)) {
        mutated = true;
        return false;
      }
      seen.add(el.element_id);
      return true;
    });
    return children_elements.length === slide.children_elements.length
      ? slide
      : { ...slide, children_elements };
  });
  return mutated ? { ...scene, slide_elements } : scene;
}

/** Dedupe slides and per-slide children after patch apply or scene load. */
export function dedupeSceneElementIds(scene: Scene): Scene {
  return dedupeSceneChildrenByElementId(dedupeSlideElementsByElementId(scene));
}

/** Stable key for deduping live-preview `scene.patch` replays within one editor run. */
export function coursewareScenePatchEventKey(ev: CoursewareStreamEvent): string {
  return `${ev.created_at}\0${ev.cli_session_id}\0${JSON.stringify(ev.patch)}`;
}

export function sceneFromSerializedPatchResult(scene: Scene, patches: unknown[]): Scene {
  const ops = sanitizeJsonPatchOperations(patches);
  if (ops.length === 0) return scene;
  const nextDoc = applyJsonPatchesToSerializedScene(scene, ops);
  return dedupeSceneElementIds(deserializeScene(nextDoc));
}

export type ApplySerializedScenePatchesResult =
  | { ok: true; scene: Scene }
  | { ok: false; error: unknown };

/** Applies JSON Patch to a scene without throwing (for editor resync fallback). */
export function tryApplySerializedScenePatches(
  scene: Scene,
  patches: unknown[],
): ApplySerializedScenePatchesResult {
  try {
    return { ok: true, scene: sceneFromSerializedPatchResult(scene, patches) };
  } catch (error) {
    return { ok: false, error };
  }
}

const USER_FACING_ERROR_MAX_LEN = 220;

/**
 * i18n-capable sinks (toasts, prose notices) pass a translate fn; bare calls
 * (tool output cards, storage fallbacks) use the built-in English catalog.
 */
export type CoursewareAgentTranslateFn = (
  key: TranslationKey,
  variables?: Record<string, string | number>,
) => string;

const COURSEWARE_AGENT_ERROR_MESSAGES_EN = {
  unknownError: "Unknown error",
  operationFailed: "Operation failed",
  insufficientOrgCredits: "Insufficient organization credits",
  insufficientPersonalCredits: "Insufficient personal credits",
  contextTooLarge:
    "The assistant conversation history exceeds the model request limit. Clear the assistant history and resend.",
  patchOutOfBounds:
    "The incremental courseware update did not match the current canvas; the full courseware was synced from the server.",
  patchUnresolvable:
    "The incremental courseware update could not be applied; synced from the server.",
} as const;

type CoursewareAgentErrorMessageKey = keyof typeof COURSEWARE_AGENT_ERROR_MESSAGES_EN;

const COURSEWARE_AGENT_ERROR_I18N_KEYS: Record<CoursewareAgentErrorMessageKey, TranslationKey> = {
  unknownError: "coursewareEditor.aiPanel.agentUnknownError",
  operationFailed: "coursewareEditor.aiPanel.agentOperationFailed",
  insufficientOrgCredits: "player.error.chatInsufficientOrgCredits",
  insufficientPersonalCredits: "player.error.chatInsufficientPersonalCredits",
  contextTooLarge: "coursewareEditor.aiPanel.contextTooLargeMessage",
  patchOutOfBounds: "coursewareEditor.aiPanel.patchResyncOutOfBounds",
  patchUnresolvable: "coursewareEditor.aiPanel.patchResyncUnresolvable",
};

function coursewareAgentErrorMessage(
  key: CoursewareAgentErrorMessageKey,
  translate?: CoursewareAgentTranslateFn,
): string {
  return translate
    ? translate(COURSEWARE_AGENT_ERROR_I18N_KEYS[key])
    : COURSEWARE_AGENT_ERROR_MESSAGES_EN[key];
}

const INSUFFICIENT_ORG_CREDITS_ERROR_MARKERS = [
  "ainobi_insufficient_org_credits",
  "no available organization credit assets",
  "organization credit",
  "organization credits",
  "org credit",
  "组织额度",
  "组织 credit",
  "组织积分",
] as const;

const AGENT_CONTEXT_TOO_LARGE_ERROR_MARKERS = [
  "6291456",
  "max bytes to request body",
  "exceeded limit on max bytes",
  "request body too large",
] as const;

const INSUFFICIENT_PERSONAL_CREDITS_ERROR_MARKERS = [
  "ainobi_insufficient_personal_credits",
  "no available personal credit assets",
  // Backend personal no-assets copy has no "personal" word ("No available credit
  // assets"); org no-assets is caught by the exact org marker above first.
  "no available credit assets",
  "personal credit",
  "personal asset",
  "personal balance",
  "user credit assets",
  "user credit",
  "个人额度",
  "个人 credit",
  "个人积分",
  "个人余额",
] as const;

function coursewareAgentErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
    const creditScope = rec.creditScope ?? rec.credit_scope;
    if (creditScope === "organization" || creditScope === "org") {
      return AINOBI_INSUFFICIENT_ORG_CREDITS;
    }
    if (creditScope === "personal" || creditScope === "user") {
      return AINOBI_INSUFFICIENT_PERSONAL_CREDITS;
    }
    const metadata = rec.metadata;
    if (metadata && typeof metadata === "object") {
      const meta = metadata as Record<string, unknown>;
      const recovery = meta.recovery_action;
      if (recovery && typeof recovery === "object") {
        const action = (recovery as Record<string, unknown>).action;
        if (typeof action === "string" && action.trim()) return action.trim();
      }
    }
    if (typeof rec.message === "string") return rec.message;
  }
  return "";
}

export function isCoursewareAgentInsufficientOrgCreditsError(error: unknown): boolean {
  const text = coursewareAgentErrorText(error).trim().toLowerCase();
  if (!text) return false;
  if (text === "go_org_recharge" || text === "contact_admin") return true;
  // The backend's billing_source tag is the top-priority basis for the decision (P1): a 402 for org-context spending
  // where an enterprise member uses their own workspace looks like
  // "billing_source=personal; No available organization credit assets"
  // — when the old inner copy's "organization credit assets" won over the tag,
  // an organization card was shown twice next to the personal card.
  if (text.includes("billing_source=personal") || text.includes("billing_source=user")) {
    return false;
  }
  if (text.includes("billing_source=organization")) return true;
  return INSUFFICIENT_ORG_CREDITS_ERROR_MARKERS.some((marker) => text.includes(marker));
}

export function isCoursewareAgentInsufficientPersonalCreditsError(error: unknown): boolean {
  if (isCoursewareAgentInsufficientOrgCreditsError(error)) return false;
  const text = coursewareAgentErrorText(error).trim().toLowerCase();
  if (!text) return false;
  if (text === "go_personal_recharge") return true;
  if (text.includes("billing_source=personal") || text.includes("billing_source=user")) {
    return true;
  }
  return INSUFFICIENT_PERSONAL_CREDITS_ERROR_MARKERS.some((marker) => text.includes(marker));
}

export function isCoursewareAgentInsufficientCreditsError(error: unknown): boolean {
  return (
    isCoursewareAgentInsufficientOrgCreditsError(error) ||
    isCoursewareAgentInsufficientPersonalCreditsError(error)
  );
}

/** Claude / gateway 6MB request-body limit — session context is too large to resume. */
export function isCoursewareAgentContextTooLargeError(error: unknown): boolean {
  const text = coursewareAgentErrorText(error).toLowerCase();
  if (!text) return false;
  return AGENT_CONTEXT_TOO_LARGE_ERROR_MARKERS.some((marker) => text.includes(marker));
}

/** Maps stream/POST failures to sidebar UI events (prose error line or org-credits recovery card). */
export function coursewareAgentChatStreamErrorUiEvents(
  error: unknown,
  translate?: CoursewareAgentTranslateFn,
): CoursewareAgentChatUiEvent[] {
  if (isCoursewareAgentInsufficientOrgCreditsError(error)) {
    return [{ kind: "insufficient_org_credits" }];
  }
  if (isCoursewareAgentInsufficientPersonalCreditsError(error)) {
    return [{ kind: "insufficient_personal_credits" }];
  }
  if (isCoursewareAgentContextTooLargeError(error)) {
    return [{ kind: "agent_context_reset_required" }];
  }
  const err = formatCoursewareAgentUserFacingError(error, translate);
  return [{ kind: "prose", text: `[Error] ${err}` }];
}

export function formatCoursewareAgentUserFacingError(
  error: unknown,
  translate?: CoursewareAgentTranslateFn,
): string {
  const raw = coursewareAgentErrorText(error);
  if (!raw) return coursewareAgentErrorMessage("unknownError", translate);
  const trimmed = raw.trim();
  if (!trimmed) return coursewareAgentErrorMessage("operationFailed", translate);
  if (isCoursewareAgentInsufficientOrgCreditsError(trimmed)) {
    return coursewareAgentErrorMessage("insufficientOrgCredits", translate);
  }
  if (isCoursewareAgentInsufficientPersonalCreditsError(trimmed)) {
    return coursewareAgentErrorMessage("insufficientPersonalCredits", translate);
  }
  if (isCoursewareAgentContextTooLargeError(trimmed)) {
    return coursewareAgentErrorMessage("contextTooLarge", translate);
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("operation_value_out_of_bounds")) {
    return coursewareAgentErrorMessage("patchOutOfBounds", translate);
  }
  if (
    lower.includes("operation_path_unresolvable") ||
    lower.includes("cannot perform an") ||
    lower.includes("test operation failed")
  ) {
    return coursewareAgentErrorMessage("patchUnresolvable", translate);
  }
  if (trimmed.includes("{") || trimmed.includes("[")) {
    const withoutJson = trimmed
      .replace(/\{[\s\S]*\}/g, "")
      .replace(/\[[\s\S]*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (withoutJson.length > 0 && withoutJson.length < trimmed.length) {
      return truncateUserFacing(withoutJson, USER_FACING_ERROR_MAX_LEN);
    }
  }
  return truncateUserFacing(trimmed, USER_FACING_ERROR_MAX_LEN);
}

function truncateUserFacing(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function parseCoursewareSseEntry(data: unknown): CoursewareStreamEvent | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const direct = o.event_type;
  if (direct === "scene.patch") {
    return o as CoursewareStreamEvent;
  }
  const inner = o.payload;
  if (inner && typeof inner === "object") {
    const et = (inner as { event_type?: unknown }).event_type;
    if (et === "scene.patch") {
      return inner as CoursewareStreamEvent;
    }
  }
  return null;
}

export async function consumeSseResponse(
  response: Response,
  handler: (eventName: string, payload: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = response.body;
  if (!body) {
    throw new Error("Response has no body");
  }
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (!signal?.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const { eventName, dataText } = parseSseRawBlock(raw);
      if (dataText !== undefined && dataText !== "") {
        let payload: unknown = dataText;
        try {
          payload = JSON.parse(dataText);
        } catch {
          // keep string
        }
        handler(eventName, payload);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

const LIVE_PREVIEW_SSE_RECONNECT_BASE_MS = 1000;
const LIVE_PREVIEW_SSE_RECONNECT_MAX_MS = 15_000;

/** Initial Redis stream cursor for `GET …/stream?from=`. */
export const REDIS_STREAM_CURSOR_START = "0";

/** @deprecated Use {@link REDIS_STREAM_CURSOR_START}. */
export const LIVE_PREVIEW_REDIS_STREAM_CURSOR_START = REDIS_STREAM_CURSOR_START;

/** Redis stream entry id from live-preview SSE `event` data (`{ id, eventType, payload }`). */
export function readLivePreviewRedisStreamId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  return trimmed || null;
}

/** Redis cursor from chat SSE (`streamEntryId`) or live-preview envelope (`id`). */
export function readRedisStreamCursorFromSseEvent(eventName: string, payload: unknown): string | null {
  const fromPreview = readLivePreviewRedisStreamId(payload);
  if (fromPreview) {
    return fromPreview;
  }
  if (eventName === "ready" || eventName === "done" || eventName === "error" || eventName === "ui" || eventName === "message") {
    if (payload && typeof payload === "object") {
      const id = (payload as { streamEntryId?: unknown }).streamEntryId;
      if (typeof id === "string" && id.trim()) {
        return id.trim();
      }
    }
  }
  return null;
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Keeps the live-preview SSE open for one assistant run, reconnecting on transient failures.
 * Each connection attempt gets a monotonic `connGen`; handlers from superseded connections are ignored
 * so a dying reader cannot apply patches after a newer stream has started.
 */
export async function runLivePreviewSseWithReconnect(options: {
  openStream: (signal: AbortSignal, from: string) => Promise<Response>;
  onEvent: (eventName: string, payload: unknown) => void;
  shouldContinue: () => boolean;
  runSignal: AbortSignal;
  initialCursor?: string;
  onTransientError?: (error: unknown, attempt: number) => void;
  onReconnecting?: (attempt: number) => void;
}): Promise<void> {
  let connGen = 0;
  let activeConn: AbortController | null = null;
  let attempt = 0;
  let redisStreamCursor = options.initialCursor?.trim() || REDIS_STREAM_CURSOR_START;

  const stopActiveConn = (): void => {
    activeConn?.abort();
    activeConn = null;
  };

  try {
    while (options.shouldContinue() && !options.runSignal.aborted) {
      stopActiveConn();
      const myConn = ++connGen;
      const connAbort = new AbortController();
      activeConn = connAbort;
      const onRunAbort = (): void => {
        connAbort.abort();
      };
      options.runSignal.addEventListener("abort", onRunAbort);

      try {
        if (attempt > 0) {
          options.onReconnecting?.(attempt);
        }
        const res = await options.openStream(connAbort.signal, redisStreamCursor);
        await consumeSseResponse(
          res,
          (eventName, payload) => {
            if (!options.shouldContinue()) return;
            if (myConn !== connGen) return;
            const streamId = readRedisStreamCursorFromSseEvent(eventName, payload);
            if (streamId) {
              redisStreamCursor = streamId;
            }
            options.onEvent(eventName, payload);
          },
          connAbort.signal,
        );
        if (!options.shouldContinue() || options.runSignal.aborted) break;
        attempt += 1;
        options.onTransientError?.(new Error("Live Preview Stream Disconnected"), attempt);
      } catch (error) {
        if (!options.shouldContinue() || options.runSignal.aborted) break;
        if (error instanceof DOMException && error.name === "AbortError") {
          if (myConn !== connGen) continue;
          if (options.runSignal.aborted) break;
          continue;
        }
        if (myConn !== connGen) continue;
        attempt += 1;
        options.onTransientError?.(error, attempt);
      } finally {
        options.runSignal.removeEventListener("abort", onRunAbort);
      }

      if (!options.shouldContinue() || options.runSignal.aborted) break;

      const delay = Math.min(
        LIVE_PREVIEW_SSE_RECONNECT_BASE_MS * 2 ** Math.min(Math.max(0, attempt - 1), 4),
        LIVE_PREVIEW_SSE_RECONNECT_MAX_MS,
      );
      try {
        await sleepMs(delay, options.runSignal);
      } catch {
        break;
      }
    }
  } finally {
    stopActiveConn();
  }
}

function parseSseRawBlock(raw: string): { eventName: string; dataText: string | undefined } {
  const lines = raw.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event: "));
  const eventName = eventLine ? eventLine.slice(7).trim() : "message";
  const dataLines = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6));
  const dataText = dataLines.length > 0 ? dataLines.join("\n") : undefined;
  return { eventName, dataText };
}

export type CoursewareAgentPermissionAnswerBody = {
  requestId: string;
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
};

export type CoursewareAgentClearHistoryResult = {
  coursewareId: string;
  deletedConversations: number;
  deletedTranscriptLines: number;
  removedWorkspaceDirs: number;
};

export type CoursewareAgentConversationHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: CoursewareAiAssistantBlock[];
  created_at?: string | number | null;
};

export type CoursewareAgentConversationHistoryResult = {
  ok: boolean;
  coursewareId?: string;
  conversationId?: string | null;
  title?: string | null;
  claudeSessionId?: string | null;
  livePreviewSessionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  messages?: CoursewareAgentConversationHistoryMessage[];
  error?: string;
};

export type CoursewareAgentConversationListItem = {
  conversationId: string;
  title: string | null;
  /** Conversation kind: `agent` (default) or `plan` */
  kind: "agent" | "plan";
  claudeSessionId: string | null;
  livePreviewSessionId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CoursewareAgentConversationListResult = {
  ok: boolean;
  coursewareId?: string;
  conversations?: CoursewareAgentConversationListItem[];
  error?: string;
};

export type CoursewareAgentChatStreamLifecycleStatus = "running" | "done" | "error" | "missing";

export type CoursewareAgentChatStreamStatusResult = {
  ok: boolean;
  chatStreamSessionId?: string;
  /** When true the backend is still running; the frontend should enter processing and subscribe to GET `/chat/stream` */
  active?: boolean;
  status?: CoursewareAgentChatStreamLifecycleStatus;
  livePreviewSessionId?: string | null;
  conversationId?: string | null;
  lastStreamEntryId?: string;
  error?: string;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function readToolFilePath(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  const p = (rec.file_path ?? rec.path) as string | undefined;
  return typeof p === "string" ? p.trim() : "";
}

/** Rough check: treat a whole JSON/array literal as a title (Todo payloads, large Write blocks, etc.) */
function isRawJsonLikeToolTitle(title: string): boolean {
  const s = title.trim();
  if (s.length < 8) return false;
  const c0 = s[0];
  if (c0 !== "{" && c0 !== "[") return false;
  if (c0 === "{" && /^\{\s*"/.test(s)) return true;
  if (c0 === "[" && /^\[\s*[[{"]/.test(s)) return true;
  return false;
}

/** Card title fallback (also used by the display layer when the persisted title is already JSON) */
function fallbackOpsCardTitleFromToolName(toolName: string | undefined): string {
  const n = toolName?.trim();
  if (!n) return "Handling";
  if (/todo/i.test(n)) return "Update Todos";
  if (n === "Read") return "Read file";
  return n;
}

function looksLikeTodoWriteInput(rec: Record<string, unknown>): boolean {
  if (!Array.isArray(rec.todos)) return false;
  if (rec.todos.length === 0) return true;
  const first = rec.todos[0];
  return (
    typeof first === "object" &&
    first != null &&
    typeof (first as { status?: unknown }).status === "string"
  );
}

function summarizeTodoToolInput(rec: Record<string, unknown>): string {
  const n = Array.isArray(rec.todos) ? rec.todos.length : 0;
  const merge = typeof rec.merge === "boolean" && rec.merge;
  if (n <= 0) return merge ? "Update Todos (merge)" : "Update Todos";
  return merge ? `Update Todos (${n} items, merge)` : `Update Todos (${n} items)`;
}

function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  if (name === "Bash") {
    return typeof rec.description === "string" ? rec.description : "shell";
  }
  if (name === "Read") {
    return "Read file";
  }
  if (name === "Skill") {
    const skill = rec.skill;
    const args = rec.args;
    if (typeof skill === "string") {
      return args ? `${String(skill)} · ${String(args)}` : skill;
    }
  }
  if (/todo/i.test(name)) {
    if (Array.isArray(rec.todos)) return summarizeTodoToolInput(rec);
    return "Update Todos";
  }
  if (looksLikeTodoWriteInput(rec)) {
    return summarizeTodoToolInput(rec);
  }
  return truncate(JSON.stringify(input), 140);
}

const TOOL_OUTPUT_DISPLAY_MAX = 400;

function compactJsonValueForToolDisplay(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.version === "string" && rec.version.trim()) {
      return `version ${rec.version.trim()}`;
    }
    if (typeof rec.error === "string" && rec.error.trim()) {
      return formatCoursewareAgentUserFacingError(rec.error);
    }
    if (typeof rec.message === "string" && rec.message.trim()) {
      return truncate(rec.message.trim(), TOOL_OUTPUT_DISPLAY_MAX);
    }
    const keys = Object.keys(rec);
    if (keys.length === 0) return "(empty)";
    if (keys.length <= 4) {
      return truncate(JSON.stringify(rec), TOOL_OUTPUT_DISPLAY_MAX);
    }
    return `Result object (${keys.length} fields)`;
  }
  return truncate(String(value), TOOL_OUTPUT_DISPLAY_MAX);
}

function prettifyToolOutputText(text: string): string {
  const cleaned = text.replace(/\nShell cwd was reset to .*$/m, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      ok?: unknown;
      error?: unknown;
      data?: unknown;
      message?: unknown;
    };
    if (parsed && typeof parsed === "object") {
      if (parsed.ok === false) {
        const err =
          typeof parsed.error === "string"
            ? parsed.error
            : typeof parsed.message === "string"
              ? parsed.message
              : "Command failed";
        return formatCoursewareAgentUserFacingError(err);
      }
      if (parsed.ok && parsed.data != null) {
        return compactJsonValueForToolDisplay(parsed.data);
      }
    }
  } catch {
    // not json
  }
  if (cleaned.length > TOOL_OUTPUT_DISPLAY_MAX) {
    return truncate(cleaned, TOOL_OUTPUT_DISPLAY_MAX);
  }
  return cleaned;
}

function summarizeToolOutput(
  content: unknown,
  toolUseResult: unknown,
  toolName: string | undefined,
): string {
  if (toolName === "Read") {
    const tur = toolUseResult as { file?: { filePath?: string; numLines?: number } } | undefined;
    const path = tur?.file?.filePath ?? "";
    const lines = tur?.file?.numLines;
    if (path) {
      return lines != null ? `Read ${path} (${lines} lines)` : `Read ${path}`;
    }
    return "Read file";
  }
  if (toolName === "Skill") {
    return typeof content === "string" ? content : "Skill loaded";
  }
  if (toolName && isTodoWriteToolName(toolName)) {
    return "";
  }
  const tur = toolUseResult as { stdout?: string } | undefined;
  if (typeof tur?.stdout === "string" && tur.stdout.trim()) {
    const stdout = tur.stdout.trim();
    if (isTodoToolResultOutputNoise(stdout)) return "";
    return prettifyToolOutputText(stdout);
  }
  if (typeof content === "string") {
    const c = content.trim();
    if (isTodoToolResultOutputNoise(c)) return "";
    return prettifyToolOutputText(c);
  }
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
          return String((item as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (isTodoToolResultOutputNoise(text)) return "";
    return prettifyToolOutputText(text);
  }
  return "";
}

/**
 * Map a single Claude Agent SDK message to sidebar UI events.
 * SSE `event: ui` is consumed first; older agents without ui events can fall back to this function.
 */
export function mapSdkMessageToChatUiEvents(
  state: AgentChatStreamState,
  message: unknown,
): CoursewareAgentChatUiEvent[] {
  if (!message || typeof message !== "object") return [];
  const m = message as Record<string, unknown>;
  const type = m.type;
  const out: CoursewareAgentChatUiEvent[] = [];

  if (type === "system" && m.subtype === "init") return out;

  if (type === "system" && m.subtype === "permission_denied") {
    const denied = m as { tool_name?: string; message?: string; decision_reason?: string };
    const tool = typeof denied.tool_name === "string" ? denied.tool_name : "tool";
    const msg =
      typeof denied.message === "string" && denied.message.trim()
        ? denied.message.trim()
        : typeof denied.decision_reason === "string" && denied.decision_reason.trim()
          ? denied.decision_reason.trim()
          : `Permission denied for ${tool}`;
    const key = `denied:${tool}:${msg}`;
    if (state.seenTextBlocks.has(key)) return out;
    state.seenTextBlocks.add(key);
    out.push({ kind: "prose", text: `⚠️ ${msg}` });
    return out;
  }

  if (type === "result") {
    if (typeof m.result === "string" && m.result.trim()) {
      const key = m.result.trim();
      if (state.seenTextBlocks.has(key)) return out;
      state.seenTextBlocks.add(key);
      out.push({ kind: "prose", text: m.result.trim() });
    }
    return out;
  }

  if (type === "assistant") {
    const inner = m.message as { content?: unknown } | undefined;
    const content = inner?.content;
    if (!Array.isArray(content)) return out;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: string; text?: string; id?: string; name?: string; input?: unknown };
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        const key = b.text.trim();
        if (state.seenTextBlocks.has(key)) continue;
        state.seenTextBlocks.add(key);
        out.push({ kind: "prose", text: b.text.trim() });
      }
      if (b.type === "tool_use" && b.id) {
        if (state.seenToolIds.has(b.id)) continue;
        state.seenToolIds.add(b.id);
        const toolName = typeof b.name === "string" ? b.name : "tool";
        state.toolNamesById.set(b.id, toolName);
        if (isTodoWriteToolName(toolName)) {
          const parsed = parseTodoWriteToolInput(b.input);
          if (parsed) {
            out.push({ kind: "todos_update", todos: parsed.todos, merge: parsed.merge });
          }
          continue;
        }
        if (isAskUserQuestionToolName(toolName)) {
          // The permission interceptor emits the user_question UI, so no tool action card is written
          continue;
        }
        if (isShowHomeIntentCardToolName(toolName)) {
          continue;
        }
        const title = summarizeToolInput(toolName, b.input) || toolName;
        const ev: CoursewareAgentChatUiEvent = {
          kind: "tool_start",
          toolUseId: b.id,
          toolName,
          title,
        };
        if (toolName === "Bash") {
          const input = b.input as { command?: string } | undefined;
          if (typeof input?.command === "string" && input.command.trim()) {
            ev.command = input.command.trim();
          }
        }
        if (toolName === "Read") {
          const path = readToolFilePath(b.input);
          if (path) ev.command = path;
        }
        out.push(ev);
      }
    }
    return out;
  }

  if (type === "user") {
    if (m.isSynthetic) return out;
    const inner = m.message as { content?: unknown } | undefined;
    const content = inner?.content;
    if (!Array.isArray(content)) return out;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: string; tool_use_id?: string; content?: unknown };
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
      const toolName = state.toolNamesById.get(b.tool_use_id);
      if (toolName && isTodoWriteToolName(toolName)) continue;
      if (toolName && isAskUserQuestionToolName(toolName)) continue;
      if (toolName && isShowHomeIntentCardToolName(toolName)) continue;
      const output = summarizeToolOutput(b.content, m.tool_use_result, toolName);
      if (!output) continue;
      out.push({ kind: "tool_output", toolUseId: b.tool_use_id, output });
    }
    return out;
  }

  return out;
}

/** @deprecated Use `mapSdkMessageToChatUiEvents` + `applyCoursewareAgentChatUiEvents` instead */
export function formatAgentSdkMessageForChat(
  state: AgentChatStreamState,
  message: unknown,
): string | null {
  const events = mapSdkMessageToChatUiEvents(state, message);
  if (!events.length) return null;
  return coursewareAiAssistantBlocksToPlainText(applyCoursewareAgentChatUiEvents([], events));
}

/** Action card title: the last title in the batch that isn't a path or a JSON literal */
export function pickAssistantOpsCardTitle(
  tools: readonly { title: string; toolName: string }[],
): string {
  if (!tools.length) return "Tool";
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const tool = tools[i];
    if (tool && isTodoWriteToolName(tool.toolName)) continue;
    if (tool && isAskUserQuestionToolName(tool.toolName)) continue;
    const t = tool?.title?.trim();
    if (!t) continue;
    if (/^\/(?:Users|var|tmp)\//.test(t)) continue;
    if (isRawJsonLikeToolTitle(t)) continue;
    return t;
  }
  const last = tools[tools.length - 1];
  return fallbackOpsCardTitleFromToolName(last?.toolName);
}

async function coursewareAgentStreamFetch(path: string, init: RequestInit): Promise<Response> {
  const session = await sessionManager.acquireSession();
  const base = coursewareApi.baseUrl.replace(/\/+$/, "");
  if (!base) {
    throw new Error("Courseware agent service base URL (coursewareApi) is not configured");
  }
  const headers = new Headers(init.headers);
  if (session.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  const response = await fetch(`${base}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }
  return response;
}

export default {
  /** `GET /courseware?key=...` */
  async getCourseware(
    key: string,
    signal?: AbortSignal,
    options?: { authRequired?: boolean; renderToken?: string; sectionId?: string },
  ): Promise<CoursewareAgentPersistenceResponse> {
    const k = key.trim();
    if (!k) {
      return { ok: false, error: "missing courseware key" };
    }
    const renderToken = options?.renderToken?.trim();
    // sectionId lets the courseware-service admit enrolled non-members
    // (public-course external students) after verifying the section binding
    // and the backend's read grant for that section (issue #825).
    const sectionId = options?.sectionId?.trim();
    try {
      const parsed = (await coursewareApi.get(
        "/courseware",
        {
          key: k,
          ...(renderToken ? { render_token: renderToken } : {}),
          ...(sectionId ? { sectionId } : {}),
        },
        {
          signal,
          ...COURSEWARE_AGENT_OPTS,
          authRequired: options?.authRequired,
        },
      )) as CoursewareAgentPersistenceResponse;
      if (!parsed.ok || !parsed.courseware) {
        return { ok: false, error: parsed.error || "invalid response" };
      }
      return { ok: true, courseware: parsed.courseware };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** `GET /courseware/versions?key=...` */
  async getCoursewareVersions(
    key: string,
    signal?: AbortSignal,
  ): Promise<CoursewareVersionsListResponse> {
    const k = key.trim();
    if (!k) {
      return { ok: false, error: "missing courseware key" };
    }
    try {
      const parsed = (await coursewareApi.get(
        "/courseware/versions",
        { key: k },
        { signal, ...COURSEWARE_AGENT_OPTS, agentErrorAsResult: true },
      )) as CoursewareVersionsListResponse;
      if (!parsed.ok) {
        return { ok: false, error: parsed.error || "invalid response" };
      }
      return {
        ok: true,
        key: parsed.key,
        versions: Array.isArray(parsed.versions) ? parsed.versions : [],
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** `PUT /courseware?key=...` */
  async putCourseware(
    key: string,
    payload: {
      title?: string | null;
      content: Record<string, unknown>;
      coverUrl?: string | null;
      /** Required when creating a courseware: its organization (must be passed explicitly by the frontend; the server doesn't infer it from the login current_org) */
      orgId?: string;
      /** The `updatedAt` (ISO) last synced from the server; required when updating an existing courseware */
      baseUpdatedAt?: string;
    },
    signal?: AbortSignal,
  ): Promise<CoursewareAgentPersistenceResponse> {
    const k = key.trim();
    if (!k) {
      return { ok: false, error: "missing courseware key" };
    }
    try {
      const parsed = (await coursewareApi.put("/courseware", payload, {
        query: { key: k },
        signal,
        ...COURSEWARE_AGENT_OPTS,
        agentErrorAsResult: true,
      })) as CoursewareAgentPersistenceResponse;
      if (!parsed.ok || !parsed.courseware) {
        return {
          ok: false,
          error: parsed.error || "invalid response",
          serverUpdatedAt: parsed.serverUpdatedAt,
          baseUpdatedAt: parsed.baseUpdatedAt,
        };
      }
      return { ok: true, courseware: parsed.courseware };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** `POST /courseware/cover/upload` (multipart: `coursewareId` + `file`) */
  async uploadCoursewareCover(
    coursewareId: string,
    file: Blob,
    signal?: AbortSignal,
  ): Promise<CoursewareAgentCoverUploadResponse> {
    const id = coursewareId.trim();
    if (!id) {
      return { ok: false, error: "missing courseware id" };
    }
    if (!file || file.size <= 0) {
      return { ok: false, error: "empty cover image" };
    }
    try {
      const session = await sessionManager.acquireSession();
      const form = new FormData();
      form.append("coursewareId", id);
      const ext =
        file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
      form.append("file", file, `cover.${ext}`);
      const headers = new Headers();
      if (session.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
      const base = coursewareApi.baseUrl?.replace(/\/+$/, "") ?? "";
      const response = await fetch(`${base}/courseware/cover/upload`, {
        method: "POST",
        headers,
        body: form,
        signal,
      });
      const parsed = (await response.json().catch(() => ({}))) as CoursewareAgentCoverUploadResponse;
      if (!response.ok || !parsed.ok || !parsed.coverUrl) {
        return {
          ok: false,
          error:
            (typeof parsed.error === "string" && parsed.error.trim()) ||
            `HTTP ${response.status}`,
        };
      }
      const updatedAt =
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
          ? parsed.updatedAt.trim()
          : undefined;
      return { ok: true, coverUrl: parsed.coverUrl, filePath: parsed.filePath, updatedAt };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** `POST /chat/permission` */
  async postPermissionAnswer(
    body: CoursewareAgentPermissionAnswerBody,
    signal?: AbortSignal,
  ): Promise<void> {
    await coursewareApi.post("/chat/permission", body, { signal, ...COURSEWARE_AGENT_OPTS });
  },

  /** `GET /courseware/conversations` */
  async fetchConversationHistory(
    params: { coursewareId?: string; key?: string; conversationId?: string },
    signal?: AbortSignal,
  ): Promise<CoursewareAgentConversationHistoryResult> {
    const cid = params.coursewareId?.trim();
    const k = params.key?.trim();
    const convId = params.conversationId?.trim();
    if (!cid && !k) {
      return { ok: false, error: "Either coursewareId or key is required" };
    }
    try {
      const parsed = (await coursewareApi.get(
        "/courseware/conversations",
        {
          ...(cid ? { coursewareId: cid } : {}),
          ...(k ? { key: k } : {}),
          ...(convId ? { conversationId: convId } : {}),
        },
        { signal, ...COURSEWARE_AGENT_OPTS },
      )) as CoursewareAgentConversationHistoryResult;
      if (!parsed.ok) {
        const err =
          typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : "request failed";
        return { ok: false, error: err };
      }
      return {
        ok: true,
        coursewareId: typeof parsed.coursewareId === "string" ? parsed.coursewareId : undefined,
        conversationId: parsed.conversationId ?? null,
        title: typeof parsed.title === "string" ? parsed.title : null,
        claudeSessionId: parsed.claudeSessionId ?? null,
        livePreviewSessionId: parsed.livePreviewSessionId ?? null,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** `GET /courseware/conversations/history?id=...` — fetch conversation history by conversationId (the workshop's ?c= restore, red team R9). */
  async fetchConversationHistoryById(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<
    | {
        ok: true;
        coursewareId: string;
        conversationId: string | null;
        title: string | null;
        claudeSessionId: string | null;
        messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
      }
    | { ok: false; error: string }
  > {
    const cid = conversationId.trim();
    if (!cid) {
      return { ok: false, error: "conversationId is required" };
    }
    try {
      const parsed = (await coursewareApi.get(
        "/courseware/conversations/history",
        { id: cid },
        { signal, ...COURSEWARE_AGENT_OPTS },
      )) as {
        ok?: boolean;
        error?: string;
        coursewareId?: string;
        conversationId?: string | null;
        title?: string | null;
        claudeSessionId?: string | null;
        messages?: Array<{ id?: string; role?: string; content?: string }>;
      };
      if (!parsed.ok) {
        const err = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : "request failed";
        return { ok: false, error: err };
      }
      const coursewareId = typeof parsed.coursewareId === "string" ? parsed.coursewareId : "";
      if (!coursewareId) {
        return { ok: false, error: "invalid response: missing coursewareId" };
      }
      const messages = Array.isArray(parsed.messages)
        ? parsed.messages
            .map((m, i) => ({
              id: typeof m.id === "string" && m.id ? m.id : `msg-${i}`,
              role: m.role === "user" ? ("user" as const) : ("assistant" as const),
              content: typeof m.content === "string" ? m.content : "",
            }))
            .filter((m) => m.content.trim().length > 0)
        : [];
      return {
        ok: true,
        coursewareId,
        conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : cid,
        title: typeof parsed.title === "string" ? parsed.title : null,
        claudeSessionId: typeof parsed.claudeSessionId === "string" ? parsed.claudeSessionId : null,
        messages,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  /** `GET /courseware/conversations/list` */
  async fetchConversationsList(
    params: { coursewareId?: string; key?: string; limit?: number; kind?: "agent" | "plan" },
    signal?: AbortSignal,
  ): Promise<CoursewareAgentConversationListResult> {
    const cid = params.coursewareId?.trim();
    const k = params.key?.trim();
    if (!cid && !k) {
      return { ok: false, error: "Either coursewareId or key is required" };
    }
    try {
      const parsed = (await coursewareApi.get(
        "/courseware/conversations/list",
        {
          ...(cid ? { coursewareId: cid } : {}),
          ...(k ? { key: k } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
          ...(params.kind ? { kind: params.kind } : {}),
        },
        { signal, ...COURSEWARE_AGENT_OPTS },
      )) as CoursewareAgentConversationListResult;
      if (!parsed.ok) {
        const err =
          typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : "request failed";
        return { ok: false, error: err };
      }
      const conversations = Array.isArray(parsed.conversations)
        ? parsed.conversations
            .map((item): CoursewareAgentConversationListItem | null => {
              if (!item || typeof item !== "object") return null;
              const rec = item as Record<string, unknown>;
              const conversationId =
                typeof rec.conversationId === "string" && rec.conversationId.trim()
                  ? rec.conversationId.trim()
                  : "";
              const createdAt =
                typeof rec.createdAt === "string" && rec.createdAt.trim()
                  ? rec.createdAt.trim()
                  : "";
              const updatedAt =
                typeof rec.updatedAt === "string" && rec.updatedAt.trim()
                  ? rec.updatedAt.trim()
                  : createdAt;
              if (!conversationId || !createdAt || !updatedAt) return null;
              return {
                conversationId,
                title: typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : null,
                kind: rec.kind === "plan" ? "plan" : "agent",
                claudeSessionId:
                  typeof rec.claudeSessionId === "string" && rec.claudeSessionId.trim()
                    ? rec.claudeSessionId.trim()
                    : null,
                livePreviewSessionId:
                  typeof rec.livePreviewSessionId === "string" && rec.livePreviewSessionId.trim()
                    ? rec.livePreviewSessionId.trim()
                    : null,
                messageCount:
                  typeof rec.messageCount === "number" && Number.isFinite(rec.messageCount)
                    ? Math.max(0, Math.floor(rec.messageCount))
                    : 0,
                createdAt,
                updatedAt,
              };
            })
            .filter((item): item is CoursewareAgentConversationListItem => item != null)
        : [];
      return {
        ok: true,
        coursewareId: typeof parsed.coursewareId === "string" ? parsed.coursewareId : undefined,
        conversations,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** `DELETE /courseware/conversations` — without a conversationId deletes every conversation of the courseware */
  async deleteConversations(
    params: { coursewareId?: string; key?: string; conversationId?: string },
    signal?: AbortSignal,
  ): Promise<CoursewareAgentClearHistoryResult> {
    const cid = params.coursewareId?.trim();
    const k = params.key?.trim();
    const conversationId = params.conversationId?.trim();
    if (!cid && !k) {
      throw new Error("Either coursewareId or key is required");
    }
    const parsed = (await coursewareApi.delete(
      "/courseware/conversations",
      undefined,
      {
        query: {
          ...(cid ? { coursewareId: cid } : {}),
          ...(k ? { key: k } : {}),
          ...(conversationId ? { conversationId } : {}),
        },
        signal,
        ...COURSEWARE_AGENT_OPTS,
      },
    )) as {
      ok?: boolean;
      coursewareId?: string;
      deletedConversations?: number;
      deletedTranscriptLines?: number;
      removedWorkspaceDirs?: number;
    };
    return {
      coursewareId: typeof parsed.coursewareId === "string" ? parsed.coursewareId : "",
      deletedConversations:
        typeof parsed.deletedConversations === "number" ? parsed.deletedConversations : 0,
      deletedTranscriptLines:
        typeof parsed.deletedTranscriptLines === "number" ? parsed.deletedTranscriptLines : 0,
      removedWorkspaceDirs:
        typeof parsed.removedWorkspaceDirs === "number" ? parsed.removedWorkspaceDirs : 0,
    };
  },

  /** `POST /chat/stream/abort` — stop server-side agent work for this stream session. */
  async postChatStreamAbort(
    chatStreamSessionId: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; abortedLocally?: boolean; wasRunning?: boolean }> {
    const cs = chatStreamSessionId.trim();
    if (!cs) {
      return { ok: false };
    }
    try {
      const parsed = (await coursewareApi.post(
        "/chat/stream/abort",
        { chatStreamSessionId: cs },
        { signal, ...COURSEWARE_AGENT_OPTS },
      )) as {
        ok?: boolean;
        abortedLocally?: boolean;
        wasRunning?: boolean;
      };
      return {
        ok: parsed.ok === true,
        abortedLocally: parsed.abortedLocally === true,
        wasRunning: parsed.wasRunning === true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Courseware agent stop request failed ${msg}`);
    }
  },

  /** `POST /chat/stream` (SSE, returns the raw Response) */
  async postChatStream(body: CoursewareAgentChatStreamBody, signal?: AbortSignal): Promise<Response> {
    try {
      return await coursewareAgentStreamFetch("/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Courseware agent request failed ${msg}`);
    }
  },

  /** `GET /courseware/stream` (SSE, returns the raw Response) */
  async openLivePreviewStream(
    livePreviewSessionId: string,
    signal?: AbortSignal,
    from: string = REDIS_STREAM_CURSOR_START,
  ): Promise<Response> {
    const lp = livePreviewSessionId.trim();
    const cursor = from.trim() || REDIS_STREAM_CURSOR_START;
    const query = new URLSearchParams({
      livePreviewSessionId: lp,
      from: cursor,
    });
    try {
      return await coursewareAgentStreamFetch(`/courseware/stream?${query.toString()}`, { signal });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Live Preview Stream Connection Failed ${msg}`);
    }
  },

  /** `GET /chat/stream/status` — whether the stream is still running (after a refresh, check first, then decide whether to subscribe) */
  async fetchChatStreamStatus(
    chatStreamSessionId: string,
    signal?: AbortSignal,
  ): Promise<CoursewareAgentChatStreamStatusResult> {
    const cs = chatStreamSessionId.trim();
    if (!cs) {
      return { ok: false, error: "Missing chatStreamSessionId" };
    }
    try {
      const parsed = (await coursewareApi.get(
        "/chat/stream/status",
        { chatStreamSessionId: cs },
        { signal, ...COURSEWARE_AGENT_OPTS },
      )) as CoursewareAgentChatStreamStatusResult;
      if (!parsed.ok) {
        const err =
          typeof parsed.error === "string" && parsed.error.trim()
            ? parsed.error.trim()
            : "request failed";
        return { ok: false, error: err };
      }
      return {
        ok: true,
        chatStreamSessionId:
          typeof parsed.chatStreamSessionId === "string"
            ? parsed.chatStreamSessionId
            : cs,
        active: parsed.active === true,
        status: parsed.status,
        livePreviewSessionId: parsed.livePreviewSessionId ?? null,
        conversationId: parsed.conversationId ?? null,
        lastStreamEntryId:
          typeof parsed.lastStreamEntryId === "string" ? parsed.lastStreamEntryId : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** `GET /chat/stream` — tail Agent chat SSE from Redis (reconnect after POST drop). */
  async openChatStreamSubscribe(
    chatStreamSessionId: string,
    signal?: AbortSignal,
    from: string = REDIS_STREAM_CURSOR_START,
  ): Promise<Response> {
    const cs = chatStreamSessionId.trim();
    const cursor = from.trim() || REDIS_STREAM_CURSOR_START;
    const query = new URLSearchParams({
      chatStreamSessionId: cs,
      from: cursor,
    });
    try {
      return await coursewareAgentStreamFetch(`/chat/stream?${query.toString()}`, { signal });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Agent Chat Stream Connection Failed ${msg}`);
    }
  },
};

/**
 * POST `/chat/stream` starts the turn; on disconnect, GET `/chat/stream` replays from Redis.
 */
export async function runAgentChatStreamWithReconnect(options: {
  postStream: (signal: AbortSignal) => Promise<Response>;
  openSubscribe: (signal: AbortSignal, from: string) => Promise<Response>;
  onEvent: (eventName: string, payload: unknown) => void;
  shouldContinue: () => boolean;
  runSignal: AbortSignal;
  onTransientError?: (error: unknown, attempt: number) => void;
  onReconnecting?: (attempt: number) => void;
  isTerminalEvent?: (eventName: string, payload: unknown) => boolean;
}): Promise<void> {
  let redisStreamCursor = REDIS_STREAM_CURSOR_START;
  let turnCompleted = false;
  let redisReplayEnabled = false;

  const onSseEvent = (eventName: string, payload: unknown): void => {
    const next = readRedisStreamCursorFromSseEvent(eventName, payload);
    if (next) {
      redisStreamCursor = next;
      redisReplayEnabled = true;
    }
    options.onEvent(eventName, payload);
    if (options.isTerminalEvent?.(eventName, payload)) {
      turnCompleted = true;
    }
  };

  const postAbort = new AbortController();
  const onRunAbort = (): void => {
    postAbort.abort();
  };
  options.runSignal.addEventListener("abort", onRunAbort);

  try {
    const res = await options.postStream(postAbort.signal);
    await consumeSseResponse(res, onSseEvent, postAbort.signal);
  } catch (error) {
    if (options.runSignal.aborted) {
      return;
    }
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      options.onTransientError?.(error, 1);
    }
  } finally {
    options.runSignal.removeEventListener("abort", onRunAbort);
  }

  if (turnCompleted || !options.shouldContinue() || options.runSignal.aborted) {
    return;
  }

  // ★The POST stream may be cut before the first streamEntryId (ERR_HTTP2_PROTOCOL_ERROR etc.) —
  // by then the server turn is usually already running with events in Redis. The old logic `!redisReplayEnabled`
  // returned directly → no subscription and no error, so the UI hung forever (red team R1: the plan never appears, the stop button is stuck).
  // Subscribe once from the start whether or not a cursor was received: the server subscription handler replays Redis and resumes
  // the interrupted turn; even the extreme case with truly no events gets Reconnecting feedback instead of silence.
  await runLivePreviewSseWithReconnect({
    openStream: options.openSubscribe,
    onEvent: onSseEvent,
    shouldContinue: () => options.shouldContinue() && !turnCompleted,
    runSignal: options.runSignal,
    initialCursor: redisReplayEnabled ? redisStreamCursor : REDIS_STREAM_CURSOR_START,
    onTransientError: options.onTransientError,
    onReconnecting: options.onReconnecting,
  });
}

/**
 * Page refresh / tab restore: tail `GET /chat/stream` only (no POST). Stops after `done` or `error`.
 */
export async function runAgentChatStreamSubscribeOnly(options: {
  openSubscribe: (signal: AbortSignal, from: string) => Promise<Response>;
  onEvent: (eventName: string, payload: unknown) => void;
  shouldContinue: () => boolean;
  runSignal: AbortSignal;
  initialCursor?: string;
  onTransientError?: (error: unknown, attempt: number) => void;
  onReconnecting?: (attempt: number) => void;
  isTerminalEvent?: (eventName: string, payload: unknown) => boolean;
}): Promise<void> {
  let turnCompleted = false;
  const onSseEvent = (eventName: string, payload: unknown): void => {
    options.onEvent(eventName, payload);
    if (options.isTerminalEvent?.(eventName, payload)) {
      turnCompleted = true;
    }
  };

  await runLivePreviewSseWithReconnect({
    openStream: options.openSubscribe,
    onEvent: onSseEvent,
    shouldContinue: () => options.shouldContinue() && !turnCompleted,
    runSignal: options.runSignal,
    initialCursor: options.initialCursor,
    onTransientError: options.onTransientError,
    onReconnecting: options.onReconnecting,
  });
}
