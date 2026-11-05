// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource, EntityManager } from "typeorm";
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import { CoursewareSessionTranscriptLine } from "../models/courseware-conversation.ts";
import {
  archiveToolResultIfLarge,
  archiveToolUseInputIfLarge,
  isArchivedToolResultStub,
  isArchivedToolUseInputStub,
  rewriteAssistantToolUseInputs,
  rewriteEntryToolResults,
  shouldSkipArchiveForReadPath,
  stringifyToolResponse,
  type ToolResultArchiveContext,
} from "../services/agent-tool-result-archive.ts";
import {
  type PendingTranscriptPromptSplit,
  trySplitMirroredUserEntry,
} from "./transcript-editor-context.ts";
import { computeExposeInUserChat } from "./transcript-entry-ui.ts";
import { deepStripPresignQueries } from "../services/presign-url-sanitize.ts";
// TypeORM's deep-partial type rejects jsonb (Record) columns; values pass through.
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity.js";

export type PgSessionStoreHooks = {
  /** Called after every mirror append, so the projectKey can be written back to the business conversation table */
  afterAppend?: (key: SessionKey, entries: SessionStoreEntry[]) => void;
  /** This chat turn's user / editor / query split, used to write two transcript lines at mirror time */
  getPendingTranscriptPromptSplit?: () => PendingTranscriptPromptSplit | undefined;
  consumePendingTranscriptPromptSplit?: () => void;
  /** Oversized tool_result archival for durable resume stubs */
  toolResultArchive?: ToolResultArchiveContext | null;
  /**
   * Rewrite the entries on load. Used when a conversation resumes under a model from a different
   * provider: foreign thinking blocks are protocol-incompatible upstream (the Responses API rejects
   * a `reasoning` input item that carries text, which is exactly what another provider's plaintext
   * `thinking` block converts into).
   */
  transformLoadedEntries?: (entries: SessionStoreEntry[]) => SessionStoreEntry[];
};

function normalizeSubpath(subpath: string | undefined): string {
  return subpath ?? "";
}

function expandMirroredEntries(
  entries: SessionStoreEntry[],
  hooks?: PgSessionStoreHooks,
): SessionStoreEntry[] {
  const pending = hooks?.getPendingTranscriptPromptSplit?.();
  if (!pending?.editorContext) {
    return entries;
  }

  const expanded: SessionStoreEntry[] = [];
  let consumed = false;
  for (const entry of entries) {
    const split = consumed ? null : trySplitMirroredUserEntry(entry, pending);
    if (split) {
      expanded.push(...split);
      consumed = true;
    } else {
      expanded.push(entry);
    }
  }

  if (consumed) {
    hooks?.consumePendingTranscriptPromptSplit?.();
  }

  return expanded;
}

function extractWriteFilePath(input: Record<string, unknown>): string | null {
  for (const key of ["file_path", "path", "filePath"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

async function stubOversizedEntriesForArchive(
  key: SessionKey,
  entries: SessionStoreEntry[],
  archive: ToolResultArchiveContext | null | undefined,
): Promise<SessionStoreEntry[]> {
  if (!archive?.dataSource?.isInitialized) {
    return entries;
  }

  const stubByToolUseId = new Map<string, string>();
  const inputStubByToolUseId = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === "assistant") {
      const message = (entry as { message?: { content?: unknown } }).message;
      if (!message || !Array.isArray(message.content)) {
        continue;
      }
      for (const block of message.content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const b = block as {
          type?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        };
        if (b.type !== "tool_use" || typeof b.id !== "string") {
          continue;
        }
        if (b.name !== "Write" && b.name !== "Edit") {
          continue;
        }
        const filePath = b.input ? extractWriteFilePath(b.input) : null;
        const content =
          typeof b.input?.content === "string"
            ? b.input.content
            : b.input?.content != null
              ? JSON.stringify(b.input.content)
              : "";
        if (!content || isArchivedToolUseInputStub(content)) {
          if (isArchivedToolUseInputStub(content)) {
            inputStubByToolUseId.set(b.id, content);
          }
          continue;
        }
        try {
          const outcome = await archiveToolUseInputIfLarge(
            { ...archive, sessionId: archive.sessionId || key.sessionId },
            {
              toolUseId: b.id,
              toolName: b.name,
              filePath: filePath ?? "(unknown)",
              rawContent: content,
            },
          );
          if (outcome.archived && outcome.stub) {
            inputStubByToolUseId.set(b.id, outcome.stub);
          }
        } catch (error) {
          console.warn(
            "[tool-result-archive] SessionStore Write input archive failed:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      continue;
    }

    if (entry.type !== "user") {
      continue;
    }
    const message = (entry as { message?: { content?: unknown } }).message;
    if (!message || !Array.isArray(message.content)) {
      continue;
    }
    for (const block of message.content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const b = block as { type?: string; tool_use_id?: string; content?: unknown };
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") {
        continue;
      }
      const raw = stringifyToolResponse(b.content);
      if (!raw || isArchivedToolResultStub(raw)) {
        if (isArchivedToolResultStub(raw)) {
          stubByToolUseId.set(b.tool_use_id, raw);
        }
        continue;
      }
      // Heuristic: skip SKILL.md-looking content that is the L0 bootstrap text
      if (raw.includes("# AINOBI Courseware CLI (L0 core)") || raw.includes("name: ainobi-courseware-cli")) {
        const looksLikeSkill =
          raw.includes("## Topic index (L1") || raw.includes("L0 bootstrap");
        if (looksLikeSkill && shouldSkipArchiveForReadPath(".claude/skills/ainobi-courseware-cli/SKILL.md")) {
          continue;
        }
      }
      try {
        const outcome = await archiveToolResultIfLarge(
          { ...archive, sessionId: archive.sessionId || key.sessionId },
          {
            toolUseId: b.tool_use_id,
            toolName: "tool_result",
            rawOutput: raw,
          },
        );
        if (outcome.archived && outcome.stub) {
          stubByToolUseId.set(b.tool_use_id, outcome.stub);
        }
      } catch (error) {
        console.warn(
          "[tool-result-archive] SessionStore append archive failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (stubByToolUseId.size === 0 && inputStubByToolUseId.size === 0) {
    return entries;
  }

  return entries.map((entry) => {
    let rewritten = rewriteEntryToolResults(entry as Record<string, unknown>, stubByToolUseId);
    rewritten = rewriteAssistantToolUseInputs(rewritten, inputStubByToolUseId);
    return rewritten as SessionStoreEntry;
  });
}

async function insertTranscriptLines(em: EntityManager, key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
  const subpath = normalizeSubpath(key.subpath);
  for (const e of entries) {
    // Tool outputs embed presigned URLs — signatures expire, so the persisted
    // transcript keeps only signature-free URLs / keys (see presign-url-sanitize).
    const persisted = deepStripPresignQueries(e) as SessionStoreEntry;
    const entryUuid = typeof persisted.uuid === "string" && persisted.uuid ? persisted.uuid : null;
    const exposeInUserChat = computeExposeInUserChat(persisted);
    const row = {
      projectKey: key.projectKey,
      sessionId: key.sessionId,
      subpath,
      entry: persisted as Record<string, unknown>,
      entryUuid,
      exposeInUserChat,
    };
    if (entryUuid) {
      await em.query(
        `INSERT INTO "courseware_session_transcript_line"
          ("project_key", "session_id", "subpath", "entry", "entry_uuid", "expose_in_user_chat")
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT ("project_key", "session_id", "subpath", "entry_uuid")
         WHERE ("entry_uuid" IS NOT NULL)
         DO NOTHING`,
        [
          row.projectKey,
          row.sessionId,
          row.subpath,
          JSON.stringify(row.entry),
          row.entryUuid,
          row.exposeInUserChat,
        ],
      );
    } else {
      await em
        .getRepository(CoursewareSessionTranscriptLine)
        .insert(row as QueryDeepPartialEntity<CoursewareSessionTranscriptLine>);
    }
  }
}

/**
 * Postgres SessionStore: double-writes the SDK transcript to the database, so any stateless pod materializes the JSONL from the DB on resume.
 * @see https://github.com/anthropics/claude-agent-sdk-typescript for the SessionStore contract
 */
export function createPgSessionStore(dataSource: DataSource, hooks?: PgSessionStoreHooks): SessionStore {
  /** Apply the host's load-time rewrite (identity when none is configured) */
  const applyTransform = (entries: SessionStoreEntry[]): SessionStoreEntry[] =>
    hooks?.transformLoadedEntries?.(entries) ?? entries;
  return {
    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
      if (entries.length === 0) {
        return;
      }
      const mirrored = expandMirroredEntries(entries, hooks);
      const stubbed = await stubOversizedEntriesForArchive(key, mirrored, hooks?.toolResultArchive);
      await dataSource.transaction(async (em) => {
        await insertTranscriptLines(em, key, stubbed);
      });

      hooks?.afterAppend?.(key, entries);
    },

    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      const subpath = normalizeSubpath(key.subpath);
      const repo = dataSource.getRepository(CoursewareSessionTranscriptLine);
      const rows = await repo.find({
        where: { projectKey: key.projectKey, sessionId: key.sessionId, subpath },
        order: { id: "ASC" },
        select: ["entry"],
      });
      if (rows.length === 0) {
        // Migration-compatible fallback: projectKey encodes the workspace's absolute path (FC=/code/… →
        // OKE=/app/…); once the deploy root changes, old sessions can never be found by the new key → resume reports
        // "No conversation found". The sessionId is globally unique and bound one-to-one to the workspace,
        // so falling back by it across projectKeys recovers the old environment's transcript losslessly.
        const fallbackRows = await repo.find({
          where: { sessionId: key.sessionId, subpath },
          order: { id: "ASC" },
          select: ["entry"],
        });
        if (fallbackRows.length === 0) {
          console.info(`[pg-store] load fallback: 0 rows for session=${key.sessionId?.slice(0, 8)} (含跨键查询)`);
          return null;
        }
        console.info(`[pg-store] load fallback HIT: ${fallbackRows.length} rows for session=${key.sessionId?.slice(0, 8)}`);
        return applyTransform(fallbackRows.map((r) => r.entry as SessionStoreEntry));
      }
      return applyTransform(rows.map((r) => r.entry as SessionStoreEntry));
    },

    async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
      const raw: Array<{ session_id: string; mtime: string }> = await dataSource.query(
        `SELECT "session_id" AS session_id,
                (EXTRACT(EPOCH FROM MAX("created_at")) * 1000)::bigint AS mtime
           FROM "courseware_session_transcript_line"
          WHERE "project_key" = $1
          GROUP BY "session_id"`,
        [projectKey],
      );
      return raw.map((r) => ({
        sessionId: r.session_id,
        mtime: Number(r.mtime),
      }));
    },

    async delete(key: SessionKey): Promise<void> {
      const qb = dataSource
        .getRepository(CoursewareSessionTranscriptLine)
        .createQueryBuilder()
        .delete()
        .where('"project_key" = :pk AND "session_id" = :sid', { pk: key.projectKey, sid: key.sessionId });
      const sp = key.subpath;
      if (sp != null && sp !== "") {
        qb.andWhere('"subpath" = :sub', { sub: sp });
      }
      await qb.execute();
    },

    async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
      const raw: Array<{ subpath: string }> = await dataSource.query(
        `SELECT DISTINCT "subpath" AS subpath
           FROM "courseware_session_transcript_line"
          WHERE "project_key" = $1 AND "session_id" = $2 AND "subpath" <> ''`,
        [key.projectKey, key.sessionId],
      );
      return raw.map((r) => r.subpath);
    },
  };
}
