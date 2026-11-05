// SPDX-License-Identifier: AGPL-3.0-only
import { resolveRenderBaseUrl } from "../config/video-render.ts";
import { resolveRenderJobDispatchEnabled } from "./k8s-jobs.ts";
import { abortRenderTaskExecution } from "./render-task-abort.ts";
import {
  cancelOpenRenderTaskChunks,
  listRenderTaskChunks,
  listRunningRenderTaskChunks,
} from "./render-task-chunk-store.ts";
import { scheduleRenderTaskCancelOnAffinity } from "./render-task-schedule.ts";

/**
 * Stop sibling chunk/assemble workers after parent failure or user cancel:
 * 1. Mark open chunks cancelled in DB (workers poll this).
 * 2. Best-effort Async cancel to each running/queued chunk's affinity session.
 * 3. Abort any local AbortControllers for this task (`taskId` and `taskId:*`).
 */
export async function stopDistributedRenderWorkers(
  taskId: string,
  options: {
    reason?: string;
    renderBaseUrl?: string;
    /** Also fan-out cancel using each chunk's affinity id (FC). Default true. */
    fanoutCancel?: boolean;
  } = {},
): Promise<void> {
  const reason = options.reason ?? "cancelled:parent";
  await cancelOpenRenderTaskChunks(taskId, reason).catch(() => 0);

  // Job-mode pods poll the DB cancel flag themselves (step 1) — no HTTP fan-out.
  const fanout = options.fanoutCancel !== false && !resolveRenderJobDispatchEnabled();
  if (fanout) {
    const renderBaseUrl = resolveRenderBaseUrl(options.renderBaseUrl);
    let targets = await listRunningRenderTaskChunks(taskId).catch(() => []);
    if (targets.length === 0) {
      // Include queued — their Async invoke may still be in flight on an instance.
      targets = (await listRenderTaskChunks(taskId).catch(() => [])).filter(
        (c) => c.status === "queued" || c.status === "running",
      );
    }
    const seen = new Set<string>();
    for (const chunk of targets) {
      if (seen.has(chunk.affinityId)) {
        continue;
      }
      seen.add(chunk.affinityId);
      await scheduleRenderTaskCancelOnAffinity({
        taskId,
        affinityId: chunk.affinityId,
        renderBaseUrl,
        label: `cancel task=${taskId} chunk=${chunk.chunkIndex}`,
      });
    }
  }

  abortRenderTaskExecution(taskId);
}
