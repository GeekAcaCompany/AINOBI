// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import { z, ZodError } from "zod";

import {
  RENDER_TASK_AFFINITY_HEADER_NAME,
  resolveRenderTaskMaxRetries,
} from "../../config/video-render.ts";
import type { RenderTaskEntity, RenderTaskStatus } from "../../models/render-task-entity.ts";
import {
  reconcileRunningRenderTaskIfOrphaned,
  runRenderTaskAssembleWorker,
  runRenderTaskChunkWorker,
  runRenderTaskExecution,
} from "../../services/render-task-dispatcher.ts";
import { stopDistributedRenderWorkers } from "../../services/distributed-cancel.ts";
import {
  renderBaseUrlForScheduling,
  RenderScheduleError,
  scheduleRenderTaskRun,
} from "../../services/render-task-schedule.ts";
import { requestFcRenderInstanceExit } from "../../fc-instance-lifecycle.ts";
import {
  cancelRenderTask,
  createRenderTask,
  deleteRenderTask,
  getRenderTaskById,
  listRenderTasks,
  markRenderTaskFailed,
  RenderTaskInvalidStateError,
  RenderTaskNotFoundError,
  resetRenderTaskForRetry,
} from "../../services/render-task-store.ts";
import {
  deleteRenderTaskChunks,
  listRenderTaskChunks,
} from "../../services/render-task-chunk-store.ts";
import { toUserFacingRenderErrorMessage } from "../../services/render-error-message.ts";
import { presignRenderTaskResultForResponse } from "../../services/render-task-result-urls.ts";
import { videoRenderRequestSchema } from "../../services/video-render.ts";
import { assertRenderUrlAllowed } from "../../services/render-url-guard.ts";
import { readJsonBody, sendJson } from "../request.ts";
import {
  buildDistributedPlanOssPrefix,
  deleteOssPrefix,
} from "../../services/oss-upload.ts";
import { resolveVideoRenderOssBucket } from "../../config/video-render.ts";

/** Echo affinity header so clients/proxies can pin follow-up requests to the same FC instance. */
function withTaskAffinityHeaders(taskId: string): Record<string, string> {
  return { [RENDER_TASK_AFFINITY_HEADER_NAME]: taskId };
}

function readAffinityTaskId(req: IncomingMessage): string | undefined {
  const raw = req.headers[RENDER_TASK_AFFINITY_HEADER_NAME];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed || undefined;
}

const affinityTaskIdSchema = z.string().uuid();

const RENDER_TASK_STATUSES: readonly RenderTaskStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
];

export const createRenderTaskSchema = videoRenderRequestSchema.extend({
  /** Canonical courseware DB primary key (agent resolves editor key → id before create). */
  coursewareId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  callbackUrl: z.string().trim().url().optional(),
});

const retryRenderTaskSchema = z.object({
  url: z.string().trim().url().optional(),
});

export function toRenderTaskResponse(task: RenderTaskEntity) {
  return {
    id: task.id,
    orgId: task.orgId,
    userId: task.userId,
    coursewareId: task.coursewareId,
    status: task.status,
    stage: task.stage,
    progress: task.progress,
    framesRendered: task.framesRendered,
    totalFrames: task.totalFrames,
    renderMode: task.renderMode,
    chunkCount: task.chunkCount,
    distributedPhase: task.distributedPhase,
    request: task.request,
    // Fresh URLs re-signed from the persisted keys — the DB never holds signatures.
    result: presignRenderTaskResultForResponse(task.result),
    // DB keeps the raw pipeline error for ops; clients/callbacks only see product copy.
    errorMessage: toUserFacingRenderErrorMessage(task.errorMessage),
    retryCount: task.retryCount,
    queuedAt: task.queuedAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    heartbeatAt: task.heartbeatAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function formatValidationError(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

function waitForResponseFinished(res: ServerResponse): Promise<void> {
  if (res.writableFinished || res.writableEnded) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    res.once("finish", resolve);
    res.once("close", resolve);
  });
}

/** After `/run` on FC render, recycle the instance (releases zombie Chrome children). */
async function finishRenderWorkerResponse(
  res: ServerResponse,
  taskId: string,
): Promise<void> {
  if (res.headersSent) {
    await waitForResponseFinished(res);
  }
  console.info(`[render-task] task=${taskId} worker done; recycling FC render instance if configured`);
  requestFcRenderInstanceExit(`render worker finished for task=${taskId}`);
}

/** `/render/tasks/:id` or `/render/tasks/:id/retry` etc. — returns `[id, action]`, action is `undefined` for the bare detail path. */
function parseTaskIdRoute(pathname: string): { id: string; action?: string } | null {
  const match = pathname.match(/^\/render\/tasks\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) {
    return null;
  }
  const [, id, action] = match;
  if (!id) {
    return null;
  }
  return { id, action };
}

/** `/render/tasks/:id/chunks/:index/run` */
function parseChunkRunRoute(
  pathname: string,
): { id: string; chunkIndex: number } | null {
  const match = pathname.match(/^\/render\/tasks\/([^/]+)\/chunks\/([^/]+)\/run$/);
  if (!match) {
    return null;
  }
  const id = match[1];
  const indexRaw = match[2];
  if (!id || indexRaw == null) {
    return null;
  }
  const chunkIndex = Number(indexRaw);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return null;
  }
  return { id, chunkIndex };
}

async function cleanupDistributedArtifacts(taskId: string): Promise<void> {
  await deleteRenderTaskChunks(taskId).catch(() => undefined);
  try {
    const bucket = resolveVideoRenderOssBucket();
    await deleteOssPrefix(bucket, buildDistributedPlanOssPrefix(taskId));
    await deleteOssPrefix(bucket, `renders/${taskId}/chunks`);
  } catch (error) {
    console.warn(
      `[render-task] failed to cleanup distributed OSS for task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Create a queued render task and return immediately.
 *
 * Requires `ainobi-render-task-id: <uuid>` (becomes the task id). After insert on the
 * query function, schedules Async `/run` on the render function.
 */
export async function handleCreateRenderTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const affinityRaw = readAffinityTaskId(req);
  const affinityParsed = affinityTaskIdSchema.safeParse(affinityRaw);
  if (!affinityParsed.success) {
    sendJson(res, 400, {
      ok: false,
      error:
        `Missing or invalid ${RENDER_TASK_AFFINITY_HEADER_NAME} header (must be a UUID). ` +
        "Clients must generate the task id up front; the render function uses it for FC HeaderField affinity on /run and cancel.",
    });
    return;
  }
  const taskId = affinityParsed.data;

  const body = await readJsonBody<unknown>(req);
  const parsed = createRenderTaskSchema.safeParse(body);
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: formatValidationError(parsed.error) });
    return;
  }

  await assertRenderUrlAllowed(parsed.data.url);

  const { coursewareId, userId, orgId, ...request } = parsed.data;
  const task = await createRenderTask({ id: taskId, request, coursewareId, userId, orgId });
  try {
    await scheduleRenderTaskRun(task.id, renderBaseUrlForScheduling(req));
  } catch (error) {
    if (error instanceof RenderScheduleError) {
      await markRenderTaskFailed(task.id, error.message);
      const latest = (await getRenderTaskById(task.id)) ?? task;
      sendJson(
        res,
        502,
        { ok: false, error: error.message, task: toRenderTaskResponse(latest) },
        withTaskAffinityHeaders(task.id),
      );
      return;
    }
    throw error;
  }

  sendJson(res, 201, { ok: true, task: toRenderTaskResponse(task) }, withTaskAffinityHeaders(task.id));
}

/**
 * Blocking render worker. On FC this is invoked with `X-Fc-Invocation-Type: Async`
 * so the create/retry caller is not held open; the async invocation itself awaits
 * the full render (keeps the instance warm).
 */
export async function handleRunRenderTask(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  try {
    const task = await getRenderTaskById(id);
    if (!task) {
      throw new RenderTaskNotFoundError(id);
    }
    if (task.status !== "queued") {
      throw new RenderTaskInvalidStateError(
        `Task ${id} is in status "${task.status}" and cannot be run (only queued tasks can be run).`,
      );
    }

    await runRenderTaskExecution(id);

    const latest = (await getRenderTaskById(id)) ?? task;
    sendJson(res, 200, { ok: true, task: toRenderTaskResponse(latest) }, withTaskAffinityHeaders(id));
  } finally {
    await finishRenderWorkerResponse(res, id);
  }
}

export async function handleRunRenderTaskChunk(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  chunkIndex: number,
): Promise<void> {
  const chunk = (await listRenderTaskChunks(id)).find((c) => c.chunkIndex === chunkIndex);
  const affinityId = chunk?.affinityId ?? id;
  try {
    await runRenderTaskChunkWorker(id, chunkIndex);
    const latest = await getRenderTaskById(id);
    sendJson(
      res,
      200,
      { ok: true, task: latest ? toRenderTaskResponse(latest) : null, chunkIndex },
      withTaskAffinityHeaders(affinityId),
    );
  } finally {
    await finishRenderWorkerResponse(res, `${id}:chunk:${chunkIndex}`);
  }
}

export async function handleAssembleRenderTask(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  try {
    await runRenderTaskAssembleWorker(id);
    const latest = await getRenderTaskById(id);
    sendJson(
      res,
      200,
      { ok: true, task: latest ? toRenderTaskResponse(latest) : null },
      withTaskAffinityHeaders(id),
    );
  } finally {
    await finishRenderWorkerResponse(res, `${id}:assemble`);
  }
}

export async function handleGetRenderTask(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const task = await getRenderTaskById(id);
  if (!task) {
    throw new RenderTaskNotFoundError(id);
  }
  // Lazy orphan reconcile: FC hard-kill can leave `running` with no callback until swept.
  const reconciled = await reconcileRunningRenderTaskIfOrphaned(task);
  sendJson(res, 200, { ok: true, task: toRenderTaskResponse(reconciled) }, withTaskAffinityHeaders(reconciled.id));
}

export async function handleListRenderTasks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const status = url.searchParams.get("status")?.trim();
  if (status && !RENDER_TASK_STATUSES.includes(status as RenderTaskStatus)) {
    sendJson(res, 400, { ok: false, error: `Invalid status "${status}"` });
    return;
  }
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const { tasks, nextCursor } = await listRenderTasks({
    coursewareId: url.searchParams.get("coursewareId")?.trim() || undefined,
    userId: url.searchParams.get("userId")?.trim() || undefined,
    status: (status as RenderTaskStatus) || undefined,
    before: url.searchParams.get("cursor")?.trim() || undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  sendJson(res, 200, { ok: true, tasks: tasks.map(toRenderTaskResponse), nextCursor });
}

export async function handleRetryRenderTask(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const body = await readJsonBody<unknown>(req).catch(() => ({}));
  const parsed = retryRenderTaskSchema.safeParse(body);
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: formatValidationError(parsed.error) });
    return;
  }

  const existing = await getRenderTaskById(id);
  if (!existing) {
    throw new RenderTaskNotFoundError(id);
  }
  const maxRetries = resolveRenderTaskMaxRetries();
  if (existing.retryCount >= maxRetries) {
    throw new RenderTaskInvalidStateError(
      `Task ${id} has already been retried ${existing.retryCount} time(s) (max ${maxRetries}).`,
    );
  }
  if (parsed.data.url) {
    await assertRenderUrlAllowed(parsed.data.url);
  }

  await cleanupDistributedArtifacts(id);
  const task = await resetRenderTaskForRetry(id, { urlOverride: parsed.data.url });
  try {
    await scheduleRenderTaskRun(task.id, renderBaseUrlForScheduling(req));
  } catch (error) {
    if (error instanceof RenderScheduleError) {
      await markRenderTaskFailed(task.id, error.message);
      const latest = (await getRenderTaskById(task.id)) ?? task;
      sendJson(
        res,
        502,
        { ok: false, error: error.message, task: toRenderTaskResponse(latest) },
        withTaskAffinityHeaders(task.id),
      );
      return;
    }
    throw error;
  }

  sendJson(res, 200, { ok: true, task: toRenderTaskResponse(task) }, withTaskAffinityHeaders(task.id));
}

export async function handleCancelRenderTask(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const existing = await getRenderTaskById(id);
  if (!existing) {
    throw new RenderTaskNotFoundError(id);
  }
  // Affinity fan-out may hit /cancel after the primary already marked cancelled —
  // still abort local chunk/assemble controllers on this instance.
  if (existing.status === "cancelled") {
    const { abortRenderTaskExecution } = await import("../../services/render-task-abort.ts");
    abortRenderTaskExecution(id);
    sendJson(res, 200, { ok: true, task: toRenderTaskResponse(existing) }, withTaskAffinityHeaders(id));
    return;
  }

  const { task } = await cancelRenderTask(id);
  // Cancel chunks + affinity fan-out + local abort (no-op when nothing is running here).
  void stopDistributedRenderWorkers(id, { reason: "cancelled:user" });
  sendJson(res, 200, { ok: true, task: toRenderTaskResponse(task) }, withTaskAffinityHeaders(task.id));
}

export async function handleDeleteRenderTask(_req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  await cleanupDistributedArtifacts(id);
  await deleteRenderTask(id);
  sendJson(res, 200, { ok: true }, withTaskAffinityHeaders(id));
}

/** Dispatch a `/render/tasks*` request. Returns `false` if the path didn't match any task route. */
export async function handleRenderTasksRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const method = req.method ?? "GET";

  if (pathname === "/render/tasks") {
    if (method === "POST") {
      await handleCreateRenderTask(req, res);
      return true;
    }
    if (method === "GET") {
      await handleListRenderTasks(req, res);
      return true;
    }
    return false;
  }

  const chunkRoute = parseChunkRunRoute(pathname);
  if (chunkRoute && method === "POST") {
    await handleRunRenderTaskChunk(req, res, chunkRoute.id, chunkRoute.chunkIndex);
    return true;
  }

  const route = parseTaskIdRoute(pathname);
  if (!route) {
    return false;
  }

  if (!route.action && method === "GET") {
    await handleGetRenderTask(req, res, route.id);
    return true;
  }
  if (!route.action && method === "DELETE") {
    await handleDeleteRenderTask(req, res, route.id);
    return true;
  }
  if (route.action === "run" && method === "POST") {
    await handleRunRenderTask(req, res, route.id);
    return true;
  }
  if (route.action === "assemble" && method === "POST") {
    await handleAssembleRenderTask(req, res, route.id);
    return true;
  }
  if (route.action === "retry" && method === "POST") {
    await handleRetryRenderTask(req, res, route.id);
    return true;
  }
  if (route.action === "cancel" && method === "POST") {
    await handleCancelRenderTask(req, res, route.id);
    return true;
  }

  return false;
}
