// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from "node:http";

import {
  isRunningOnAliyunFc,
  RENDER_TASK_AFFINITY_HEADER_NAME,
  resolveFunctionRole,
  resolveRenderBaseUrl,
  resolveSelfBaseUrl,
} from "../config/video-render.ts";
import { createRenderJob, resolveRenderJobDispatchEnabled } from "./k8s-jobs.ts";
import { markRenderTaskScheduling } from "./render-task-store.ts";

/**
 * K8s Job dispatch ("one render = one pod"): when enabled, run/chunk/assemble
 * units become short-lived Jobs cloned from the worker Deployment template
 * instead of fire-and-forget HTTP against the shared Deployment. See
 * {@link createRenderJob}.
 */
async function scheduleRenderJob(options: {
  type: "run" | "chunk" | "assemble";
  taskId: string;
  chunkIndex?: number;
  label: string;
}): Promise<void> {
  const result = await createRenderJob(options);
  console.info(
    `[render-schedule] job ${result.jobName} ` +
      `${result.created ? "created" : `reused (${result.reason})`}`,
  );
  if (options.type === "run" && result.created) {
    // Job exists but the pod still has to wait for a video node + image pull:
    // tell the UI the task is being scheduled instead of an inert `queued 0%`.
    await markRenderTaskScheduling(options.taskId).catch((error) => {
      console.warn(
        `[render-schedule] failed to mark scheduling for task=${options.taskId}:`,
        error instanceof Error ? error.message : error,
      );
    });
  }
}

function resolveInternalToken(): string | null {
  return process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN?.trim() || null;
}

/**
 * Whether the configured render base URL points at a remote target (Kubernetes
 * Service) rather than this same process. Remote targets receive HTTP fire-and-
 * forget scheduling so a single video fans out across many worker pods — the
 * Kubernetes replacement for Aliyun FC's per-invocation auto scaling.
 */
function isRemoteDispatchTarget(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget HTTP scheduling against a remote worker target. Never awaits
 * the worker's completion — workers hold their own `/run` connections for the
 * full render, and task state is tracked in the DB (heartbeat + heal) either way.
 */
function scheduleHttpRun(
  path: string,
  affinityId: string,
  targetBaseUrl: string,
  label: string,
): void {
  const url = `${targetBaseUrl}${path}`;
  const token = resolveInternalToken();
  const attemptOnce = async (attempt: number): Promise<void> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RENDER_TASK_AFFINITY_HEADER_NAME]: affinityId,
          ...(token ? { "x-ainobi-internal-token": token } : {}),
        },
        body: "{}",
      });
      // The response body arrives only after the worker finishes; do not read it.
      console.info(`[render-schedule] ${label} accepted (HTTP ${res.status})`);
    } catch (error) {
      console.warn(
        `[render-schedule] ${label} attempt ${attempt} failed: ` +
          (error instanceof Error ? error.message : error),
      );
      if (attempt < 3) {
        setTimeout(() => void attemptOnce(attempt + 1), 3000);
      } else {
        console.error(`[render-schedule] ${label} gave up — task healed via DB reconciler`);
      }
    }
  };
  void attemptOnce(1);
}

/** Best-effort public base URL of this service from the inbound create/retry request. */
export function selfBaseUrlFromRequest(req: IncomingMessage): string {
  const xfProto = headerFirst(req.headers["x-forwarded-proto"]);
  const xfHost = headerFirst(req.headers["x-forwarded-host"]);
  const host = xfHost || headerFirst(req.headers.host);
  if (host) {
    const proto = xfProto || (isRunningOnAliyunFc() ? "https" : "http");
    return resolveSelfBaseUrl(`${proto}://${host}`);
  }
  return resolveSelfBaseUrl();
}

/** Render-function base URL for scheduling `/render/tasks/:id/run` (split FC deploy). */
export function renderBaseUrlFromRequest(req: IncomingMessage): string {
  const xfProto = headerFirst(req.headers["x-forwarded-proto"]);
  const xfHost = headerFirst(req.headers["x-forwarded-host"]);
  const host = xfHost || headerFirst(req.headers.host);
  if (host) {
    const proto = xfProto || (isRunningOnAliyunFc() ? "https" : "http");
    return resolveRenderBaseUrl(`${proto}://${host}`);
  }
  return resolveRenderBaseUrl();
}

/**
 * Base URL for Async `/run` scheduling. Query function must target render explicitly
 * (never the inbound request host, which would hit query again).
 */
export function renderBaseUrlForScheduling(req: IncomingMessage): string {
  if (resolveFunctionRole() === "query") {
    return resolveRenderBaseUrl();
  }
  return renderBaseUrlFromRequest(req);
}

function headerFirst(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/** Thrown when an FC Async invoke is not accepted (or token/network fails). */
export class RenderScheduleError extends Error {
  readonly status = 502;
  constructor(message: string) {
    super(message);
    this.name = "RenderScheduleError";
  }
}

/**
 * Kick off the blocking `POST /render/tasks/:id/run` without holding the create/retry
 * response open for the full render.
 */
export async function scheduleRenderTaskRun(taskId: string, renderBaseUrl: string): Promise<void> {
  if (resolveRenderJobDispatchEnabled() && !isRunningOnAliyunFc()) {
    await scheduleRenderJob({ type: "run", taskId, label: `run task=${taskId}` });
    return;
  }
  const targetBaseUrl = resolveRenderBaseUrl(renderBaseUrl);
  if (isRunningOnAliyunFc()) {
    await invokeRenderWorkerAsync({
      path: `/render/tasks/${encodeURIComponent(taskId)}/run`,
      affinityId: taskId,
      selfBaseUrl: targetBaseUrl,
      label: `run task=${taskId}`,
    });
    return;
  }
  if (isRemoteDispatchTarget(targetBaseUrl)) {
    scheduleHttpRun(
      `/render/tasks/${encodeURIComponent(taskId)}/run`,
      taskId,
      targetBaseUrl,
      `run task=${taskId}`,
    );
    return;
  }
  void import("./render-task-dispatcher.ts")
    .then(({ runRenderTaskExecution }) => runRenderTaskExecution(taskId))
    .catch((error) => {
      console.warn(
        `[render-task] local run failed for task=${taskId}:`,
        error instanceof Error ? error.message : error,
      );
    });
}

export async function scheduleRenderTaskChunkRun(options: {
  taskId: string;
  chunkIndex: number;
  affinityId: string;
  renderBaseUrl: string;
}): Promise<void> {
  const { taskId, chunkIndex, affinityId, renderBaseUrl } = options;
  if (resolveRenderJobDispatchEnabled() && !isRunningOnAliyunFc()) {
    await scheduleRenderJob({
      type: "chunk",
      taskId,
      chunkIndex,
      label: `chunk task=${taskId} index=${chunkIndex}`,
    });
    return;
  }
  const targetBaseUrl = resolveRenderBaseUrl(renderBaseUrl);
  const path =
    `/render/tasks/${encodeURIComponent(taskId)}` +
    `/chunks/${encodeURIComponent(String(chunkIndex))}/run`;

  if (isRunningOnAliyunFc()) {
    await invokeRenderWorkerAsync({
      path,
      affinityId,
      selfBaseUrl: targetBaseUrl,
      label: `chunk task=${taskId} index=${chunkIndex}`,
    });
    return;
  }
  if (isRemoteDispatchTarget(targetBaseUrl)) {
    scheduleHttpRun(path, affinityId, targetBaseUrl, `chunk task=${taskId} index=${chunkIndex}`);
    return;
  }

  void import("./render-task-dispatcher.ts")
    .then(({ runRenderTaskChunkWorker }) => runRenderTaskChunkWorker(taskId, chunkIndex))
    .catch((error) => {
      console.warn(
        `[render-task] local chunk run failed for task=${taskId} chunk=${chunkIndex}:`,
        error instanceof Error ? error.message : error,
      );
    });
}

export async function scheduleRenderTaskAssemble(options: {
  taskId: string;
  affinityId: string;
  renderBaseUrl: string;
}): Promise<void> {
  const { taskId, affinityId, renderBaseUrl } = options;
  if (resolveRenderJobDispatchEnabled() && !isRunningOnAliyunFc()) {
    await scheduleRenderJob({ type: "assemble", taskId, label: `assemble task=${taskId}` });
    return;
  }
  const targetBaseUrl = resolveRenderBaseUrl(renderBaseUrl);
  const path = `/render/tasks/${encodeURIComponent(taskId)}/assemble`;

  if (isRunningOnAliyunFc()) {
    await invokeRenderWorkerAsync({
      path,
      affinityId,
      selfBaseUrl: targetBaseUrl,
      label: `assemble task=${taskId}`,
    });
    return;
  }
  if (isRemoteDispatchTarget(targetBaseUrl)) {
    scheduleHttpRun(path, affinityId, targetBaseUrl, `assemble task=${taskId}`);
    return;
  }

  void import("./render-task-dispatcher.ts")
    .then(({ runRenderTaskAssembleWorker }) => runRenderTaskAssembleWorker(taskId))
    .catch((error) => {
      console.warn(
        `[render-task] local assemble failed for task=${taskId}:`,
        error instanceof Error ? error.message : error,
      );
    });
}

/**
 * Best-effort: route cancel to a specific FC session (chunk/assemble affinity) so the
 * instance that owns the AbortController can stop promptly. Failures are logged only.
 */
export async function scheduleRenderTaskCancelOnAffinity(options: {
  taskId: string;
  affinityId: string;
  renderBaseUrl: string;
  label?: string;
}): Promise<void> {
  const { taskId, affinityId, renderBaseUrl, label } = options;
  const targetBaseUrl = resolveRenderBaseUrl(renderBaseUrl);
  const path = `/render/tasks/${encodeURIComponent(taskId)}/cancel`;
  try {
    if (isRunningOnAliyunFc()) {
      await invokeRenderWorkerAsync({
        path,
        affinityId,
        selfBaseUrl: targetBaseUrl,
        label: label ?? `cancel task=${taskId} affinity=${affinityId}`,
        // Cancel is sync on the worker; Async still fine — we only need the invoke to land.
      });
      return;
    }
    const { stopRunningRenderTask } = await import("./render-task-dispatcher.ts");
    await stopRunningRenderTask(taskId);
  } catch (error) {
    console.warn(
      `[render-task] cancel fan-out failed for task=${taskId} affinity=${affinityId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * FC Async HTTP invoke. Throws {@link RenderScheduleError} when the invoke is not accepted.
 */
export async function invokeRenderWorkerAsync(options: {
  path: string;
  affinityId: string;
  selfBaseUrl: string;
  label: string;
}): Promise<void> {
  const token = resolveInternalToken();
  if (!token) {
    throw new RenderScheduleError(
      `cannot async-invoke ${options.label}: AINOBI_VIDEO_RENDER_INTERNAL_TOKEN unset`,
    );
  }
  const url = `${options.selfBaseUrl.replace(/\/+$/, "")}${options.path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ainobi-internal-token": token,
        [RENDER_TASK_AFFINITY_HEADER_NAME]: options.affinityId,
        "X-Fc-Invocation-Type": "Async",
      },
      body: "{}",
    });
  } catch (error) {
    throw new RenderScheduleError(
      `async invoke failed for ${options.label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // FC Async accepts with 202; anything else is a hard scheduling failure.
  if (response.status !== 202 && (response.status < 200 || response.status >= 300)) {
    const text = await response.text().catch(() => "");
    throw new RenderScheduleError(
      `async invoke for ${options.label} returned HTTP ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  console.info(`[render-task] async scheduled ${options.label} via ${url} (HTTP ${response.status})`);
}
