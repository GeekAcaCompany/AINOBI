// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { sendJsonWithCors } from "../http/cors.ts";
import {
  coursewareRenderCallbackUrl,
  isValidVideoRenderCallbackToken,
  RENDER_TASK_AFFINITY_HEADER_NAME,
  resolveStudentViewBaseUrl,
  resolveVideoRenderInternalToken,
  videoRenderServiceUrl,
} from "../config/video-render-service.ts";
import { savePendingRenderTaskBilling } from "../models/render-task-billing.ts";
import { isVideoRenderCreditsConsumptionEnabled, resolveCreditsOrgId } from "./ainobi-credits.ts";
import { isOrgStorageIntegrationEnabled } from "./ainobi-org-storage.ts";
import {
  CoursewareOrgAccessError,
  loadCoursewareByIdAndAssertOrgAccess,
  loadCoursewareByIdWithRequestAccess,
  requireAuthorizedSession,
  resolveActor,
} from "./courseware-org-guard.ts";
import { mintCoursewareRenderToken } from "./courseware-render-token.ts";
import { settleCompletedRenderTask, type BillableRenderTask } from "./video-render-credits.ts";
import { releaseRenderTaskOrganizationStorage } from "./video-render-org-storage.ts";

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  sendJsonWithCors(res, status, payload);
}

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

function orgAccessErrorStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

function errorStatusAndMessage(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    orgAccessErrorStatus(error) ??
    (message.includes("not found") ? 404 : message === "Unauthorized" ? 401 : 500);
  return { status, message };
}

/**
 * Builds the headless-renderer URL handed to `ainobi-video-render-service`.
 * `coursewareKey` is the business key (`courseware.key`, same as student-view URL
 * `courseware_id` and `GET /courseware?key=`), **not** the internal DB primary key.
 */
export function buildRendererUrl(coursewareKey: string, renderToken: string): string {
  const url = new URL("/courseware-renderer", resolveStudentViewBaseUrl());
  url.searchParams.set("courseware_id", coursewareKey);
  url.searchParams.set("render_token", renderToken);
  return url.toString();
}

/** Strips `render_token` from a task's stored request URL before it's ever sent back to a browser. */
export function redactRenderTokenFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("render_token")) {
      url.searchParams.set("render_token", "[redacted]");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function sanitizeRenderTaskForClient(task: Record<string, unknown>): Record<string, unknown> {
  const request = task.request;
  if (!request || typeof request !== "object") {
    return task;
  }
  const req = { ...(request as Record<string, unknown>) };
  if (typeof req.url === "string") {
    req.url = redactRenderTokenFromUrl(req.url);
  }
  // Internal-only webhook URL — no reason for the browser to ever see it.
  delete req.callbackUrl;
  return { ...task, request: req };
}

/**
 * Merges primary (DB-id) and legacy (business-key) list results, de-duping by task id
 * and sorting newest-first by `createdAt`. Used while older rows may still store `key`
 * in `render_task.courseware_id`.
 */
export function mergeRenderTaskLists(
  primary: unknown[],
  legacy: unknown[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const t of [...primary, ...legacy]) {
    if (!t || typeof t !== "object") continue;
    const task = t as Record<string, unknown>;
    const id = task.id;
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    merged.push(task);
  }
  return merged.sort((a, b) => {
    const aAt = String(a.createdAt ?? "");
    const bAt = String(b.createdAt ?? "");
    return bAt.localeCompare(aAt);
  });
}

async function callVideoRenderService(
  path: string,
  target: "render" | "query",
  init: RequestInit & { affinityTaskId?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { affinityTaskId, headers: initHeaders, ...rest } = init;
  const response = await fetch(videoRenderServiceUrl(path, target), {
    ...rest,
    headers: {
      "content-type": "application/json",
      "x-ainobi-internal-token": resolveVideoRenderInternalToken(),
      ...(affinityTaskId ? { [RENDER_TASK_AFFINITY_HEADER_NAME]: affinityTaskId } : {}),
      ...initHeaders,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

async function fetchRenderTaskOrThrow(taskId: string): Promise<Record<string, unknown>> {
  const { status, body } = await callVideoRenderService(
    `/render/tasks/${encodeURIComponent(taskId)}`,
    "query",
  );
  if (status === 404) {
    throw new Error("render task not found");
  }
  if (status < 200 || status >= 300 || !body.task) {
    throw new Error(
      typeof body.error === "string" ? body.error : `render service error (HTTP ${status})`,
    );
  }
  return body.task as Record<string, unknown>;
}

const createRenderTaskBodySchema = z.object({
  /** Editor URL `courseware_id` (business key) or DB primary key — both accepted. */
  coursewareId: z.uuid(),
  width: z.coerce.number().int().positive().max(7680).optional(),
  height: z.coerce.number().int().positive().max(4320).optional(),
  durationMs: z.coerce.number().int().positive().optional(),
  fps: z.coerce.number().int().positive().max(120).optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

/** `POST /courseware/render/tasks` */
async function handleCreateRenderTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = createRenderTaskBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: parsed.error.message });
    return;
  }

  try {
    const { courseware, session } = await loadCoursewareByIdWithRequestAccess(
      req,
      parsed.data.coursewareId,
      "read",
    );
    const actor = resolveActor(req);
    const renderToken = mintCoursewareRenderToken(courseware.id);
    const url = buildRendererUrl(courseware.key, renderToken);
    // Client-generated task id (also sent as ainobi-render-task-id for render /run affinity).
    const taskId = randomUUID();

    const { status, body } = await callVideoRenderService("/render/tasks", "query", {
      method: "POST",
      affinityTaskId: taskId,
      body: JSON.stringify({
        url,
        width: parsed.data.width,
        height: parsed.data.height,
        duration: parsed.data.durationMs,
        fps: parsed.data.fps,
        title: parsed.data.title,
        uploadToOss: true,
        // Canonical DB primary key — must match list/retry filters (not business `key`).
        coursewareId: courseware.id,
        orgId: courseware.orgId ?? undefined,
        userId: actor?.userId,
        callbackUrl: coursewareRenderCallbackUrl(),
      }),
    });

    if (status < 200 || status >= 300 || !body.task) {
      sendJson(res, status >= 400 ? status : 502, {
        ok: false,
        error: typeof body.error === "string" ? body.error : "render service error",
      });
      return;
    }
    const task = body.task as Record<string, unknown>;

    // Settlement (credits + org storage) needs a live access token at create time — the
    // render finishes later via /run. Anonymous (session === null) requests skip settlement.
    const orgId = resolveCreditsOrgId(courseware.orgId);
    const needsSettlement =
      Boolean(session) &&
      (isVideoRenderCreditsConsumptionEnabled() || isOrgStorageIntegrationEnabled(orgId));
    if (needsSettlement && session && typeof task.id === "string") {
      await savePendingRenderTaskBilling(task.id, {
        accessToken: session.accessToken,
        orgId,
        // Prefer business key in billing content (matches student-view / editor URLs).
        coursewareId: courseware.key,
        userId: actor?.userId,
      });
    }

    sendJson(res, status, { ok: true, task: sanitizeRenderTaskForClient(task) });
  } catch (error) {
    const { status, message } = errorStatusAndMessage(error);
    sendJson(res, status, { ok: false, error: message });
  }
}

const listRenderTasksQuerySchema = z.object({
  /** Same as create: editor key or DB id; list always filters render-service by canonical DB id. */
  coursewareId: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "interrupted", "cancelled"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** `GET /courseware/render/tasks?coursewareId=...` */
async function handleListRenderTasks(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const parsed = listRenderTasksQuerySchema.safeParse({
    coursewareId: url.searchParams.get("coursewareId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: parsed.error.message });
    return;
  }

  try {
    const { courseware } = await loadCoursewareByIdWithRequestAccess(
      req,
      parsed.data.coursewareId,
      "read",
    );

    // Client may pass business `key` (editor URL) or DB `id`; render-service indexes by DB id.
    const query = new URLSearchParams({ coursewareId: courseware.id });
    if (parsed.data.status) query.set("status", parsed.data.status);
    if (parsed.data.cursor) query.set("cursor", parsed.data.cursor);
    if (parsed.data.limit) query.set("limit", String(parsed.data.limit));

    const { status, body } = await callVideoRenderService(`/render/tasks?${query.toString()}`, "query");
    if (status < 200 || status >= 300) {
      sendJson(res, status >= 400 ? status : 502, {
        ok: false,
        error: typeof body.error === "string" ? body.error : "render service error",
      });
      return;
    }
    let tasks: Record<string, unknown>[] = Array.isArray(body.tasks)
      ? (body.tasks as Record<string, unknown>[])
      : [];

    // Legacy rows (pre-canonicalization) may have stored business `key` in courseware_id.
    // Merge a second query when key ≠ id so the export panel still shows those tasks.
    if (courseware.key !== courseware.id) {
      const legacyQuery = new URLSearchParams(query);
      legacyQuery.set("coursewareId", courseware.key);
      const legacy = await callVideoRenderService(`/render/tasks?${legacyQuery.toString()}`, "query");
      if (legacy.status >= 200 && legacy.status < 300 && Array.isArray(legacy.body.tasks)) {
        tasks = mergeRenderTaskLists(tasks, legacy.body.tasks);
      }
    }

    // Fallback in case the video-render-service → callback webhook never arrived (best-effort,
    // not guaranteed delivery): the first poll to observe a `completed` task bills it here
    // instead. Idempotent (the pending-billing record is taken at most once), so this is safe to
    // run on every list call regardless of whether the webhook already fired. Fire-and-forget —
    // must not slow down the poll response the export panel is waiting on.
    for (const t of tasks) {
      const task = t as Record<string, unknown>;
      if (task.status === "completed" && typeof task.id === "string") {
        void settleCompletedRenderTask({
          id: task.id,
          status: "completed",
          orgId: typeof task.orgId === "string" ? task.orgId : undefined,
          result: task.result as BillableRenderTask["result"],
        });
      }
    }
    sendJson(res, 200, {
      ok: true,
      tasks: tasks.map((t) => sanitizeRenderTaskForClient(t as Record<string, unknown>)),
      // Cursor pagination is only meaningful for the primary (id) query; legacy merge is best-effort.
      nextCursor: body.nextCursor ?? null,
    });
  } catch (error) {
    const { status, message } = errorStatusAndMessage(error);
    sendJson(res, status, { ok: false, error: message });
  }
}

/** `POST /courseware/render/tasks/:id/retry` — re-verifies access, mints a fresh render_token (the original may have expired). */
async function handleRetryRenderTask(req: IncomingMessage, res: ServerResponse, taskId: string): Promise<void> {
  try {
    const task = await fetchRenderTaskOrThrow(taskId);
    const coursewareId = typeof task.coursewareId === "string" ? task.coursewareId : null;
    if (!coursewareId) {
      sendJson(res, 404, { ok: false, error: "render task not found" });
      return;
    }
    const { courseware, session } = await loadCoursewareByIdWithRequestAccess(req, coursewareId, "read");
    const actor = resolveActor(req);
    const freshUrl = buildRendererUrl(courseware.key, mintCoursewareRenderToken(courseware.id));

    const { status, body } = await callVideoRenderService(
      `/render/tasks/${encodeURIComponent(taskId)}/retry`,
      "query",
      { method: "POST", body: JSON.stringify({ url: freshUrl }) },
    );
    if (status < 200 || status >= 300 || !body.task) {
      sendJson(res, status >= 400 ? status : 502, {
        ok: false,
        error: typeof body.error === "string" ? body.error : "render service error",
      });
      return;
    }

    // Refresh settlement credentials: the create-time pending record may have expired, or
    // a previous settle attempt may have consumed it after a partial failure.
    const orgId = resolveCreditsOrgId(courseware.orgId);
    const needsSettlement =
      Boolean(session) &&
      (isVideoRenderCreditsConsumptionEnabled() || isOrgStorageIntegrationEnabled(orgId));
    if (needsSettlement && session) {
      await savePendingRenderTaskBilling(taskId, {
        accessToken: session.accessToken,
        orgId,
        coursewareId: courseware.key,
        userId: actor?.userId,
      });
    }

    sendJson(res, status, {
      ok: true,
      task: sanitizeRenderTaskForClient(body.task as Record<string, unknown>),
    });
  } catch (error) {
    const { status, message } = errorStatusAndMessage(error);
    sendJson(res, status, { ok: false, error: message });
  }
}

/** `POST /courseware/render/tasks/:id/cancel` */
async function handleCancelRenderTask(req: IncomingMessage, res: ServerResponse, taskId: string): Promise<void> {
  try {
    const task = await fetchRenderTaskOrThrow(taskId);
    const coursewareId = typeof task.coursewareId === "string" ? task.coursewareId : null;
    if (!coursewareId) {
      sendJson(res, 404, { ok: false, error: "render task not found" });
      return;
    }
    await loadCoursewareByIdWithRequestAccess(req, coursewareId, "read");

    const { status, body } = await callVideoRenderService(
      `/render/tasks/${encodeURIComponent(taskId)}/cancel`,
      "render",
      { method: "POST", affinityTaskId: taskId },
    );
    if (status < 200 || status >= 300 || !body.task) {
      sendJson(res, status >= 400 ? status : 502, {
        ok: false,
        error: typeof body.error === "string" ? body.error : "render service error",
      });
      return;
    }
    sendJson(res, status, {
      ok: true,
      task: sanitizeRenderTaskForClient(body.task as Record<string, unknown>),
    });
  } catch (error) {
    const { status, message } = errorStatusAndMessage(error);
    sendJson(res, status, { ok: false, error: message });
  }
}

/** `DELETE /courseware/render/tasks/:id` — removes record and OSS video/cover assets; releases org storage. */
async function handleDeleteRenderTask(req: IncomingMessage, res: ServerResponse, taskId: string): Promise<void> {
  try {
    const task = await fetchRenderTaskOrThrow(taskId);
    const coursewareId = typeof task.coursewareId === "string" ? task.coursewareId : null;
    if (!coursewareId) {
      sendJson(res, 404, { ok: false, error: "render task not found" });
      return;
    }
    // Deletion is destructive (task row + OSS output): only sessions with organization rights (members / managed organizations)
    // may delete. The student decisions (bound in this organization / enrolled section) and anonymous share reads never reach it (R8).
    const session = requireAuthorizedSession(req);
    const courseware = await loadCoursewareByIdAndAssertOrgAccess(session, coursewareId);

    const { status, body } = await callVideoRenderService(
      `/render/tasks/${encodeURIComponent(taskId)}`,
      "query",
      { method: "DELETE" },
    );
    if (status < 200 || status >= 300) {
      sendJson(res, status >= 400 ? status : 502, {
        ok: false,
        error: typeof body.error === "string" ? body.error : "render service error",
      });
      return;
    }

    // After OSS/DB removal succeeds, release org storage (best-effort). Marker was written
    // at commit time so we only decrement what was actually charged.
    if (session) {
      await releaseRenderTaskOrganizationStorage({
        task: {
          id: taskId,
          status: typeof task.status === "string" ? task.status : "",
          orgId: typeof task.orgId === "string" ? task.orgId : courseware.orgId,
          result: task.result as BillableRenderTask["result"],
        },
        accessToken: session.accessToken,
        orgId: resolveCreditsOrgId(
          typeof task.orgId === "string" ? task.orgId : courseware.orgId,
        ),
      });
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    const { status, message } = errorStatusAndMessage(error);
    sendJson(res, status, { ok: false, error: message });
  }
}

/**
 * `POST /courseware/render/callback` — ainobi-video-render-service's best-effort webhook, fired
 * when a task reaches `completed`/`failed`/`interrupted`. Not proxied through the normal
 * session-based access checks (there's no browser session here) — authenticated purely via the
 * shared `x-ainobi-internal-token` secret, same as the outbound direction. Always responds fast;
 * billing runs inline but never throws, and its own reliability is covered by
 * `consumeAinobiCredits`'s built-in retry queue plus the lazy fallback in `handleListRenderTasks`.
 * Also commits organization storage for the exported OSS objects when enabled.
 */
export async function handleCoursewareRenderCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const header = req.headers["x-ainobi-internal-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!isValidVideoRenderCallbackToken(provided)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid JSON body" });
    return;
  }

  const task = (body as { task?: unknown } | null)?.task;
  if (!task || typeof task !== "object" || typeof (task as { id?: unknown }).id !== "string") {
    sendJson(res, 400, { ok: false, error: "missing task" });
    return;
  }

  const t = task as Record<string, unknown>;
  await settleCompletedRenderTask({
    id: t.id as string,
    status: typeof t.status === "string" ? t.status : "",
    orgId: typeof t.orgId === "string" ? t.orgId : undefined,
    result: t.result as BillableRenderTask["result"],
  });

  sendJson(res, 200, { ok: true });
}

/**
 * Video export task pool proxy: `POST/GET /courseware/render/tasks`,
 * `POST /courseware/render/tasks/:id/retry`, `POST /courseware/render/tasks/:id/cancel`.
 * Forwarded to `apps/video-render-service`; every forward rechecks the requester's read permission on the target courseware.
 * @returns whether the request was handled
 */
export async function handleCoursewareRenderTasksProxy(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  if (pathname === "/courseware/render/tasks") {
    if (req.method === "POST") {
      await handleCreateRenderTask(req, res);
      return true;
    }
    if (req.method === "GET") {
      await handleListRenderTasks(req, res, url);
      return true;
    }
    return false;
  }

  const match = pathname.match(/^\/courseware\/render\/tasks\/([^/]+)\/(retry|cancel)$/);
  if (match && req.method === "POST") {
    const [, taskId, action] = match;
    if (action === "retry") {
      await handleRetryRenderTask(req, res, taskId!);
    } else {
      await handleCancelRenderTask(req, res, taskId!);
    }
    return true;
  }

  const deleteMatch = pathname.match(/^\/courseware\/render\/tasks\/([^/]+)$/);
  if (deleteMatch && req.method === "DELETE") {
    await handleDeleteRenderTask(req, res, deleteMatch[1]!);
    return true;
  }

  return false;
}
