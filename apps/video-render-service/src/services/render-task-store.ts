// SPDX-License-Identifier: AGPL-3.0-only
import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import {
  RETRYABLE_RENDER_TASK_STATUSES,
  RenderTaskEntity,
  type RenderTaskDistributedPhase,
  type RenderTaskMode,
  type RenderTaskRequestPayload,
  type RenderTaskResultPayload,
  type RenderTaskStage,
  type RenderTaskStatus,
} from "../models/render-task-entity.ts";
import { deleteOssObject } from "./oss-upload.ts";
import { sanitizeRenderTaskResultForPersistence } from "./render-task-result-urls.ts";

export interface CreateRenderTaskInput {
  /** Optional client-supplied UUID (typically from HeaderField affinity header). */
  id?: string;
  request: RenderTaskRequestPayload;
  orgId?: string | null;
  userId?: string | null;
  coursewareId?: string | null;
}

export interface ListRenderTasksFilter {
  coursewareId?: string;
  userId?: string;
  status?: RenderTaskStatus;
  /** Only return tasks created before this ISO timestamp (pagination cursor). */
  before?: string;
  limit?: number;
}

export interface ListRenderTasksResult {
  tasks: RenderTaskEntity[];
  nextCursor: string | null;
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const DELETABLE_RENDER_TASK_STATUSES: readonly RenderTaskStatus[] = [
  "completed",
  "failed",
  "interrupted",
  "cancelled",
];

async function getRepository() {
  await ensureDataSource();
  return dataSource.getRepository(RenderTaskEntity);
}

export async function createRenderTask(input: CreateRenderTaskInput): Promise<RenderTaskEntity> {
  const repo = await getRepository();
  if (input.id) {
    const existing = await repo.findOne({ where: { id: input.id } });
    if (existing) {
      throw new RenderTaskInvalidStateError(`Render task id ${input.id} already exists.`);
    }
  }
  const now = new Date();
  const task = repo.create({
    ...(input.id ? { id: input.id } : {}),
    orgId: input.orgId ?? null,
    userId: input.userId ?? null,
    coursewareId: input.coursewareId ?? null,
    status: "queued",
    stage: null,
    progress: 0,
    framesRendered: null,
    totalFrames: null,
    renderMode: "single",
    planOssPrefix: null,
    planHash: null,
    chunkCount: null,
    distributedPhase: null,
    planTakesMs: null,
    request: input.request,
    result: null,
    errorMessage: null,
    retryCount: 0,
    queuedAt: now,
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
  });
  return repo.save(task);
}

export async function getRenderTaskById(id: string): Promise<RenderTaskEntity | null> {
  const repo = await getRepository();
  return repo.findOne({ where: { id } });
}

export async function isRenderTaskCancelled(id: string): Promise<boolean> {
  const task = await getRenderTaskById(id);
  return task?.status === "cancelled";
}

export async function listRenderTasks(
  filter: ListRenderTasksFilter,
): Promise<ListRenderTasksResult> {
  const repo = await getRepository();
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

  const qb = repo.createQueryBuilder("task").orderBy("task.createdAt", "DESC").limit(limit + 1);
  if (filter.coursewareId) {
    qb.andWhere("task.coursewareId = :coursewareId", { coursewareId: filter.coursewareId });
  }
  if (filter.userId) {
    qb.andWhere("task.userId = :userId", { userId: filter.userId });
  }
  if (filter.status) {
    qb.andWhere("task.status = :status", { status: filter.status });
  }
  if (filter.before) {
    qb.andWhere("task.createdAt < :before", { before: new Date(filter.before) });
  }

  const rows = await qb.getMany();
  const hasMore = rows.length > limit;
  const tasks = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? tasks[tasks.length - 1]!.createdAt.toISOString() : null;
  return { tasks, nextCursor };
}

/**
 * Tasks stuck in `running` that need reconcile:
 * - heartbeat older than `olderThanMs` (worker likely died), and/or
 * - `startedAt` older than `fcTimeoutMs` (FC invoke budget exceeded — mark failed even if heartbeat looks fresh).
 */
export async function listStaleRunningRenderTasks(
  olderThanMs: number,
  fcTimeoutMs?: number,
): Promise<RenderTaskEntity[]> {
  const repo = await getRepository();
  const now = Date.now();
  const heartbeatThreshold = new Date(now - olderThanMs);
  const qb = repo
    .createQueryBuilder("task")
    .where("task.status = :status", { status: "running" });

  if (fcTimeoutMs != null && fcTimeoutMs > 0) {
    const startedThreshold = new Date(now - fcTimeoutMs);
    qb.andWhere(
      "(" +
        "(task.heartbeatAt IS NULL AND task.startedAt < :heartbeatThreshold) OR task.heartbeatAt < :heartbeatThreshold" +
        " OR task.startedAt < :startedThreshold" +
        ")",
      { heartbeatThreshold, startedThreshold },
    );
  } else {
    qb.andWhere(
      "(task.heartbeatAt IS NULL AND task.startedAt < :heartbeatThreshold) OR task.heartbeatAt < :heartbeatThreshold",
      { heartbeatThreshold },
    );
  }

  return qb.getMany();
}

/** Guarded transition (`WHERE status = 'queued'`); returns `false` if the task was no longer queued (e.g. cancelled concurrently). */
export async function markRenderTaskRunning(id: string): Promise<boolean> {
  const repo = await getRepository();
  const now = new Date();
  const result = await repo.update(
    { id, status: "queued" },
    { status: "running", stage: "preparing", startedAt: now, heartbeatAt: now },
  );
  return (result.affected ?? 0) > 0;
}

/**
 * Job created, pod not rendering yet: surface "node warming up" to the UI while
 * the elastic video pool provisions a node (~5-11 min) and pulls the ~4GB
 * render image (~2 min) before the worker can report real progress — without
 * this the task shows an inert `queued 0%` for that whole window
 * (2026-09-07 render latency audit).
 */
export async function markRenderTaskScheduling(id: string): Promise<void> {
  const repo = await getRepository();
  await repo.update(
    { id, status: "queued" },
    { stage: "scheduling", heartbeatAt: new Date() },
  );
}

export async function updateRenderTaskProgress(
  id: string,
  update: {
    stage?: RenderTaskStage;
    progress?: number;
    framesRendered?: number | null;
    totalFrames?: number | null;
  },
): Promise<void> {
  const repo = await getRepository();
  await repo.update(
    { id, status: "running" },
    {
      ...(update.stage !== undefined ? { stage: update.stage } : {}),
      ...(update.progress !== undefined ? { progress: update.progress } : {}),
      ...(update.framesRendered !== undefined ? { framesRendered: update.framesRendered } : {}),
      ...(update.totalFrames !== undefined ? { totalFrames: update.totalFrames } : {}),
      heartbeatAt: new Date(),
    },
  );
}

export async function updateRenderTaskDistributedMeta(
  id: string,
  update: {
    renderMode?: RenderTaskMode;
    planOssPrefix?: string | null;
    planHash?: string | null;
    chunkCount?: number | null;
    distributedPhase?: RenderTaskDistributedPhase | null;
    planTakesMs?: number | null;
    stage?: RenderTaskStage;
    progress?: number;
    framesRendered?: number | null;
    totalFrames?: number | null;
  },
): Promise<void> {
  const repo = await getRepository();
  await repo.update(
    { id, status: "running" },
    {
      ...(update.renderMode !== undefined ? { renderMode: update.renderMode } : {}),
      ...(update.planOssPrefix !== undefined ? { planOssPrefix: update.planOssPrefix } : {}),
      ...(update.planHash !== undefined ? { planHash: update.planHash } : {}),
      ...(update.chunkCount !== undefined ? { chunkCount: update.chunkCount } : {}),
      ...(update.distributedPhase !== undefined
        ? { distributedPhase: update.distributedPhase }
        : {}),
      ...(update.planTakesMs !== undefined ? { planTakesMs: update.planTakesMs } : {}),
      ...(update.stage !== undefined ? { stage: update.stage } : {}),
      ...(update.progress !== undefined ? { progress: update.progress } : {}),
      ...(update.framesRendered !== undefined ? { framesRendered: update.framesRendered } : {}),
      ...(update.totalFrames !== undefined ? { totalFrames: update.totalFrames } : {}),
      heartbeatAt: new Date(),
    },
  );
}

export async function markRenderTaskCompleted(
  id: string,
  result: RenderTaskResultPayload,
): Promise<boolean> {
  const repo = await getRepository();
  const updateResult = await repo.update(
    { id, status: "running" },
    {
      status: "completed",
      stage: null,
      progress: 100,
      framesRendered: null,
      totalFrames: null,
      distributedPhase: null,
      // Persist object references only (bucket + key) — signed URLs expire and
      // must never sit in the DB; responses re-sign from the key at read time.
      result: sanitizeRenderTaskResultForPersistence(result),
      errorMessage: null,
      completedAt: new Date(),
    },
  );
  return (updateResult.affected ?? 0) > 0;
}

/**
 * Guarded transition — returns `false` if the task is no longer `queued`/`running`
 * (e.g. cancelled). Accepts `queued` so Async schedule failures after insert can fail the row.
 */
export async function markRenderTaskFailed(id: string, errorMessage: string): Promise<boolean> {
  const repo = await getRepository();
  const result = await repo
    .createQueryBuilder()
    .update(RenderTaskEntity)
    .set({ status: "failed", errorMessage, completedAt: new Date() })
    .where("id = :id", { id })
    .andWhere("status IN (:...statuses)", { statuses: ["queued", "running"] })
    .execute();
  return (result.affected ?? 0) > 0;
}

/** Reconciliation sweep marks a task whose worker instance died mid-render as `interrupted` (distinct from `failed`, but equally retryable). */
export async function markRenderTaskInterrupted(
  id: string,
  errorCode: "service_restart" | "stale_heartbeat" = "stale_heartbeat",
): Promise<boolean> {
  const repo = await getRepository();
  const result = await repo.update(
    { id, status: "running" },
    {
      status: "interrupted",
      errorMessage: `interrupted:${errorCode}`,
      completedAt: new Date(),
    },
  );
  return (result.affected ?? 0) > 0;
}

export async function markRenderTaskCancelled(id: string): Promise<boolean> {
  const repo = await getRepository();
  const result = await repo.update(
    { id, status: "running" },
    {
      status: "cancelled",
      stage: null,
      errorMessage: "cancelled:user",
      completedAt: new Date(),
    },
  );
  return (result.affected ?? 0) > 0;
}

/** Running tasks in Postgres (admin/reconciliation helpers). */
export async function listRunningRenderTasks(): Promise<RenderTaskEntity[]> {
  const repo = await getRepository();
  return repo.find({
    where: { status: "running" },
    order: { startedAt: "ASC" },
  });
}

/** Distributed tasks still `running` (heal dispatch / assemble). */
export async function listRunningDistributedRenderTasks(): Promise<RenderTaskEntity[]> {
  const repo = await getRepository();
  return repo.find({
    where: { status: "running", renderMode: "distributed" },
    order: { startedAt: "ASC" },
  });
}

export function isRenderTaskRetryable(status: RenderTaskStatus): boolean {
  return (RETRYABLE_RENDER_TASK_STATUSES as string[]).includes(status);
}

/**
 * Re-queue a failed/interrupted task in place (same id, incremented retryCount) so task
 * history stays coherent. `urlOverride` lets the caller (courseware-agent) hand in a
 * freshly minted render token if the original one has since expired.
 */
export async function resetRenderTaskForRetry(
  id: string,
  options: { urlOverride?: string } = {},
): Promise<RenderTaskEntity> {
  const repo = await getRepository();
  const task = await repo.findOne({ where: { id } });
  if (!task) {
    throw new RenderTaskNotFoundError(id);
  }
  if (!isRenderTaskRetryable(task.status)) {
    throw new RenderTaskInvalidStateError(
      `Task ${id} is in status "${task.status}" and cannot be retried (only failed/interrupted tasks can be retried).`,
    );
  }

  task.status = "queued";
  task.stage = null;
  task.progress = 0;
  task.framesRendered = null;
  task.totalFrames = null;
  task.renderMode = "single";
  task.planOssPrefix = null;
  task.planHash = null;
  task.chunkCount = null;
  task.distributedPhase = null;
  task.planTakesMs = null;
  task.errorMessage = null;
  task.result = null;
  task.retryCount += 1;
  task.queuedAt = new Date();
  task.startedAt = null;
  task.heartbeatAt = null;
  task.completedAt = null;
  if (options.urlOverride) {
    task.request = { ...task.request, url: options.urlOverride };
  }
  return repo.save(task);
}

export async function cancelQueuedRenderTask(id: string): Promise<RenderTaskEntity> {
  const repo = await getRepository();
  const task = await repo.findOne({ where: { id } });
  if (!task) {
    throw new RenderTaskNotFoundError(id);
  }
  if (task.status !== "queued") {
    throw new RenderTaskInvalidStateError(
      `Task ${id} is in status "${task.status}" and can no longer be cancelled (only queued or running tasks can be cancelled).`,
    );
  }
  task.status = "cancelled";
  task.errorMessage = "cancelled:user";
  task.completedAt = new Date();
  return repo.save(task);
}

/**
 * Cancel a task that is `queued` or `running`.
 * Running tasks must be aborted separately via {@link abortRenderTaskExecution}.
 */
export async function cancelRenderTask(id: string): Promise<{
  task: RenderTaskEntity;
  wasRunning: boolean;
}> {
  const repo = await getRepository();
  const task = await repo.findOne({ where: { id } });
  if (!task) {
    throw new RenderTaskNotFoundError(id);
  }
  if (task.status === "queued") {
    const cancelled = await cancelQueuedRenderTask(id);
    return { task: cancelled, wasRunning: false };
  }
  if (task.status === "running") {
    const marked = await markRenderTaskCancelled(id);
    if (!marked) {
      const latest = await repo.findOne({ where: { id } });
      if (!latest) {
        throw new RenderTaskNotFoundError(id);
      }
      return { task: latest, wasRunning: true };
    }
    const updated = await repo.findOne({ where: { id } });
    if (!updated) {
      throw new RenderTaskNotFoundError(id);
    }
    return { task: updated, wasRunning: true };
  }
  throw new RenderTaskInvalidStateError(
    `Task ${id} is in status "${task.status}" and can no longer be cancelled (only queued or running tasks can be cancelled).`,
  );
}

export function isRenderTaskDeletable(status: RenderTaskStatus): boolean {
  return (DELETABLE_RENDER_TASK_STATUSES as string[]).includes(status);
}

/** Remove a terminal task record and best-effort delete its OSS video + cover assets. */
export async function deleteRenderTask(id: string): Promise<void> {
  const repo = await getRepository();
  const task = await repo.findOne({ where: { id } });
  if (!task) {
    throw new RenderTaskNotFoundError(id);
  }
  if (!isRenderTaskDeletable(task.status)) {
    throw new RenderTaskInvalidStateError(
      `Task ${id} is in status "${task.status}" and cannot be deleted (only completed/failed/interrupted/cancelled tasks can be deleted).`,
    );
  }

  const result = task.result;
  if (result?.oss?.bucket && result.oss.key) {
    try {
      await deleteOssObject(result.oss.bucket, result.oss.key);
    } catch (error) {
      console.warn(
        `[render-task-store] failed to delete OSS video for task=${id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (result?.cover?.bucket && result.cover.key) {
    try {
      await deleteOssObject(result.cover.bucket, result.cover.key);
    } catch (error) {
      console.warn(
        `[render-task-store] failed to delete OSS cover for task=${id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  await repo.delete({ id });
}

/** `status = 404` lets `resolveErrorStatus`/`isClientFacingError` map + surface this safely. */
export class RenderTaskNotFoundError extends Error {
  readonly status = 404;
  constructor(id: string) {
    super(`Render task ${id} not found`);
    this.name = "RenderTaskNotFoundError";
  }
}

/** `status = 409` lets `resolveErrorStatus`/`isClientFacingError` map + surface this safely. */
export class RenderTaskInvalidStateError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "RenderTaskInvalidStateError";
  }
}
