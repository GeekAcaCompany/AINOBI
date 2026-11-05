// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "@ainobi/courseware-player/host/requester";

/** Mirrors `RenderTaskStatus` in ainobi-video-render-service's `render-task-entity.ts`. */
export type RenderTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

/** Terminal states a task can be retried from. */
export const RETRYABLE_RENDER_TASK_STATUSES: readonly RenderTaskStatus[] = ["failed", "interrupted"];

/** Terminal states whose records (and any OSS assets) can be deleted. */
export const DELETABLE_RENDER_TASK_STATUSES: readonly RenderTaskStatus[] = [
  "completed",
  "failed",
  "interrupted",
  "cancelled",
];

/** Non-terminal states — a task in one of these is still active (queued or being rendered). */
export const ACTIVE_RENDER_TASK_STATUSES: readonly RenderTaskStatus[] = ["queued", "running"];

export interface RenderTaskRequestPayload {
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  uploadToOss?: boolean;
  title?: string;
}

export interface RenderTaskResultPayload {
  localPath: string;
  outputPath: string;
  render: { duration: number; takes: number; rtf: number };
  oss?: { bucket: string; key: string; url: string; etag?: string };
  cover?: { bucket: string; key: string; url: string; etag?: string };
}

export interface RenderTaskDto {
  id: string;
  orgId: string | null;
  userId: string | null;
  coursewareId: string | null;
  status: RenderTaskStatus;
  stage: string | null;
  progress: number;
  framesRendered: number | null;
  totalFrames: number | null;
  request: RenderTaskRequestPayload;
  result: RenderTaskResultPayload | null;
  errorMessage: string | null;
  retryCount: number;
  queuedAt: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RenderTaskResponse =
  | { ok: true; task: RenderTaskDto }
  | { ok: false; error: string };

export type RenderTaskListResponse =
  | { ok: true; tasks: RenderTaskDto[]; nextCursor: string | null }
  | { ok: false; error: string };

const REQUEST_OPTS = { responseShape: "agent" as const, agentErrorAsResult: true };

function toErrorResponse(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export interface CreateRenderTaskOptions {
  width?: number;
  height?: number;
  durationMs?: number;
  fps?: number;
  title?: string;
}

/** `POST /courseware/render/tasks` — creates (and queues) a new export task for a courseware.
 * `coursewareId` is the editor URL `courseware_id` (business key) or DB id; the agent
 * canonicalizes to DB `courseware.id` before talking to the render service.
 */
export async function createRenderTask(
  coursewareId: string,
  options?: CreateRenderTaskOptions,
  signal?: AbortSignal,
): Promise<RenderTaskResponse> {
  try {
    const parsed = (await coursewareApi.post(
      "/courseware/render/tasks",
      {
        coursewareId,
        width: options?.width,
        height: options?.height,
        durationMs: options?.durationMs,
        fps: options?.fps,
        title: options?.title,
      },
      { signal, ...REQUEST_OPTS },
    )) as RenderTaskResponse;
    if (!parsed.ok || !parsed.task) {
      return { ok: false, error: (parsed as { error?: string }).error || "invalid response" };
    }
    return parsed;
  } catch (error) {
    return toErrorResponse(error);
  }
}

export interface ListRenderTasksOptions {
  status?: RenderTaskStatus;
  cursor?: string;
  limit?: number;
}

/** `GET /courseware/render/tasks?coursewareId=...` — paginated export task history for a courseware.
 * Same `coursewareId` semantics as {@link createRenderTask} (editor key or DB id).
 */
export async function listRenderTasks(
  coursewareId: string,
  options?: ListRenderTasksOptions,
  signal?: AbortSignal,
): Promise<RenderTaskListResponse> {
  try {
    const parsed = (await coursewareApi.get(
      "/courseware/render/tasks",
      {
        coursewareId,
        status: options?.status,
        cursor: options?.cursor,
        limit: options?.limit,
      },
      { signal, ...REQUEST_OPTS },
    )) as RenderTaskListResponse;
    if (!parsed.ok) {
      return { ok: false, error: (parsed as { error?: string }).error || "invalid response" };
    }
    return {
      ok: true,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      nextCursor: parsed.nextCursor ?? null,
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** `POST /courseware/render/tasks/:id/retry` — only valid from `failed`/`interrupted`; mints a fresh render token. */
export async function retryRenderTask(taskId: string, signal?: AbortSignal): Promise<RenderTaskResponse> {
  try {
    const parsed = (await coursewareApi.post(
      `/courseware/render/tasks/${encodeURIComponent(taskId)}/retry`,
      {},
      { signal, ...REQUEST_OPTS },
    )) as RenderTaskResponse;
    if (!parsed.ok || !parsed.task) {
      return { ok: false, error: (parsed as { error?: string }).error || "invalid response" };
    }
    return parsed;
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** `POST /courseware/render/tasks/:id/cancel` — valid while `queued` or `running`. */
export async function cancelRenderTask(taskId: string, signal?: AbortSignal): Promise<RenderTaskResponse> {
  try {
    const parsed = (await coursewareApi.post(
      `/courseware/render/tasks/${encodeURIComponent(taskId)}/cancel`,
      {},
      { signal, ...REQUEST_OPTS },
    )) as RenderTaskResponse;
    if (!parsed.ok || !parsed.task) {
      return { ok: false, error: (parsed as { error?: string }).error || "invalid response" };
    }
    return parsed;
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** `DELETE /courseware/render/tasks/:id` — deletes a terminal task record and its OSS assets. */
export async function deleteRenderTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const parsed = (await coursewareApi.delete(
      `/courseware/render/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      { signal, ...REQUEST_OPTS },
    )) as { ok?: boolean; error?: string };
    if (!parsed.ok) {
      return { ok: false, error: parsed.error || "invalid response" };
    }
    return { ok: true };
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Whether a task is still queued or rendering (used to decide if polling should keep running). */
export function isRenderTaskActive(task: RenderTaskDto): boolean {
  return ACTIVE_RENDER_TASK_STATUSES.includes(task.status);
}

/** Whether a task can be retried from its current state, honoring the server-side max-retries cap. */
export function isRenderTaskRetryable(task: RenderTaskDto, maxRetries: number): boolean {
  return RETRYABLE_RENDER_TASK_STATUSES.includes(task.status) && task.retryCount < maxRetries;
}

/** Whether a terminal task record can be deleted (completed, failed, interrupted, cancelled). */
export function isRenderTaskDeletable(task: RenderTaskDto): boolean {
  return DELETABLE_RENDER_TASK_STATUSES.includes(task.status);
}
