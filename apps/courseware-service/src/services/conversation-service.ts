// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { In, type EntityManager, type Repository } from "typeorm";

import type { CoursewareActorContext } from "../auth/ainobi-org-access.ts";
import { dataSource } from "../db/db.ts";
import { Courseware } from "../models/courseware.ts";
import { CoursewareConversation, CoursewareSessionTranscriptLine } from "../models/courseware-conversation.ts";
import { CoursewareToolResultBlob } from "../models/courseware-tool-result-blob.ts";
import { getCoursewareEntityById } from "./courseware-service.ts";
import { coursewareCliRoot } from "../runtime-paths.ts";
import { recordCoursewareAuditLog } from "./courseware-audit-log-service.ts";

/** Conversation kind: `agent` (default, edits the courseware directly) or `plan` (courseware design planning). */
export type CoursewareConversationKind = "agent" | "plan";

export function normalizeCoursewareConversationKind(
  value: string | null | undefined,
): CoursewareConversationKind {
  return value?.trim() === "plan" ? "plan" : "agent";
}

export type ChatConversationBody = {
  conversationId?: string;
  coursewareKey?: string;
  /** Courseware table uuid; can be passed with conversationId to bind/switch the courseware, or alone to reuse that courseware's latest conversation */
  coursewareId?: string;
  sessionId?: string;
  livePreviewSessionId?: string;
  /** When true, a new courseware_conversation is forced even for the same courseware (the latest thread isn't reused) */
  newConversation?: boolean;
  /** Conversation kind; Plan mode passes `plan`, default `agent`. Separates reuse/creation by kind. */
  conversationKind?: CoursewareConversationKind;
};

export async function findLatestConversationForCourseware(
  repo: Repository<CoursewareConversation>,
  coursewareId: string,
  kind?: CoursewareConversationKind,
): Promise<CoursewareConversation | null> {
  return await repo.findOne({
    where: { coursewareId, ...(kind ? { kind } : {}) },
    order: { updatedAt: "DESC" },
  });
}

function applyConversationActor(
  row: CoursewareConversation,
  actor: CoursewareActorContext | undefined,
  orgId: string | null,
  isCreate: boolean,
): void {
  if (orgId?.trim() && !row.orgId) {
    row.orgId = orgId.trim();
  }
  if (!actor) {
    return;
  }
  if (isCreate && !row.createdBy) {
    row.createdBy = actor.userId;
  }
  row.updatedBy = actor.userId;
}

async function reuseOrCreateConversation(
  repo: Repository<CoursewareConversation>,
  coursewareId: string | null,
  livePreviewSession: string | null,
  forceNew: boolean,
  actor?: CoursewareActorContext,
  coursewareOrgId?: string | null,
  kind: CoursewareConversationKind = "agent",
): Promise<CoursewareConversation> {
  if (!forceNew && coursewareId) {
    const existing = await findLatestConversationForCourseware(repo, coursewareId, kind);
    if (existing) {
      let changed = false;
      if (livePreviewSession && existing.livePreviewSessionId !== livePreviewSession) {
        existing.livePreviewSessionId = livePreviewSession;
        changed = true;
      }
      applyConversationActor(existing, actor, coursewareOrgId ?? null, false);
      if (changed || actor) {
        await repo.save(existing);
      }
      return existing;
    }
  }

  const row = repo.create({
    coursewareId,
    livePreviewSessionId: livePreviewSession,
    kind,
  });
  applyConversationActor(row, actor, coursewareOrgId ?? null, true);
  return await repo.save(row);
}

/**
 * Resolve or create a courseware conversation row: conversationId first, then a reverse lookup by claude session;
 * with coursewareKey / coursewareId it reuses that courseware's "most recently updated" courseware_conversation by default (so progress restores after a refresh);
 * newConversation: true forces a new thread.
 */
export async function resolveConversationForChat(
  body: ChatConversationBody,
  actor?: CoursewareActorContext,
): Promise<CoursewareConversation | null> {
  const repo = dataSource.getRepository(CoursewareConversation);
  const cid = body.conversationId?.trim();
  const sid = body.sessionId?.trim();
  const ck = body.coursewareKey?.trim();
  const cwId = body.coursewareId?.trim();
  const livePreviewSession = body.livePreviewSessionId?.trim() || null;
  const forceNew = body.newConversation === true;
  const kind = normalizeCoursewareConversationKind(body.conversationKind);

  if (cid) {
    const found = await repo.findOne({ where: { id: cid } });
    if (!found) {
      throw new Error(`Unknown conversationId: ${cid}`);
    }
    let changed = false;
    let boundOrgId: string | null = found.orgId;
    if (livePreviewSession && found.livePreviewSessionId !== livePreviewSession) {
      found.livePreviewSessionId = livePreviewSession;
      changed = true;
    }
    if (cwId) {
      const cw = await getCoursewareEntityById(cwId);
      if (!cw) {
        throw new Error(`Unknown coursewareId: ${cwId}`);
      }
      boundOrgId = cw.orgId;
      if (found.coursewareId !== cw.id) {
        found.coursewareId = cw.id;
        changed = true;
      }
    }
    applyConversationActor(found, actor, boundOrgId, false);
    if (changed || actor) {
      await repo.save(found);
    }
    return found;
  }

  if (sid) {
    const byClaude = await repo.findOne({ where: { claudeSessionId: sid } });
    if (byClaude) {
      let changed = false;
      let boundOrgId: string | null = byClaude.orgId;
      if (livePreviewSession && byClaude.livePreviewSessionId !== livePreviewSession) {
        byClaude.livePreviewSessionId = livePreviewSession;
        changed = true;
      }
      if (cwId) {
        const cw = await getCoursewareEntityById(cwId);
        if (!cw) {
          throw new Error(`Unknown coursewareId: ${cwId}`);
        }
        boundOrgId = cw.orgId;
        if (byClaude.coursewareId !== cw.id) {
          byClaude.coursewareId = cw.id;
          changed = true;
        }
      }
      applyConversationActor(byClaude, actor, boundOrgId, false);
      if (changed || actor) {
        await repo.save(byClaude);
      }
      return byClaude;
    }
    if (!ck && !cwId) {
      return null;
    }
  }

  if (ck) {
    const cw = await dataSource.getRepository(Courseware).findOne({ where: { key: ck } });
    let coursewareId: string | null = cw?.id ?? null;
    let orgId: string | null = cw?.orgId ?? null;
    if (cwId) {
      const byIdOrKey = await getCoursewareEntityById(cwId);
      if (!byIdOrKey) {
        throw new Error(`Unknown coursewareId: ${cwId}`);
      }
      coursewareId = byIdOrKey.id;
      orgId = byIdOrKey.orgId;
    }
    return await reuseOrCreateConversation(
      repo,
      coursewareId,
      livePreviewSession,
      forceNew,
      actor,
      orgId,
      kind,
    );
  }

  if (cwId) {
    const cw = await getCoursewareEntityById(cwId);
    if (!cw) {
      throw new Error(`Unknown coursewareId: ${cwId}`);
    }
    return await reuseOrCreateConversation(
      repo,
      cw.id,
      livePreviewSession,
      forceNew,
      actor,
      cw.orgId,
      kind,
    );
  }

  return null;
}

export type ConversationSyncFields = {
  claudeSessionId: string;
  sessionProjectKey?: string;
};

export type ConversationTokenUsageDelta = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** cache creation + cache read */
  cacheTokens: number;
};

function nonNegInt(n: number): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function normalizeConversationTokenUsageDelta(
  usage: Partial<ConversationTokenUsageDelta> | null | undefined,
): ConversationTokenUsageDelta | null {
  if (!usage) {
    return null;
  }
  const inputTokens = nonNegInt(usage.inputTokens ?? 0);
  const outputTokens = nonNegInt(usage.outputTokens ?? 0);
  const cacheTokens = nonNegInt(usage.cacheTokens ?? 0);
  const totalTokens =
    nonNegInt(usage.totalTokens ?? 0) || inputTokens + outputTokens + cacheTokens;
  if (inputTokens === 0 && outputTokens === 0 && cacheTokens === 0 && totalTokens === 0) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens, cacheTokens };
}

export async function syncConversationAfterAgentTurn(
  manager: EntityManager,
  conversationId: string,
  fields: ConversationSyncFields,
): Promise<void> {
  await manager.update(
    CoursewareConversation,
    { id: conversationId },
    {
      claudeSessionId: fields.claudeSessionId,
      ...(fields.sessionProjectKey ? { sessionProjectKey: fields.sessionProjectKey } : {}),
      updatedAt: new Date(),
    },
  );
}

/**
 * Accumulate this turn's SDK usage onto the conversation row (cumulative across turns). Called even when credits are off.
 */
export async function accumulateConversationTokenUsage(
  manager: EntityManager,
  conversationId: string,
  usage: ConversationTokenUsageDelta,
): Promise<void> {
  const delta = normalizeConversationTokenUsageDelta(usage);
  if (!delta) {
    return;
  }
  await manager.query(
    `UPDATE "courseware_conversation"
        SET "input_tokens" = COALESCE("input_tokens", 0) + $2,
            "output_tokens" = COALESCE("output_tokens", 0) + $3,
            "total_tokens" = COALESCE("total_tokens", 0) + $4,
            "cache_tokens" = COALESCE("cache_tokens", 0) + $5,
            "updated_at" = NOW()
      WHERE "id" = $1`,
    [conversationId, delta.inputTokens, delta.outputTokens, delta.totalTokens, delta.cacheTokens],
  );
}

const DEFAULT_CONVERSATION_SYNC_INTERVAL_MS = 5_000;

/**
 * During a streaming chat, write `claudeSessionId` / `sessionProjectKey` back to `courseware_conversation` with throttling,
 * so GET `/courseware/conversations` can read the already-mirrored transcript before the turn ends.
 * The first `notify` persists immediately; after that it refreshes at most every {@link DEFAULT_CONVERSATION_SYNC_INTERVAL_MS} seconds.
 */
export function createThrottledConversationSync(
  conversationId: string,
  options?: { intervalMs?: number },
): {
  notify: (fields: ConversationSyncFields) => void;
  flush: () => Promise<void>;
  dispose: () => void;
} {
  const intervalMs = options?.intervalMs ?? DEFAULT_CONVERSATION_SYNC_INTERVAL_MS;
  let pending: ConversationSyncFields | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastFlushAt = 0;
  let lastWrittenKey = '';
  let inFlight: Promise<void> | undefined;

  const mergePending = (fields: ConversationSyncFields): void => {
    const sid = fields.claudeSessionId.trim() || pending?.claudeSessionId.trim() || "";
    if (!sid) {
      return;
    }
    pending = {
      claudeSessionId: sid,
      ...(fields.sessionProjectKey?.trim()
        ? { sessionProjectKey: fields.sessionProjectKey.trim() }
        : pending?.sessionProjectKey
          ? { sessionProjectKey: pending.sessionProjectKey }
          : {}),
    };
  };

  const runFlush = async (): Promise<void> => {
    const snapshot = pending;
    if (!snapshot?.claudeSessionId.trim()) {
      return;
    }
    if (!dataSource.isInitialized) {
      return;
    }
    const writeKey = `${snapshot.claudeSessionId.trim()}|${snapshot.sessionProjectKey?.trim() ?? ''}`;
    if (writeKey === lastWrittenKey) {
      pending = null;
      lastFlushAt = Date.now();
      return;
    }
    lastWrittenKey = writeKey;
    pending = null;
    await syncConversationAfterAgentTurn(dataSource.manager, conversationId, {
      claudeSessionId: snapshot.claudeSessionId.trim(),
      sessionProjectKey: snapshot.sessionProjectKey?.trim() || undefined,
    });
    lastFlushAt = Date.now();
  };

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (inFlight) {
      await inFlight;
    }
    if (!pending) {
      return;
    }
    inFlight = runFlush().finally(() => {
      inFlight = undefined;
    });
    await inFlight;
  };

  const schedule = (): void => {
    if (timer !== undefined) {
      return;
    }
    const elapsed = Date.now() - lastFlushAt;
    const delay = lastFlushAt === 0 ? 0 : Math.max(0, intervalMs - elapsed);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
  };

  const notify = (fields: ConversationSyncFields): void => {
    mergePending(fields);
    if (!pending?.claudeSessionId.trim()) {
      return;
    }
    if (lastFlushAt === 0) {
      void flush();
      return;
    }
    schedule();
  };

  const dispose = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return { notify, flush, dispose };
}

export type ClearAgentHistoryResult = {
  coursewareId: string;
  deletedConversations: number;
  deletedTranscriptLines: number;
  removedWorkspaceDirs: number;
};

/**
 * Delete every agent conversation of a courseware: `courseware_conversation`, the matching SessionStore transcript lines, and the `agent-workspaces/<conversationId>` directory.
 * @param idOrKey courseware table uuid or business key (same as {@link getCoursewareEntityById})
 */
export async function clearAllAgentHistoryForCourseware(
  idOrKey: string,
  actor?: CoursewareActorContext,
): Promise<ClearAgentHistoryResult> {
  const cw = await getCoursewareEntityById(idOrKey);
  if (!cw) {
    throw new Error(`Unknown courseware: ${idOrKey.trim()}`);
  }

  const convRepo = dataSource.getRepository(CoursewareConversation);
  const conversations = await convRepo.find({ where: { coursewareId: cw.id } });
  const convIds = conversations.map((c) => c.id);
  const sessionIds = [
    ...new Set(
      conversations.map((c) => c.claudeSessionId?.trim()).filter((s): s is string => Boolean(s)),
    ),
  ];

  let deletedTranscriptLines = 0;
  await dataSource.transaction(async (em) => {
    if (sessionIds.length > 0) {
      const tr = await em
        .createQueryBuilder()
        .delete()
        .from(CoursewareSessionTranscriptLine)
        .where("session_id IN (:...sids)", { sids: sessionIds })
        .execute();
      deletedTranscriptLines = tr.affected ?? 0;
      await em
        .createQueryBuilder()
        .delete()
        .from(CoursewareToolResultBlob)
        .where("session_id IN (:...sids)", { sids: sessionIds })
        .execute();
    }
    if (convIds.length > 0) {
      await em
        .createQueryBuilder()
        .delete()
        .from(CoursewareToolResultBlob)
        .where("conversation_id IN (:...cids)", { cids: convIds })
        .execute();
      await em.delete(CoursewareConversation, { id: In(convIds) });
    }
  });

  const cliRoot = coursewareCliRoot;
  let removedWorkspaceDirs = 0;
  for (const id of convIds) {
    const dir = resolve(cliRoot, "agent-workspaces", id);
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        removedWorkspaceDirs += 1;
      } catch {
        /* ignore disk errors */
      }
    }
  }

  if (actor) {
    await recordCoursewareAuditLog({
      action: "conversation.clear",
      actor,
      orgId: cw.orgId ?? actor.orgId,
      coursewareId: cw.id,
      detail: {
        deletedConversations: conversations.length,
        deletedTranscriptLines,
      },
    });
  }

  return {
    coursewareId: cw.id,
    deletedConversations: conversations.length,
    deletedTranscriptLines,
    removedWorkspaceDirs,
  };
}

/**
 * Delete a single agent conversation: `courseware_conversation`, its transcript lines and workspace directory.
 */
export async function clearAgentHistoryForConversation(
  idOrKey: string,
  conversationId: string,
  actor?: CoursewareActorContext,
): Promise<ClearAgentHistoryResult> {
  const cw = await getCoursewareEntityById(idOrKey);
  if (!cw) {
    throw new Error(`Unknown courseware: ${idOrKey.trim()}`);
  }

  const convId = conversationId.trim();
  if (!convId) {
    throw new Error("Missing conversationId");
  }

  const convRepo = dataSource.getRepository(CoursewareConversation);
  const conversation = await convRepo.findOne({ where: { id: convId, coursewareId: cw.id } });
  if (!conversation) {
    throw new Error(`Unknown conversationId: ${convId}`);
  }

  const sessionId = conversation.claudeSessionId?.trim();
  let deletedTranscriptLines = 0;
  await dataSource.transaction(async (em) => {
    if (sessionId) {
      const tr = await em
        .createQueryBuilder()
        .delete()
        .from(CoursewareSessionTranscriptLine)
        .where("session_id = :sid", { sid: sessionId })
        .execute();
      deletedTranscriptLines = tr.affected ?? 0;
      await em
        .createQueryBuilder()
        .delete()
        .from(CoursewareToolResultBlob)
        .where("session_id = :sid", { sid: sessionId })
        .execute();
    }
    await em
      .createQueryBuilder()
      .delete()
      .from(CoursewareToolResultBlob)
      .where("conversation_id = :cid", { cid: convId })
      .execute();
    await em.delete(CoursewareConversation, { id: convId });
  });

  const cliRoot = coursewareCliRoot;
  let removedWorkspaceDirs = 0;
  const dir = resolve(cliRoot, "agent-workspaces", convId);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
      removedWorkspaceDirs = 1;
    } catch {
      /* ignore disk errors */
    }
  }

  if (actor) {
    await recordCoursewareAuditLog({
      action: "conversation.clear",
      actor,
      orgId: cw.orgId ?? actor.orgId,
      coursewareId: cw.id,
      detail: {
        conversationId: convId,
        deletedConversations: 1,
        deletedTranscriptLines,
      },
    });
  }

  return {
    coursewareId: cw.id,
    deletedConversations: 1,
    deletedTranscriptLines,
    removedWorkspaceDirs,
  };
}
