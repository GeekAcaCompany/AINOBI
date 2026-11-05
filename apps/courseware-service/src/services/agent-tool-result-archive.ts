// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from "typeorm";

import { CoursewareToolResultBlob } from "../models/courseware-tool-result-blob.ts";
import { stripPresignQueriesInText } from "./presign-url-sanitize.ts";

/** Archive tool outputs at or above this size (chars). Matches CLI compactLargeStrings threshold. */
export const TOOL_RESULT_ARCHIVE_THRESHOLD = 4096;

/** Archive Write/Edit batch plan bodies at this lower threshold (tool_use input, not stdout). */
export const TOOL_USE_BATCH_WRITE_ARCHIVE_THRESHOLD = 1800;

export const TOOL_RESULT_PREVIEW_CHARS = 400;

const ARCHIVED_INPUT_MARKER = "[tool_use input archived]";

/** Max chars returned by a single `ainobi recall` (full body may be larger in storage). */
export const TOOL_RESULT_RECALL_MAX_CHARS = 32_000;

const ARCHIVED_MARKER = "[tool_result archived]";

export type ToolResultArchiveContext = {
  dataSource: DataSource;
  conversationId?: string | null;
  sessionId?: string | null;
};

export type ArchiveToolResultArgs = {
  toolUseId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  rawOutput: string;
  /** When true, never archive (e.g. L0 SKILL.md Read). */
  skipArchive?: boolean;
};

export type ArchiveToolResultOutcome = {
  archived: boolean;
  stub?: string;
  blobId?: string;
  byteSize?: number;
};

type TurnArchiveStats = {
  count: number;
  bytes: number;
};

const turnStatsByConversation = new Map<string, TurnArchiveStats>();

export function resetToolResultArchiveTurnStats(conversationId?: string | null): void {
  const key = conversationId?.trim();
  if (key) {
    turnStatsByConversation.set(key, { count: 0, bytes: 0 });
  }
}

export function getToolResultArchiveTurnStats(conversationId?: string | null): TurnArchiveStats {
  const key = conversationId?.trim();
  if (!key) {
    return { count: 0, bytes: 0 };
  }
  return turnStatsByConversation.get(key) ?? { count: 0, bytes: 0 };
}

function bumpTurnStats(conversationId: string | null | undefined, bytes: number): void {
  const key = conversationId?.trim();
  if (!key) {
    return;
  }
  const prev = turnStatsByConversation.get(key) ?? { count: 0, bytes: 0 };
  turnStatsByConversation.set(key, {
    count: prev.count + 1,
    bytes: prev.bytes + bytes,
  });
}

export function isArchivedToolResultStub(text: string): boolean {
  return text.trimStart().startsWith(ARCHIVED_MARKER);
}

export function stringifyToolResponse(toolResponse: unknown): string {
  if (typeof toolResponse === "string") {
    return toolResponse;
  }
  if (toolResponse == null) {
    return "";
  }
  if (Array.isArray(toolResponse)) {
    const parts: string[] = [];
    for (const block of toolResponse) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const rec = block as { type?: string; text?: string; content?: unknown };
      if (typeof rec.text === "string") {
        parts.push(rec.text);
      } else if (typeof rec.content === "string") {
        parts.push(rec.content);
      } else if (rec.content != null) {
        parts.push(JSON.stringify(rec.content));
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  try {
    return JSON.stringify(toolResponse, null, 2);
  } catch {
    return String(toolResponse);
  }
}

function summarizeCommand(toolName: string, toolInput?: Record<string, unknown>): string {
  if (toolName === "Bash") {
    const command = typeof toolInput?.command === "string" ? toolInput.command.trim() : "";
    if (!command) {
      return "Bash";
    }
    return command.length > 200 ? `${command.slice(0, 200)}…` : command;
  }
  if (toolName === "Read") {
    const path =
      (typeof toolInput?.file_path === "string" && toolInput.file_path) ||
      (typeof toolInput?.path === "string" && toolInput.path) ||
      (typeof toolInput?.filePath === "string" && toolInput.filePath) ||
      "";
    return path ? `Read ${path}` : "Read";
  }
  if (toolName === "Write" || toolName === "Edit") {
    const path =
      (typeof toolInput?.file_path === "string" && toolInput.file_path) ||
      (typeof toolInput?.path === "string" && toolInput.path) ||
      "";
    return path ? `${toolName} ${path}` : toolName;
  }
  return toolName;
}

export function isBatchPlanWritePath(filePath: string | null | undefined): boolean {
  if (!filePath) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, "/");
  return /\/batch\/[^/]+\.json$/i.test(normalized);
}

function countBatchOperationsInText(content: string): number | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const ops = (parsed as { operations?: unknown }).operations;
      if (Array.isArray(ops)) {
        return ops.length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function shouldArchiveBatchWriteContent(
  filePath: string | null | undefined,
  content: string,
): boolean {
  const text = content.trim();
  if (!text) {
    return false;
  }
  const opCount = countBatchOperationsInText(text);
  if (isBatchPlanWritePath(filePath)) {
    if (opCount != null && opCount > 0 && text.length >= 512) {
      return true;
    }
    if (text.length >= TOOL_USE_BATCH_WRITE_ARCHIVE_THRESHOLD) {
      return true;
    }
    return false;
  }
  if (text.length < TOOL_RESULT_ARCHIVE_THRESHOLD) {
    return false;
  }
  return opCount != null && opCount > 0;
}

export function buildToolUseInputStub(args: {
  toolUseId: string;
  toolName: string;
  filePath: string;
  rawContent: string;
  blobId: string;
}): string {
  const opCount = countBatchOperationsInText(args.rawContent);
  const lines = [
    ARCHIVED_INPUT_MARKER,
    `id: ${args.blobId}`,
    `tool_use_id: ${args.toolUseId}`,
    `tool: ${args.toolName}`,
    `path: ${args.filePath}`,
    `bytes: ${Buffer.byteLength(args.rawContent, "utf8")}`,
  ];
  if (opCount != null) {
    lines.push(`operations_count: ${opCount}`);
  }
  lines.push(`recall: ainobi recall ${args.blobId}`);
  lines.push(
    "note: Batch plan body archived from Write tool input. File remains on disk under work_dir/batch/.",
  );
  return lines.join("\n");
}

export function isArchivedToolUseInputStub(text: string): boolean {
  return text.trimStart().startsWith(ARCHIVED_INPUT_MARKER);
}

/**
 * Namespace tool_use ids in the blob table so Write-input archives and
 * tool-result archives for the same tool_use_id do not overwrite each other.
 */
export function archiveStorageToolUseId(
  kind: "result" | "input",
  toolUseId: string,
): string {
  const id = toolUseId.trim();
  if (!id) {
    return id;
  }
  if (kind === "input") {
    return id.startsWith("input:") ? id : `input:${id}`;
  }
  return id.startsWith("result:") ? id : `result:${id}`;
}

function extractDecisionFields(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return out;
  }
  const root = parsed as Record<string, unknown>;
  if (typeof root.ok === "boolean") {
    out.ok = root.ok;
  }
  if (root.error != null) {
    out.error =
      typeof root.error === "object"
        ? summarizeErrorObject(root.error as Record<string, unknown>)
        : root.error;
  }
  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const key of [
      "slide_id",
      "element_id",
      "question_id",
      "quiz_question_id",
      "scene_id",
      "count",
      "slide_index",
      "type",
      "name",
      "operations_applied",
      "dirty",
      "dry_run",
      // image generate / asset paths — must survive archive stubs (URLs sit after fat `asset`)
      "source",
      "file_id",
      "file_name",
      "html_path",
      "image_path",
    ]) {
      if (d[key] == null) continue;
      if (typeof d[key] === "number" || typeof d[key] === "boolean") {
        out[key] = d[key];
        continue;
      }
      if (typeof d[key] === "string") {
        const s = d[key] as string;
        // Keep full asset URLs (typically <500); hard-cap extreme signed URLs.
        out[key] = s.length > 2048 ? `${s.slice(0, 2048)}…` : s;
      }
    }
    if (Array.isArray(d.children) || Array.isArray(d.children_elements)) {
      const children = (d.children ?? d.children_elements) as unknown[];
      out.children_count = children.length;
    }
    if (Array.isArray(d.slides)) {
      out.slides_count = d.slides.length;
    }
    if (Array.isArray(d.questions)) {
      out.questions_count = d.questions.length;
    }
    if (Array.isArray(d.warnings)) {
      out.warnings = d.warnings.slice(0, 8);
    }
  }
  if (Array.isArray(root.warnings)) {
    out.warnings = (root.warnings as unknown[]).slice(0, 8);
  }
  return out;
}

function summarizeErrorObject(error: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof error.message === "string") {
    out.message = error.message.slice(0, 500);
  }
  if (typeof error.code === "string") {
    out.code = error.code;
  }
  if (Array.isArray(error.issues)) {
    out.issues_count = error.issues.length;
    out.issues = error.issues.slice(0, 5);
  }
  return out;
}

export function buildToolResultStub(args: {
  toolUseId: string;
  toolName: string;
  commandSummary: string;
  rawOutput: string;
  blobId: string;
}): string {
  const decision = extractDecisionFields(args.rawOutput);
  const preview = args.rawOutput.slice(0, TOOL_RESULT_PREVIEW_CHARS);
  const lines = [
    ARCHIVED_MARKER,
    `id: ${args.blobId}`,
    `tool_use_id: ${args.toolUseId}`,
    `tool: ${args.toolName}`,
    `summary: ${args.commandSummary}`,
    `bytes: ${Buffer.byteLength(args.rawOutput, "utf8")}`,
  ];
  if (Object.keys(decision).length > 0) {
    lines.push(`decision: ${JSON.stringify(decision)}`);
  }
  lines.push(`preview: ${preview}${args.rawOutput.length > TOOL_RESULT_PREVIEW_CHARS ? "…" : ""}`);
  lines.push(`recall: ainobi recall ${args.blobId}`);
  return lines.join("\n");
}

export function shouldSkipArchiveForReadPath(filePath: string | null | undefined): boolean {
  if (!filePath) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, "/");
  // Never archive L0 SKILL.md in the live turn — bootstrap instructions must stay intact.
  return (
    normalized.endsWith("/.claude/skills/ainobi-courseware-cli/SKILL.md") ||
    normalized.endsWith(".claude/skills/ainobi-courseware-cli/SKILL.md") ||
    normalized === ".claude/skills/ainobi-courseware-cli/SKILL.md"
  );
}

/**
 * Persist oversized tool output and return a structured stub for the model / transcript.
 */
export async function archiveToolResultIfLarge(
  ctx: ToolResultArchiveContext,
  args: ArchiveToolResultArgs,
): Promise<ArchiveToolResultOutcome> {
  if (args.skipArchive) {
    return { archived: false };
  }
  const raw = args.rawOutput;
  if (raw.length < TOOL_RESULT_ARCHIVE_THRESHOLD) {
    return { archived: false };
  }
  // Keep short failure signals readable even when wrapped in large envelopes.
  if (raw.length < TOOL_RESULT_ARCHIVE_THRESHOLD * 2) {
    try {
      const parsed = JSON.parse(raw) as { ok?: boolean };
      if (parsed && parsed.ok === false) {
        return { archived: false };
      }
    } catch {
      /* not JSON */
    }
  }

  const sessionId = ctx.sessionId?.trim() || "unknown";
  const rawToolUseId = args.toolUseId.trim();
  if (!rawToolUseId) {
    return { archived: false };
  }
  const toolUseId = archiveStorageToolUseId("result", rawToolUseId);

  // Tool outputs embed presigned URLs — persist the signature-free forms
  // (signatures expire; see presign-url-sanitize).
  const persistedRaw = stripPresignQueriesInText(raw);
  const commandSummary = summarizeCommand(args.toolName, args.toolInput);
  const preview = persistedRaw.slice(0, TOOL_RESULT_PREVIEW_CHARS);
  const byteSize = Buffer.byteLength(persistedRaw, "utf8");
  const repo = ctx.dataSource.getRepository(CoursewareToolResultBlob);

  let blob: CoursewareToolResultBlob;
  const existing = await repo.findOne({
    where: { sessionId, toolUseId },
  });
  if (existing) {
    existing.content = persistedRaw;
    existing.preview = preview;
    existing.byteSize = byteSize;
    existing.toolName = args.toolName;
    existing.commandSummary = commandSummary;
    if (ctx.conversationId?.trim()) {
      existing.conversationId = ctx.conversationId.trim();
    }
    blob = await repo.save(existing);
  } else {
    blob = await repo.save(
      repo.create({
        conversationId: ctx.conversationId?.trim() || null,
        sessionId,
        toolUseId,
        toolName: args.toolName,
        commandSummary,
        preview,
        content: persistedRaw,
        byteSize,
      }),
    );
  }

  const stub = buildToolResultStub({
    toolUseId: rawToolUseId,
    toolName: args.toolName,
    commandSummary,
    rawOutput: persistedRaw,
    blobId: blob.id,
  });

  bumpTurnStats(ctx.conversationId, byteSize);

  return { archived: true, stub, blobId: blob.id, byteSize };
}

export type ArchiveToolUseInputArgs = {
  toolUseId: string;
  toolName: string;
  filePath: string;
  rawContent: string;
};

/**
 * Persist oversized Write/Edit batch plan bodies; return a short stub for transcript tool_use input.
 */
export async function archiveToolUseInputIfLarge(
  ctx: ToolResultArchiveContext,
  args: ArchiveToolUseInputArgs,
): Promise<ArchiveToolResultOutcome> {
  if (!shouldArchiveBatchWriteContent(args.filePath, args.rawContent)) {
    return { archived: false };
  }

  const sessionId = ctx.sessionId?.trim() || "unknown";
  const rawToolUseId = args.toolUseId.trim();
  if (!rawToolUseId) {
    return { archived: false };
  }
  const toolUseId = archiveStorageToolUseId("input", rawToolUseId);

  const commandSummary = summarizeCommand(args.toolName, {
    file_path: args.filePath,
  });
  const preview = args.rawContent.slice(0, TOOL_RESULT_PREVIEW_CHARS);
  const byteSize = Buffer.byteLength(args.rawContent, "utf8");
  const repo = ctx.dataSource.getRepository(CoursewareToolResultBlob);

  let blob: CoursewareToolResultBlob;
  const existing = await repo.findOne({
    where: { sessionId, toolUseId },
  });
  if (existing) {
    existing.content = args.rawContent;
    existing.preview = preview;
    existing.byteSize = byteSize;
    existing.toolName = args.toolName;
    existing.commandSummary = commandSummary;
    if (ctx.conversationId?.trim()) {
      existing.conversationId = ctx.conversationId.trim();
    }
    blob = await repo.save(existing);
  } else {
    blob = await repo.save(
      repo.create({
        conversationId: ctx.conversationId?.trim() || null,
        sessionId,
        toolUseId,
        toolName: args.toolName,
        commandSummary,
        preview,
        content: args.rawContent,
        byteSize,
      }),
    );
  }

  const stub = buildToolUseInputStub({
    toolUseId: rawToolUseId,
    toolName: args.toolName,
    filePath: args.filePath,
    rawContent: args.rawContent,
    blobId: blob.id,
  });

  bumpTurnStats(ctx.conversationId, byteSize);

  return { archived: true, stub, blobId: blob.id, byteSize };
}

/** Rewrite assistant tool_use Write/Edit inputs when batch plan bodies were archived. */
export function rewriteAssistantToolUseInputs(
  entry: Record<string, unknown>,
  stubByToolUseId: Map<string, string>,
): Record<string, unknown> {
  if (entry.type !== "assistant") {
    return entry;
  }
  const message = entry.message as { content?: unknown } | undefined;
  if (!message || !Array.isArray(message.content)) {
    return entry;
  }
  let changed = false;
  const content = message.content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const b = block as {
      type?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    };
    if (b.type !== "tool_use" || typeof b.id !== "string") {
      return block;
    }
    const stub = stubByToolUseId.get(b.id);
    if (!stub || !b.input || typeof b.input !== "object") {
      return block;
    }
    const current =
      typeof b.input.content === "string"
        ? b.input.content
        : b.input.content != null
          ? JSON.stringify(b.input.content)
          : "";
    if (current === stub || isArchivedToolUseInputStub(current)) {
      return block;
    }
    changed = true;
    return {
      ...b,
      input: {
        ...b.input,
        content: stub,
      },
    };
  });
  if (!changed) {
    return entry;
  }
  return {
    ...entry,
    message: {
      ...message,
      content,
    },
  };
}

export async function recallToolResultBlob(args: {
  dataSource: DataSource;
  id: string;
  conversationId?: string | null;
  sessionId?: string | null;
}): Promise<{
  id: string;
  toolName: string;
  commandSummary: string | null;
  content: string;
  truncated: boolean;
  byteSize: number;
} | null> {
  const id = args.id.trim();
  if (!id) {
    return null;
  }
  const repo = args.dataSource.getRepository(CoursewareToolResultBlob);
  const blob = await repo.findOne({ where: { id } });
  if (!blob) {
    return null;
  }
  const conversationId = args.conversationId?.trim();
  const sessionId = args.sessionId?.trim();
  if (conversationId && blob.conversationId && blob.conversationId !== conversationId) {
    return null;
  }
  if (sessionId && blob.sessionId !== sessionId) {
    return null;
  }

  let content = blob.content;
  let truncated = false;
  if (content.length > TOOL_RESULT_RECALL_MAX_CHARS) {
    content =
      content.slice(0, TOOL_RESULT_RECALL_MAX_CHARS) +
      `\n…(truncated at ${TOOL_RESULT_RECALL_MAX_CHARS} chars; prefer ainobi slide get / element get for live scene state)`;
    truncated = true;
  }

  return {
    id: blob.id,
    toolName: blob.toolName,
    commandSummary: blob.commandSummary,
    content,
    truncated,
    byteSize: blob.byteSize,
  };
}

export async function listRecentToolResultIndex(args: {
  dataSource: DataSource;
  conversationId?: string | null;
  sessionId?: string | null;
  limit?: number;
}): Promise<Array<{ id: string; summary: string }>> {
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 50);
  const repo = args.dataSource.getRepository(CoursewareToolResultBlob);
  const where: { conversationId?: string; sessionId?: string } = {};
  if (args.conversationId?.trim()) {
    where.conversationId = args.conversationId.trim();
  } else if (args.sessionId?.trim()) {
    where.sessionId = args.sessionId.trim();
  } else {
    return [];
  }
  const rows = await repo.find({
    where,
    order: { createdAt: "DESC" },
    take: limit,
    select: ["id", "commandSummary", "toolName"],
  });
  return rows.map((row) => ({
    id: row.id,
    summary: row.commandSummary || row.toolName,
  }));
}

export function formatToolResultIndexContext(
  entries: Array<{ id: string; summary: string }>,
): string {
  if (entries.length === 0) {
    return "";
  }
  const lines = [
    "## Archived tool results (index)",
    "Large prior tool outputs were archived. Use `ainobi recall <id>` only when you need full detail.",
    ...entries.map((e) => `- ${e.id}: ${e.summary}`),
  ];
  return lines.join("\n");
}

/** Rewrite tool_result blocks inside a SessionStore entry when content is oversized / already stubbed. */
export function rewriteEntryToolResults(
  entry: Record<string, unknown>,
  stubByToolUseId: Map<string, string>,
): Record<string, unknown> {
  if (entry.type !== "user") {
    return entry;
  }
  const message = entry.message as { content?: unknown } | undefined;
  if (!message || !Array.isArray(message.content)) {
    return entry;
  }
  let changed = false;
  const content = message.content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const b = block as { type?: string; tool_use_id?: string; content?: unknown };
    if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") {
      return block;
    }
    const stub = stubByToolUseId.get(b.tool_use_id);
    if (!stub) {
      return block;
    }
    const current =
      typeof b.content === "string"
        ? b.content
        : b.content != null
          ? JSON.stringify(b.content)
          : "";
    if (current === stub || isArchivedToolResultStub(current)) {
      return block;
    }
    changed = true;
    return { ...b, content: stub };
  });
  if (!changed) {
    return entry;
  }
  return {
    ...entry,
    message: {
      ...message,
      content,
    },
  };
}
