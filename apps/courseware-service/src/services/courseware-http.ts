// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { getAuthorizedSession, requireRequestSession, requireSessionWithPermission } from "../api-auth.ts";
import { COURSE_SECTION_QUERY_PERMISSION, type AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { actorFromSession, type CoursewareActorContext } from "../auth/ainobi-org-access.ts";
import { corsHeaders, sendJsonWithCors } from "../http/cors.ts";
import { writeSseComment } from "../http/request.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { dataSource } from "../db/db.ts";
import { CoursewareConversation } from "../models/courseware-conversation.ts";
import {
  publishCoursewareStreamEvent,
  readCoursewareStream,
  livePreviewStreamKeyForSession,
  type CoursewareStreamEvent,
} from "../db/redis-stream.ts";
import { normalizeScenePatchForPersistence } from "@ainobi/courseware-cli/cli/scene-persistence-normalize.ts";
import {
  clearAgentHistoryForConversation,
  clearAllAgentHistoryForCourseware,
} from "./conversation-service.ts";
import {
  getConversationChatHistoryForCourseware,
  listConversationsForCourseware,
} from "./conversation-chat-history.ts";
import {
  canListSectionBindingsViaEnrolledSection,
  CoursewareOrgAccessError,
  loadCoursewareAndAssertOrgAccess,
  loadCoursewareWithRequestAccess,
  requireAuthorizedSession,
  resolveCoursewareCanManage,
  resolveCoursewareRequestAccess,
} from "./courseware-org-guard.ts";
import {
  assertOrgIdAccess,
  assertOrgIdManageAccess,
} from "../auth/ainobi-org-access.ts";
import { verifyCoursewareRenderToken } from "./courseware-render-token.ts";
import { listCoursewareAuditLogs, recordCoursewareAuditLog } from "./courseware-audit-log-service.ts";
import { unbindCoursewareFromCourse } from "./courseware-course-binding-service.ts";
import {
  ensureCoursewareSectionBinding,
  listCoursewareForSection,
  listSectionBindingsForCourseware,
  setCurrentCoursewareForSection,
  unbindCoursewareFromSection,
} from "./courseware-section-binding-service.ts";
import {
  cloneCoursewareToCourse,
  cloneCoursewareToSection,
} from "./courseware-clone-service.ts";
import {
  assertCloneTargetCourseAccess,
  assertCloneTargetSectionAccess,
} from "./courseware-clone-target-access.ts";
import {
  deleteCourseware,
  getCoursewareByKey,
  getCoursewareEntityById,
  listCoursewareForOrg,
  listCoursewareVersions,
  pickCoursewareListOrgId,
  CoursewareKeyConflictError,
  CoursewareNotFoundError,
  CoursewareVersionConflictError,
  rollbackCourseware,
  saveCourseware,
  updateCoursewareSharing,
} from "./courseware-service.ts";

const saveBodySchema = z
  .object({
    title: z.string().max(512).nullable().optional(),
    coverUrl: z.string().max(2048).nullable().optional(),
    content: z.record(z.string(), z.unknown()),
    /** The server `updated_at` the client last synced to (ISO 8601) */
    baseUpdatedAt: z.string().min(1).optional(),
    /** When given, binds the courseware to the platform course (idempotent) */
    courseId: z.uuid().optional(),
    /** Organization of a new courseware (required; the login current_org_id must not be used) */
    orgId: z.uuid().optional(),
  })
  .strict();

const sharingBodySchema = z
  .object({
    isPublic: z.boolean(),
    isShare: z.boolean(),
  })
  .strict();

const rollbackBodySchema = z.object({
  versionId: z.uuid().optional(),
  revision: z.number().int().positive().optional(),
});

const paginationQuerySchema = {
  pageNumber: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
};

/**
 * orgId is required, courseId optional and combinable: courseId is just an extra filter within that organization.
 * orgId is required explicitly so a missing parameter doesn't end in a 500 and cross-organization management doesn't fall back to current_org by mistake.
 */
const listCoursewareQuerySchema = z.object({
  ...paginationQuerySchema,
  title: z.string().max(512).optional(),
  courseId: z.uuid().optional(),
  orgId: z.uuid(),
  order_by: z.enum(["created_at", "updated_at", "title"]).optional().default("created_at"),
  binding_status: z.enum(["all", "bound", "unbound"]).optional().default("all"),
});

const auditLogsQuerySchema = z.object({
  coursewareId: z.uuid(),
  ...paginationQuerySchema,
  action: z
    .enum([
      "courseware.create",
      "courseware.save",
      "courseware.sharing",
      "courseware.rollback",
      "courseware.delete",
      "courseware.unbind",
      "asset.upload",
      "asset.delete",
      "asset.presign",
      "cover.upload",
      "chat.turn",
      "conversation.clear",
    ])
    .optional(),
});

const unbindCoursewareQuerySchema = z.object({
  coursewareId: z.uuid(),
  courseId: z.uuid(),
});

const listSectionBindingQuerySchema = z.object({
  sectionId: z.uuid(),
  orgId: z.uuid(),
  courseId: z.uuid().optional(),
  ...paginationQuerySchema,
});

// coursewareId accepts the primary key id or the business key (resolved uniformly in the service layer)
const listBindingsByCoursewareQuerySchema = z.object({
  coursewareId: z.string().trim().min(1),
  orgId: z.uuid(),
});

const bindSectionBodySchema = z
  .object({
    coursewareId: z.uuid(),
    sectionId: z.uuid(),
    courseId: z.uuid(),
    orgId: z.uuid(),
    chapterId: z.uuid().nullable().optional(),
    isCurrent: z.boolean().optional(),
  })
  .strict();

const unbindSectionQuerySchema = z.object({
  coursewareId: z.uuid(),
  sectionId: z.uuid(),
  orgId: z.uuid(),
});

const setCurrentSectionBodySchema = z
  .object({
    coursewareId: z.uuid(),
    sectionId: z.uuid(),
    orgId: z.uuid(),
  })
  .strict();

const cloneToSectionBodySchema = z
  .object({
    sourceCoursewareId: z.uuid(),
    sourceSectionId: z.uuid(),
    sourceCourseId: z.uuid(),
    targetSectionId: z.uuid(),
    targetCourseId: z.uuid(),
    targetOrgId: z.uuid(),
    targetChapterId: z.uuid(),
    isCurrent: z.boolean(),
  })
  .strict();

const cloneToCourseBodySchema = z
  .object({
    sourceCoursewareId: z.uuid(),
    sourceCourseId: z.uuid(),
    targetCourseId: z.uuid(),
    targetOrgId: z.uuid(),
  })
  .strict();

const streamPublishBodySchema = z.object({
  event_type: z.literal("scene.patch"),
  live_preview_session_id: z.string().min(1),
  cli_session_id: z.string().min(1),
  scene_id: z.string().min(1),
  created_at: z.string().min(1),
  patch: z.array(z.record(z.string(), z.unknown())),
});

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  sendJsonWithCors(res, status, payload);
}

function writeSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function coursewareKeyFromUrl(url: URL): string | null {
  const key = url.searchParams.get("key")?.trim();
  return key || null;
}

function orgAccessErrorStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

function actorFromRequestSession(
  session: NonNullable<ReturnType<typeof getAuthorizedSession>>,
  orgIdOverride?: string,
): CoursewareActorContext {
  const actor = actorFromSession(session);
  const orgId = orgIdOverride?.trim();
  if (orgId) {
    return { ...actor, orgId };
  }
  return actor;
}

/** Comment pings while XREAD blocks so proxies do not idle-timeout the SSE connection. */
const LIVE_PREVIEW_SSE_HEARTBEAT_MS = 25_000;

/**
 * Courseware editing live stream: GET `/courseware/stream?...` (SSE).
 */
export async function handleCoursewareStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const livePreviewSessionId = url.searchParams.get("livePreviewSessionId")?.trim();
  const streamKey = url.searchParams.get("streamKey")?.trim();
  const from = url.searchParams.get("from")?.trim() || "0";

  if (!livePreviewSessionId && !streamKey) {
    return sendJson(res, 400, {
      ok: false,
      error: "Missing livePreviewSessionId or streamKey query parameter.",
    });
  }

  const resolvedStreamKey = streamKey || livePreviewStreamKeyForSession(livePreviewSessionId!);
  const abortController = new AbortController();

  req.on("close", () => {
    abortController.abort();
  });

  try {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...corsHeaders(),
    });

    writeSse(res, "ready", {
      ok: true,
      livePreviewSessionId: livePreviewSessionId ?? null,
      livePreviewStreamKey: resolvedStreamKey,
      from,
    });

    const heartbeat = setInterval(() => {
      if (abortController.signal.aborted || res.writableEnded) {
        return;
      }
      try {
        writeSseComment(res);
      } catch {
        abortController.abort();
      }
    }, LIVE_PREVIEW_SSE_HEARTBEAT_MS);

    try {
      for await (const entry of readCoursewareStream(resolvedStreamKey, from, abortController.signal)) {
        writeSse(res, "event", entry);
      }
    } finally {
      clearInterval(heartbeat);
    }
  } catch (error) {
    if (!res.headersSent) {
      return sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    writeSse(res, "error", {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * The agent CLI sends live preview patches through the host (the subprocess sandbox can't reach Redis directly).
 */
export async function handleCoursewareStreamPublish(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  if (pathname !== "/courseware/stream/publish" || req.method !== "POST") {
    return false;
  }

  const parsed = streamPublishBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: parsed.error.message });
    return true;
  }

  try {
    const event = parsed.data as CoursewareStreamEvent;
    const normalized =
      event.event_type === "scene.patch"
        ? {
            ...event,
            patch: normalizeScenePatchForPersistence(
              event.patch as Array<Record<string, unknown>>,
            ),
          }
        : event;
    const published = await publishCoursewareStreamEvent(normalized);
    sendJson(res, 200, { ok: true, ...published });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

/**
 * Courseware persistence HTTP: GET/PUT `/courseware`, GET `/courseware/list`, GET `/courseware/audit-logs`,
 * GET `/courseware/versions`, POST `/courseware/rollback`, GET/DELETE `/courseware/conversations`,
 * GET `/courseware/conversations/list`.
 * @returns whether the request was handled (the handler should finish)
 */
export async function handleCoursewarePersistence(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (await handleCoursewareStreamPublish(req, res)) {
    return true;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  if (
    pathname !== "/courseware" &&
    pathname !== "/courseware/list" &&
    pathname !== "/courseware/sharing" &&
    pathname !== "/courseware/binding" &&
    pathname !== "/courseware/section-binding/list" &&
    pathname !== "/courseware/section-binding/list-by-courseware" &&
    pathname !== "/courseware/section-binding" &&
    pathname !== "/courseware/section-binding/current" &&
    pathname !== "/courseware/clone-to-section" &&
    pathname !== "/courseware/clone-to-course" &&
    pathname !== "/courseware/audit-logs" &&
    pathname !== "/courseware/versions" &&
    pathname !== "/courseware/rollback" &&
    pathname !== "/courseware/conversations" &&
    pathname !== "/courseware/conversations/list" &&
    pathname !== "/courseware/conversations/history"
  ) {
    return false;
  }

  try {
    await ensureDataSource();
  } catch (error) {
    sendJson(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  if (pathname === "/courseware/section-binding/list" && req.method === "GET") {
    const parsed = listSectionBindingQuerySchema.safeParse({
      sectionId: url.searchParams.get("sectionId") ?? undefined,
      orgId: url.searchParams.get("orgId") ?? undefined,
      courseId: url.searchParams.get("courseId") ?? undefined,
      pageNumber: url.searchParams.get("pageNumber") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      order: url.searchParams.get("order") ?? undefined,
    });
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      const session = await requireSessionWithPermission(req, COURSE_SECTION_QUERY_PERMISSION);
      // Org isolation: the target org being in /organization/list is enough (current_org_id ignored);
      // otherwise another organization's coursewares could be enumerated
      try {
        await assertOrgIdAccess(session, parsed.data.orgId);
      } catch (error) {
        // Enrollment fallback (issue #825): external students of a public course aren't organization members, so the org check always 403s;
        // allowed when the backend decides the section is readable for them and its org/course match the request
        if (!(error instanceof CoursewareOrgAccessError)) {
          throw error;
        }
        const enrolled = await canListSectionBindingsViaEnrolledSection(session, parsed.data);
        if (!enrolled) {
          throw error;
        }
      }
      const { sectionId, orgId, courseId, pageNumber, pageSize, order } = parsed.data;
      const result = await listCoursewareForSection({
        sectionId,
        orgId,
        courseId,
        pageNumber,
        pageSize,
        order,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ?? (message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (
    pathname === "/courseware/section-binding/list-by-courseware" &&
    req.method === "GET"
  ) {
    const parsed = listBindingsByCoursewareQuerySchema.safeParse({
      coursewareId: url.searchParams.get("coursewareId") ?? undefined,
      orgId: url.searchParams.get("orgId") ?? undefined,
    });
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      const session = await requireSessionWithPermission(
        req,
        COURSE_SECTION_QUERY_PERMISSION,
      );
      // Org isolation: the target org being in /organization/list is enough (current_org_id ignored)
      await assertOrgIdAccess(session, parsed.data.orgId);
      const result = await listSectionBindingsForCourseware(parsed.data);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ?? (message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/section-binding" && req.method === "POST") {
    const parsed = bindSectionBodySchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      // Binding writes don't accept the anonymous (is_public) path: they require authentication, management rights over the target org, and access to the courseware
      const session = requireAuthorizedSession(req);
      await assertOrgIdManageAccess(session, parsed.data.orgId);
      await loadCoursewareAndAssertOrgAccess(session, parsed.data.coursewareId);
      const binding = await ensureCoursewareSectionBinding({
        ...parsed.data,
        createdBy: session.userId,
      });
      sendJson(res, 200, {
        ok: true,
        binding: {
          bindingId: binding.id,
          coursewareId: binding.coursewareId,
          sectionId: binding.sectionId,
          courseId: binding.courseId,
          orgId: binding.orgId,
          chapterId: binding.chapterId,
          isCurrent: Boolean(binding.isCurrent),
          createdAt: binding.createdAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/section-binding/current" && req.method === "PATCH") {
    const parsed = setCurrentSectionBodySchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      // Same as binding writes: no anonymous path, and management rights over the target org are required
      const session = requireAuthorizedSession(req);
      await assertOrgIdManageAccess(session, parsed.data.orgId);
      await loadCoursewareAndAssertOrgAccess(session, parsed.data.coursewareId);
      const binding = await setCurrentCoursewareForSection(parsed.data);
      sendJson(res, 200, {
        ok: true,
        binding: {
          bindingId: binding.id,
          coursewareId: binding.coursewareId,
          sectionId: binding.sectionId,
          courseId: binding.courseId,
          orgId: binding.orgId,
          chapterId: binding.chapterId,
          isCurrent: Boolean(binding.isCurrent),
          createdAt: binding.createdAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message === "section binding not found"
          ? 404
          : message.includes("not found")
            ? 404
            : message === "Unauthorized"
              ? 401
              : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/section-binding" && req.method === "DELETE") {
    const parsed = unbindSectionQuerySchema.safeParse({
      coursewareId: url.searchParams.get("coursewareId") ?? undefined,
      sectionId: url.searchParams.get("sectionId") ?? undefined,
      orgId: url.searchParams.get("orgId") ?? undefined,
    });
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      // Unbinding doesn't accept the anonymous path; the target org isn't checked — the courseware org's admins must be able to clean up abnormal cross-org binding rows
      const session = requireAuthorizedSession(req);
      const cw = await loadCoursewareAndAssertOrgAccess(session, parsed.data.coursewareId);
      const removed = await unbindCoursewareFromSection(
        cw.id,
        parsed.data.sectionId,
        parsed.data.orgId,
      );
      if (!removed) {
        sendJson(res, 404, { ok: false, error: "section binding not found" });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        coursewareId: cw.id,
        coursewareKey: cw.key,
        sectionId: parsed.data.sectionId,
        orgId: parsed.data.orgId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/clone-to-section" && req.method === "POST") {
    const parsed = cloneToSectionBodySchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      const session = requireAuthorizedSession(req);
      await assertCloneTargetSectionAccess({
        session,
        targetOrgId: parsed.data.targetOrgId,
        targetCourseId: parsed.data.targetCourseId,
        targetChapterId: parsed.data.targetChapterId,
        targetSectionId: parsed.data.targetSectionId,
      });
      await loadCoursewareWithRequestAccess(
        req,
        parsed.data.sourceCoursewareId,
        "write",
      );
      const binding = await cloneCoursewareToSection({
        ...parsed.data,
        actor: actorFromSession(session),
        accessToken: session?.accessToken ?? null,
      });
      sendJson(res, 200, {
        ok: true,
        coursewareId: binding.coursewareId,
        binding,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/clone-to-course" && req.method === "POST") {
    const parsed = cloneToCourseBodySchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      const session = requireAuthorizedSession(req);
      await assertCloneTargetCourseAccess({
        session,
        targetOrgId: parsed.data.targetOrgId,
        targetCourseId: parsed.data.targetCourseId,
      });
      await loadCoursewareWithRequestAccess(
        req,
        parsed.data.sourceCoursewareId,
        "write",
      );
      const binding = await cloneCoursewareToCourse({
        ...parsed.data,
        actor: actorFromSession(session),
        accessToken: session?.accessToken ?? null,
      });
      sendJson(res, 200, {
        ok: true,
        coursewareId: binding.coursewareId,
        binding,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }


  if (pathname === "/courseware/list" && req.method === "GET") {
    const parsed = listCoursewareQuerySchema.safeParse({
      pageNumber: url.searchParams.get("pageNumber") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      title: url.searchParams.get("title") ?? undefined,
      courseId: url.searchParams.get("courseId") ?? undefined,
      orgId: url.searchParams.get("orgId") ?? undefined,
      order: url.searchParams.get("order") ?? undefined,
      order_by: url.searchParams.get("order_by") ?? undefined,
      binding_status: url.searchParams.get("binding_status") ?? undefined,
    });
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      // Readable by members: attach any valid login session, then check orgId against /organization/list
      const session = await requireRequestSession(req);
      const {
        courseId,
        orgId,
        title,
        pageNumber,
        pageSize,
        order,
        order_by: orderBy,
        binding_status: bindingStatus,
      } = parsed.data;
      // Organization isolation: orgId must be passed explicitly (then checked by assertOrgIdAccess = /organization/list member).
      // courseId is just an extra filter on top of org. Doesn't depend on current_org_id.
      const targetOrgId = pickCoursewareListOrgId(orgId);
      await assertOrgIdAccess(session, targetOrgId);
      const result = await listCoursewareForOrg({
        orgId: targetOrgId,
        ...(courseId ? { courseId } : {}),
        ...(title ? { title } : {}),
        pageNumber,
        pageSize,
        order,
        orderBy,
        bindingStatus,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ?? (message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/audit-logs" && req.method === "GET") {
    const parsed = auditLogsQuerySchema.safeParse({
      coursewareId: url.searchParams.get("coursewareId") ?? undefined,
      pageNumber: url.searchParams.get("pageNumber") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      order: url.searchParams.get("order") ?? undefined,
    });
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      const { courseware: cw } = await loadCoursewareWithRequestAccess(
        req,
        parsed.data.coursewareId,
        "write",
      );
      const { action, pageNumber, pageSize, order } = parsed.data;
      const result = await listCoursewareAuditLogs({
        coursewareId: cw.id,
        action,
        pageNumber,
        pageSize,
        order,
      });
      sendJson(res, 200, { ok: true, coursewareId: cw.id, coursewareKey: cw.key, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  // Fetch conversation history by conversationId (for the workshop's ?c= restore): conversation id → reverse lookup of the courseware →
  // the usual write permission gate → return the message list. The frontend's local snapshot dies across devices / cleared storage, while the server
  // transcript is the recoverable source of truth (red team R9).
  if (pathname === "/courseware/conversations/history" && req.method === "GET") {
    const conversationId = url.searchParams.get("id")?.trim();
    if (!conversationId) {
      sendJson(res, 400, { ok: false, error: 'Missing query parameter "id".' });
      return true;
    }
    try {
      await ensureDataSource();
      const convRepo = dataSource.getRepository(CoursewareConversation);
      const conversation = await convRepo.findOne({ where: { id: conversationId } });
      if (!conversation) {
        sendJson(res, 404, { ok: false, error: "Conversation not found." });
        return true;
      }
      // courseware_id is nullable; a null id fails the access lookup below, as before.
      const coursewareId = conversation.coursewareId as string;
      await loadCoursewareWithRequestAccess(req, coursewareId, "write");
      const result = await getConversationChatHistoryForCourseware(coursewareId, {
        conversationId,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let status = orgAccessErrorStatus(error) ?? 500;
      if (message.startsWith("Unknown courseware") || message.includes("Unknown conversationId")) status = 404;
      else if (message === "Unauthorized") status = 401;
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/conversations/list" && req.method === "GET") {
    const coursewareIdParam = url.searchParams.get("coursewareId")?.trim();
    const keyParam = coursewareKeyFromUrl(url);
    const target = coursewareIdParam || keyParam;
    if (!target) {
      sendJson(res, 400, {
        ok: false,
        error: 'Missing query parameter "coursewareId" or "key".',
      });
      return true;
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const kindParam = url.searchParams.get("kind")?.trim();
    const kind = kindParam === "plan" || kindParam === "agent" ? kindParam : undefined;
    try {
      await loadCoursewareWithRequestAccess(req, target, "write");
      const result = await listConversationsForCourseware(target, {
        ...(Number.isFinite(limit) ? { limit } : {}),
        ...(kind ? { kind } : {}),
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let status = orgAccessErrorStatus(error) ?? 500;
      if (message.startsWith("Unknown courseware")) status = 404;
      else if (message === "Unauthorized") status = 401;
      else if (message === "courseware not found") status = 404;
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/conversations") {
    const coursewareIdParam = url.searchParams.get("coursewareId")?.trim();
    const keyParam = coursewareKeyFromUrl(url);
    const target = coursewareIdParam || keyParam;

    if (req.method === "GET") {
      if (!target) {
        sendJson(res, 400, {
          ok: false,
          error: 'Missing query parameter "coursewareId" or "key".',
        });
        return true;
      }
      const conversationIdParam = url.searchParams.get("conversationId")?.trim() || undefined;
      try {
        await loadCoursewareWithRequestAccess(req, target, "write");
        const result = await getConversationChatHistoryForCourseware(target, {
          conversationId: conversationIdParam,
        });
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let status = orgAccessErrorStatus(error) ?? 500;
        if (message.startsWith("Unknown courseware")) status = 404;
        else if (message.startsWith("Unknown conversationId:")) status = 404;
        else if (message === "Unauthorized") status = 401;
        else if (message === "courseware not found") status = 404;
        sendJson(res, status, { ok: false, error: message });
      }
      return true;
    }

    if (req.method === "DELETE") {
      if (!target) {
        sendJson(res, 400, {
          ok: false,
          error: 'Missing query parameter "coursewareId" or "key".',
        });
        return true;
      }
      try {
        const { session } = await loadCoursewareWithRequestAccess(req, target, "write");
        const actor = session ? actorFromRequestSession(session) : undefined;
        const conversationIdParam = url.searchParams.get("conversationId")?.trim() || undefined;
        const result = conversationIdParam
          ? await clearAgentHistoryForConversation(target, conversationIdParam, actor)
          : await clearAllAgentHistoryForCourseware(target, actor);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let status = orgAccessErrorStatus(error) ?? 500;
        if (message.startsWith("Unknown courseware")) status = 404;
        else if (message === "Unauthorized") status = 401;
        else if (message === "courseware not found") status = 404;
        sendJson(res, status, { ok: false, error: message });
      }
      return true;
    }
  }

  const key = coursewareKeyFromUrl(url);

  if (pathname === "/courseware/versions" && req.method === "GET") {
    if (!key) {
      sendJson(res, 400, { ok: false, error: 'Missing query parameter "key".' });
      return true;
    }
    try {
      // Auth and read must point at the same row: ?key= may be another courseware's id
      const { courseware: cw } = await loadCoursewareWithRequestAccess(req, key, "write");
      const includeContent = url.searchParams.get("includeContent") === "1" || url.searchParams.get("includeContent") === "true";
      const list = await listCoursewareVersions(cw.key, includeContent);
      if (!list) {
        sendJson(res, 404, { ok: false, error: "courseware not found" });
        return true;
      }
      sendJson(res, 200, { ok: true, ...list });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/rollback" && req.method === "POST") {
    if (!key) {
      sendJson(res, 400, { ok: false, error: 'Missing query parameter "key".' });
      return true;
    }
    const parsed = rollbackBodySchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    if (!parsed.data.versionId && parsed.data.revision == null) {
      sendJson(res, 400, { ok: false, error: "Provide versionId or revision in JSON body." });
      return true;
    }
    try {
      // Auth and rollback must point at the same row: ?key= may be another courseware's id
      const { courseware: cw, session } = await loadCoursewareWithRequestAccess(req, key, "write");
      const dto = await rollbackCourseware({
        key: cw.key,
        versionId: parsed.data.versionId,
        revision: parsed.data.revision,
        actor: session ? actorFromRequestSession(session) : undefined,
      });
      sendJson(res, 200, { ok: true, courseware: dto });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 400);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware" && req.method === "GET") {
    if (!key) {
      sendJson(res, 400, { ok: false, error: 'Missing query parameter "key".' });
      return true;
    }
    // FC headless renderer page loads scene data with no logged-in session; a short-lived
    // HMAC render_token (minted by courseware-render-http.ts after the *requesting user's*
    // own access was already checked at task-creation time) grants narrow read-only access
    // to exactly this courseware id, bypassing normal org/is_public/is_share checks below.
    const renderToken = url.searchParams.get("render_token")?.trim();
    try {
      let canManage = false;
      // Auth and read must point at the same row: ?key= may be another courseware's id
      let resolvedKey = key;
      if (renderToken) {
        const cw = await getCoursewareEntityById(key);
        if (!cw) {
          sendJson(res, 404, { ok: false, error: "courseware not found" });
          return true;
        }
        if (!verifyCoursewareRenderToken(renderToken, cw.id)) {
          sendJson(res, 401, { ok: false, error: "invalid or expired render_token" });
          return true;
        }
        resolvedKey = cw.key;
      } else {
        const { courseware: cw } = await loadCoursewareWithRequestAccess(req, key, "read", {
          allowEnrolledSectionRead: true,
        });
        canManage = await resolveCoursewareCanManage(req, cw);
        resolvedKey = cw.key;
      }
      const dto = await getCoursewareByKey(resolvedKey);
      if (!dto) {
        sendJson(res, 404, { ok: false, error: "courseware not found" });
        return true;
      }
      sendJson(res, 200, { ok: true, courseware: { ...dto, canManage } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/binding" && req.method === "DELETE") {
    const parsed = unbindCoursewareQuerySchema.safeParse({
      coursewareId: url.searchParams.get("coursewareId") ?? undefined,
      courseId: url.searchParams.get("courseId") ?? undefined,
    });
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      // Unbinding doesn't accept the anonymous (is_public) path
      const session = requireAuthorizedSession(req);
      const cw = await loadCoursewareAndAssertOrgAccess(session, parsed.data.coursewareId);
      const orgId = cw.orgId?.trim();
      if (!orgId) {
        sendJson(res, 400, { ok: false, error: "courseware org_id is not set" });
        return true;
      }
      const removed = await unbindCoursewareFromCourse(
        cw.id,
        parsed.data.courseId,
        orgId,
      );
      if (!removed) {
        sendJson(res, 404, { ok: false, error: "binding not found" });
        return true;
      }
      await recordCoursewareAuditLog({
        action: "courseware.unbind",
        actor: actorFromRequestSession(session),
        orgId,
        coursewareId: cw.id,
        detail: { courseId: parsed.data.courseId },
      });
      sendJson(res, 200, {
        ok: true,
        coursewareId: cw.id,
        coursewareKey: cw.key,
        courseId: parsed.data.courseId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware" && req.method === "DELETE") {
    const keyParam = coursewareKeyFromUrl(url);
    const coursewareIdParam = url.searchParams.get("coursewareId")?.trim();
    const target = keyParam || coursewareIdParam;
    if (!target) {
      sendJson(res, 400, {
        ok: false,
        error: 'Missing query parameter "key" or "coursewareId".',
      });
      return true;
    }
    try {
      const { session } = await loadCoursewareWithRequestAccess(req, target, "write");
      const actor = session ? actorFromRequestSession(session) : undefined;
      const result = await deleteCourseware(target, actor, session?.accessToken ?? null);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware/sharing" && req.method === "PATCH") {
    if (!key) {
      sendJson(res, 400, { ok: false, error: 'Missing query parameter "key".' });
      return true;
    }
    const parsed = sharingBodySchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      const session = requireAuthorizedSession(req);
      const actor = actorFromRequestSession(session);
      // Auth and write must point at the same row: ?key= may be another courseware's id
      const cw = await loadCoursewareAndAssertOrgAccess(session, key);
      const sharing = await updateCoursewareSharing({
        key: cw.key,
        isPublic: parsed.data.isPublic,
        isShare: parsed.data.isShare,
        actor,
      });
      sendJson(res, 200, { ok: true, sharing });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (message.includes("not found")
          ? 404
          : message === "Unauthorized"
            ? 401
            : 500);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === "/courseware" && req.method === "PUT") {
    if (!key) {
      sendJson(res, 400, { ok: false, error: 'Missing query parameter "key".' });
      return true;
    }
    const parsed = saveBodySchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: parsed.error.message });
      return true;
    }
    try {
      // The only identity resolution in the whole flow: ?key= may be a business key or some row's id
      // (getCoursewareEntityById prefers id). The resolved entity is reused all the way to the write,
      // never looked up again — two independent lookups could make auth and write point at different rows.
      const existing = await getCoursewareEntityById(key);
      const { title, coverUrl, content, courseId } = parsed.data;
      let dto: Awaited<ReturnType<typeof saveCourseware>>;

      if (existing) {
        const access = await resolveCoursewareRequestAccess(req, existing, "write");
        // Content writes keep is_public's anonymous semantics, but courseId has a binding side effect,
        // so like the other binding endpoints it requires an authenticated session (the binding org is always the courseware's own org)
        if (courseId?.trim() && !access.session) {
          sendJson(res, 401, {
            ok: false,
            error: "binding a course requires an authenticated session",
          });
          return true;
        }
        const baseUpdatedAt = parsed.data.baseUpdatedAt?.trim();
        if (!baseUpdatedAt) {
          sendJson(res, 400, {
            ok: false,
            error: 'Missing "baseUpdatedAt" (client last-synced server updated_at).',
          });
          return true;
        }
        // The row is changed only by the resolved row primary key; body orgId is deliberately dropped in this branch
        // (the courseware org is fixed at creation and can't be rewritten; the update variant of SaveCoursewareInput has no such field either)
        dto = await saveCourseware({
          mode: "update",
          coursewareId: existing.id,
          coursewareKey: existing.key,
          baseUpdatedAt,
          title,
          coverUrl,
          content,
          courseId,
          accessToken: access.session?.accessToken ?? null,
          actor: access.session ? actorFromRequestSession(access.session) : undefined,
        });
      } else {
        const createOrgId = parsed.data.orgId?.trim();
        if (!createOrgId) {
          sendJson(res, 400, {
            ok: false,
            error: 'orgId is required when creating courseware (do not rely on login current_org_id).',
          });
          return true;
        }
        let session: AinobiAuthorizedSession;
        try {
          session = requireAuthorizedSession(req);
        } catch {
          // Member-only sessions where the management gate (authorizeRequest) isn't mounted (e.g. enterprise students):
          // give 403 semantics (no management rights over that org) instead of a generic 401.
          session = await requireRequestSession(req);
        }
        // The courseware org is set only at creation and immutable afterwards, so the caller's management rights over that org must be checked,
        // otherwise any logged-in user could create coursewares under any organization
        await assertOrgIdManageAccess(session, createOrgId);
        dto = await saveCourseware({
          mode: "create",
          key,
          orgId: createOrgId,
          title,
          coverUrl,
          content,
          courseId,
          actor: actorFromRequestSession(session, createOrgId),
        });
      }
      sendJson(res, 200, { ok: true, courseware: dto });
    } catch (error) {
      if (error instanceof CoursewareVersionConflictError) {
        sendJson(res, 409, {
          ok: false,
          conflict: "version",
          error: error.message,
          serverUpdatedAt: error.serverUpdatedAt,
          baseUpdatedAt: error.baseUpdatedAt,
        });
        return true;
      }
      // Concurrent row creation colliding on the key: an explicit 409, instead of returning the raw Postgres unique constraint error as a 400
      if (error instanceof CoursewareKeyConflictError) {
        sendJson(res, 409, {
          ok: false,
          conflict: "key",
          error: error.message,
          key: error.key,
        });
        return true;
      }
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessErrorStatus(error) ??
        (error instanceof CoursewareNotFoundError
          ? 404
          : message === "Unauthorized"
            ? 401
            : 400);
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  return false;
}
