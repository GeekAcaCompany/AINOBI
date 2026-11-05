// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Extract the last non-empty text from an assistant message's content.
 *
 * The empty-result fallback for OpenAI bridge models (the gpt-6 twins, through the openai_responses protocol bridge):
 * the bridge encodes the model's reasoning output into a redacted_thinking content block at the end of the message, the CLI splits that block
 * into this turn's last text-less assistant message, and the success result comes back empty — then
 * the last assistant text restores the real reply.
 */
export function extractLastAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      text = b.text;
    }
  }
  return text;
}

/**
 * Structured display events of the courseware assistant sidebar (SSE `event: ui`).
 * Fields must match the same-named types in apps/student-frontend `app/api/courseware_agent.ts`.
 */
export type ChatUiTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type ChatUiTodoItem = {
  id?: string;
  content: string;
  status: ChatUiTodoStatus;
};

export type ChatUiUserQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

export type ChatUiUserQuestion = {
  question: string;
  header: string;
  options: ChatUiUserQuestionOption[];
  multiSelect: boolean;
  /** Ainobi extension: when true the host answers with a free input box and shows no option list */
  freeText?: boolean;
};

export type ChatUiEvent =
  | { kind: "prose"; text: string }
  | { kind: "insufficient_org_credits" }
  | { kind: "insufficient_personal_credits" }
  | { kind: "todos_update"; todos: ChatUiTodoItem[]; merge?: boolean }
  | {
      kind: "user_question";
      requestId: string;
      toolUseId: string;
      questions: ChatUiUserQuestion[];
    }
  | {
      kind: "user_question_answered";
      requestId: string;
      toolUseId?: string;
    }
  | {
      kind: "tool_start";
      toolUseId: string;
      toolName: string;
      title: string;
      command?: string;
    }
  | { kind: "tool_output"; toolUseId: string; output: string };

export type ChatUiStreamState = {
  seenTextBlocks: Set<string>;
  seenToolIds: Set<string>;
  toolNamesById: Map<string, string>;
};

export const createChatUiStreamState = (): ChatUiStreamState => ({
  seenTextBlocks: new Set(),
  seenToolIds: new Set(),
  toolNamesById: new Map(),
});

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function readToolFilePath(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  const p = (rec.file_path ?? rec.path) as string | undefined;
  return typeof p === "string" ? p.trim() : "";
}

function isTodoWriteToolName(name: string): boolean {
  return /todo/i.test(name);
}

/** AskUserQuestion is handled by the user_question UI card, so no tool name action bar is shown */
function isAskUserQuestionToolName(name: string): boolean {
  return name === "AskUserQuestion";
}

/** Transcript rebuild / placeholder ids — not the live canUseTool pending key. */
function isSyntheticUserQuestionRequestId(requestId: string): boolean {
  return requestId.startsWith("history:") || requestId.startsWith("session:");
}

/**
 * Parse the AskUserQuestion tool input (with the Ainobi freeText extension).
 * Shared by canUseTool and transcript rebuilding, so history messages don't lose the clarification card.
 */
export function parseAskUserQuestionInput(input: Record<string, unknown>): ChatUiUserQuestion[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];

  const questions: ChatUiUserQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const question = typeof rec.question === "string" ? rec.question.trim() : "";
    const header = typeof rec.header === "string" ? rec.header.trim() : "";
    if (!question || !header) continue;

    const options: ChatUiUserQuestionOption[] = [];
    if (Array.isArray(rec.options)) {
      for (const opt of rec.options) {
        if (!opt || typeof opt !== "object") continue;
        const o = opt as Record<string, unknown>;
        const label = typeof o.label === "string" ? o.label.trim() : "";
        const description = typeof o.description === "string" ? o.description.trim() : "";
        if (!label) continue;
        const preview = typeof o.preview === "string" && o.preview.trim() ? o.preview.trim() : undefined;
        options.push({ label, description, preview });
      }
    }

    // freeText: courseware editing clarifications can be answered with plain text too; fewer than 2 options allowed
    if (rec.freeText === true) {
      questions.push({
        question,
        header,
        options: [],
        multiSelect: false,
        freeText: true,
      });
      continue;
    }

    if (options.length < 2) continue;

    questions.push({
      question,
      header,
      options,
      multiSelect: rec.multiSelect === true,
    });
  }
  return questions;
}

function normalizeTodoStatus(raw: string): ChatUiTodoStatus {
  if (raw === "in_progress" || raw === "completed" || raw === "cancelled") return raw;
  return "pending";
}

export function parseTodoWriteToolInput(
  input: unknown,
): { todos: ChatUiTodoItem[]; merge: boolean } | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if (!Array.isArray(rec.todos)) return null;
  const merge = rec.merge === true;
  const todos: ChatUiTodoItem[] = [];
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

function mergeTodoItems(
  existing: readonly ChatUiTodoItem[],
  incoming: readonly ChatUiTodoItem[],
): ChatUiTodoItem[] {
  const byId = new Map<string, ChatUiTodoItem>();
  const order: string[] = [];
  const keyFor = (item: ChatUiTodoItem, index: number): string =>
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

function findLastTodosBlockIndex(blocks: readonly ChatUiAssistantBlock[]): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.type === "todos") return i;
  }
  return -1;
}

function formatTodoItemsPlainText(items: readonly ChatUiTodoItem[]): string {
  const mark = (status: ChatUiTodoStatus): string => {
    if (status === "completed") return "[x]";
    if (status === "cancelled") return "[-]";
    if (status === "in_progress") return "[~]";
    return "[ ]";
  };
  const lines = items.map((item) => `${mark(item.status)} ${item.content}`);
  return lines.length > 0 ? `Tasks\n${lines.join("\n")}` : "";
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
  return truncate(JSON.stringify(input), 140);
}

function prettifyToolOutputText(text: string): string {
  const cleaned = text.replace(/\nShell cwd was reset to .*$/m, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { ok?: unknown; data?: { version?: string } };
    if (parsed?.ok && parsed?.data && typeof parsed.data.version === "string") {
      return `version ${parsed.data.version}`;
    }
    if (parsed?.ok && parsed?.data) {
      return truncate(JSON.stringify(parsed.data, null, 2), 8000);
    }
  } catch {
    // not json
  }
  return truncate(cleaned, 8000);
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
  const tur = toolUseResult as { stdout?: string } | undefined;
  if (typeof tur?.stdout === "string" && tur.stdout.trim()) {
    return prettifyToolOutputText(tur.stdout.trim());
  }
  if (typeof content === "string") {
    return prettifyToolOutputText(content.trim());
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
    return prettifyToolOutputText(text);
  }
  return "";
}

/** Map a Claude Agent SDK message to sidebar UI events. */
export type MapSdkMessageToChatUiEventsOptions = {
  /**
   * Live turns: build the same pending requestId as canUseTool so preview/SSE stay aligned.
   * History rebuild should omit this and use the synthetic `history:` id.
   */
  askUserQuestionRequestId?: (toolUseId: string) => string;
};

export function mapSdkMessageToChatUiEvents(
  state: ChatUiStreamState,
  message: unknown,
  options?: MapSdkMessageToChatUiEventsOptions,
): ChatUiEvent[] {
  if (!message || typeof message !== "object") return [];
  const m = message as Record<string, unknown>;
  const type = m.type;
  const out: ChatUiEvent[] = [];
  const askUserQuestionRequestId = options?.askUserQuestionRequestId;

  if (type === "system" && m.subtype === "init") {
    return out;
  }

  if (type === "system" && m.subtype === "permission_denied") {
    const denied = m as {
      tool_name?: string;
      message?: string;
      decision_reason?: string;
    };
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
          const input =
            b.input && typeof b.input === "object" && !Array.isArray(b.input)
              ? (b.input as Record<string, unknown>)
              : {};
          const questions = parseAskUserQuestionInput(input);
          if (questions.length > 0) {
            out.push({
              kind: "user_question",
              // Live: match canUseTool pending id. History: synthetic display-only id.
              requestId: askUserQuestionRequestId?.(b.id) ?? `history:${b.id}`,
              toolUseId: b.id,
              questions,
            });
          }
          continue;
        }
        const title = summarizeToolInput(toolName, b.input) || toolName;
        const ev: ChatUiEvent = {
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
      if (toolName && isAskUserQuestionToolName(toolName)) {
        out.push({
          kind: "user_question_answered",
          requestId: askUserQuestionRequestId?.(b.tool_use_id) ?? `history:${b.tool_use_id}`,
          toolUseId: b.tool_use_id,
        });
        continue;
      }
      const output = summarizeToolOutput(b.content, m.tool_use_result, toolName);
      if (!output) continue;
      out.push({ kind: "tool_output", toolUseId: b.tool_use_id, output });
    }
    return out;
  }

  return out;
}

export type ChatUiAssistantBlock =
  | { type: "prose"; text: string }
  | { type: "insufficient_org_credits" }
  | { type: "insufficient_personal_credits" }
  | { type: "todos"; items: ChatUiTodoItem[] }
  | {
      type: "user_question";
      requestId: string;
      toolUseId: string;
      questions: ChatUiUserQuestion[];
      answered?: boolean;
    }
  | {
      type: "tool";
      id: string;
      toolName: string;
      title: string;
      command?: string;
      output?: string;
    };

function proseBlockAlreadyContains(blockText: string, text: string): boolean {
  const base = blockText.trim();
  const piece = text.trim();
  if (!piece) return true;
  if (base === piece) return true;
  if (base.startsWith(`${piece}\n\n`) || base.endsWith(`\n\n${piece}`)) return true;
  return base.includes(`\n\n${piece}\n\n`);
}

/** Merge UI events into the assistant message blocks (same as the student app's `applyCoursewareAgentChatUiEvents`) */
export function applyChatUiEventsToBlocks(
  blocks: readonly ChatUiAssistantBlock[],
  events: readonly ChatUiEvent[],
): ChatUiAssistantBlock[] {
  const next: ChatUiAssistantBlock[] = [...blocks];
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
      const idx = next.findIndex(
        (b) =>
          b.type === "user_question" &&
          (b.requestId === ev.requestId || b.toolUseId === ev.toolUseId),
      );
      if (idx >= 0) {
        const existing = next[idx];
        if (existing.type === "user_question") {
          // Prefer live canUseTool requestId over history/synthetic placeholders.
          const preferIncoming =
            isSyntheticUserQuestionRequestId(existing.requestId) &&
            !isSyntheticUserQuestionRequestId(ev.requestId);
          next[idx] = {
            ...existing,
            requestId: preferIncoming ? ev.requestId : existing.requestId,
            toolUseId: existing.toolUseId || ev.toolUseId,
            questions: ev.questions,
          };
        }
      } else {
        next.push({
          type: "user_question",
          requestId: ev.requestId,
          toolUseId: ev.toolUseId,
          questions: ev.questions,
          answered: false,
        });
      }
      continue;
    }
    if (ev.kind === "user_question_answered") {
      const idx = next.findIndex(
        (b) =>
          b.type === "user_question" &&
          (b.requestId === ev.requestId ||
            (ev.toolUseId != null && b.toolUseId === ev.toolUseId)),
      );
      if (idx >= 0) {
        const block = next[idx];
        if (block.type === "user_question") {
          next[idx] = { ...block, answered: true };
        }
      }
      continue;
    }
    if (ev.kind === "todos_update") {
      const items = ev.todos;
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
      next.push({
        type: "tool",
        id: ev.toolUseId,
        toolName: ev.toolName,
        title: ev.title.trim() || ev.toolName,
        command: ev.command,
      });
      continue;
    }
    if (ev.kind === "tool_output") {
      const idx = next.findIndex((b) => b.type === "tool" && b.id === ev.toolUseId);
      if (idx >= 0) {
        const tool = next[idx];
        if (tool.type === "tool") {
          next[idx] = { ...tool, output: ev.output };
        }
      } else {
        next.push({
          type: "tool",
          id: ev.toolUseId,
          toolName: "tool",
          title: "Handling",
          output: ev.output,
        });
      }
    }
  }
  return next;
}

export function chatUiBlocksToPlainText(blocks: readonly ChatUiAssistantBlock[]): string {
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
    if (block.type === "todos") {
      const text = formatTodoItemsPlainText(block.items);
      if (text) parts.push(text);
      continue;
    }
    if (block.type === "user_question") {
      const lines = block.questions.map((q) => `? ${q.header}: ${q.question}`);
      parts.push(`Pending confirmation\n${lines.join("\n")}`);
      continue;
    }
    parts.push(`· ${block.toolName}: ${block.title}`);
    if (block.command) parts.push(`  $ ${block.command}`);
    if (block.output) parts.push(`  → ${block.output}`);
  }
  return parts.join("\n\n").trim();
}
