// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";

import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import {
  RenderTaskChunkEntity,
  type RenderTaskChunkStatus,
} from "../models/render-task-chunk-entity.ts";

export interface CreateRenderTaskChunkInput {
  taskId: string;
  chunkIndex: number;
  startFrame: number;
  endFrame: number;
  affinityId?: string;
}

async function getRepository() {
  await ensureDataSource();
  return dataSource.getRepository(RenderTaskChunkEntity);
}

export async function createRenderTaskChunks(
  inputs: CreateRenderTaskChunkInput[],
): Promise<RenderTaskChunkEntity[]> {
  if (inputs.length === 0) {
    return [];
  }
  const repo = await getRepository();
  const now = new Date();
  const rows = inputs.map((input) =>
    repo.create({
      taskId: input.taskId,
      chunkIndex: input.chunkIndex,
      startFrame: input.startFrame,
      endFrame: input.endFrame,
      status: "queued" as RenderTaskChunkStatus,
      affinityId: input.affinityId ?? randomUUID(),
      ossKey: null,
      errorMessage: null,
      framesEncoded: null,
      durationMs: null,
      queuedAt: now,
      startedAt: null,
      heartbeatAt: null,
      completedAt: null,
    }),
  );
  return repo.save(rows);
}

export async function listRenderTaskChunks(taskId: string): Promise<RenderTaskChunkEntity[]> {
  const repo = await getRepository();
  return repo.find({ where: { taskId }, order: { chunkIndex: "ASC" } });
}

export async function getRenderTaskChunk(
  taskId: string,
  chunkIndex: number,
): Promise<RenderTaskChunkEntity | null> {
  const repo = await getRepository();
  return repo.findOne({ where: { taskId, chunkIndex } });
}

export async function deleteRenderTaskChunks(taskId: string): Promise<void> {
  const repo = await getRepository();
  await repo.delete({ taskId });
}

/** Guarded `queued` → `running`. */
export async function markRenderTaskChunkRunning(
  taskId: string,
  chunkIndex: number,
): Promise<boolean> {
  const repo = await getRepository();
  const now = new Date();
  const result = await repo.update(
    { taskId, chunkIndex, status: "queued" },
    { status: "running", startedAt: now, heartbeatAt: now },
  );
  return (result.affected ?? 0) > 0;
}

export async function touchRenderTaskChunkHeartbeat(
  taskId: string,
  chunkIndex: number,
): Promise<void> {
  const repo = await getRepository();
  await repo.update(
    { taskId, chunkIndex, status: "running" },
    { heartbeatAt: new Date() },
  );
}

export async function markRenderTaskChunkCompleted(
  taskId: string,
  chunkIndex: number,
  update: { ossKey: string; framesEncoded: number; durationMs: number },
): Promise<boolean> {
  const repo = await getRepository();
  const result = await repo.update(
    { taskId, chunkIndex, status: "running" },
    {
      status: "completed",
      ossKey: update.ossKey,
      framesEncoded: update.framesEncoded,
      durationMs: update.durationMs,
      errorMessage: null,
      completedAt: new Date(),
      heartbeatAt: new Date(),
    },
  );
  return (result.affected ?? 0) > 0;
}

export async function markRenderTaskChunkFailed(
  taskId: string,
  chunkIndex: number,
  errorMessage: string,
): Promise<boolean> {
  const repo = await getRepository();
  const result = await repo.update(
    { taskId, chunkIndex, status: "running" },
    {
      status: "failed",
      errorMessage,
      completedAt: new Date(),
      heartbeatAt: new Date(),
    },
  );
  return (result.affected ?? 0) > 0;
}

export async function cancelOpenRenderTaskChunks(
  taskId: string,
  reason: string = "cancelled:user",
): Promise<number> {
  const repo = await getRepository();
  const result = await repo
    .createQueryBuilder()
    .update(RenderTaskChunkEntity)
    .set({
      status: "cancelled",
      errorMessage: reason,
      completedAt: new Date(),
    })
    .where("task_id = :taskId", { taskId })
    .andWhere("status IN (:...statuses)", { statuses: ["queued", "running"] })
    .execute();
  return result.affected ?? 0;
}

/** Chunks still waiting to be picked up by a worker (dispatch may have been lost). */
export async function listQueuedRenderTaskChunks(
  taskId: string,
): Promise<RenderTaskChunkEntity[]> {
  const repo = await getRepository();
  return repo.find({
    where: { taskId, status: "queued" },
    order: { chunkIndex: "ASC" },
  });
}

/** Running chunks (for affinity cancel fan-out). */
export async function listRunningRenderTaskChunks(
  taskId: string,
): Promise<RenderTaskChunkEntity[]> {
  const repo = await getRepository();
  return repo.find({
    where: { taskId, status: "running" },
    order: { chunkIndex: "ASC" },
  });
}

/**
 * Reset heartbeat-stale `running` chunks back to `queued` with a fresh affinity id
 * so heal can re-dispatch onto a live FC instance.
 */
export async function requeueStaleRunningRenderTaskChunks(
  taskId: string,
  staleMs: number,
  nowMs: number = Date.now(),
): Promise<RenderTaskChunkEntity[]> {
  const repo = await getRepository();
  const running = await listRunningRenderTaskChunks(taskId);
  const thresholdMs = nowMs - staleMs;
  const requeued: RenderTaskChunkEntity[] = [];

  for (const chunk of running) {
    const anchor = chunk.heartbeatAt ?? chunk.startedAt;
    if (anchor && anchor.getTime() >= thresholdMs) {
      continue;
    }
    const result = await repo.update(
      { taskId, chunkIndex: chunk.chunkIndex, status: "running" },
      {
        status: "queued",
        startedAt: null,
        heartbeatAt: null,
        completedAt: null,
        queuedAt: new Date(nowMs),
        affinityId: randomUUID(),
        errorMessage: "requeued:stale_heartbeat",
        ossKey: null,
        framesEncoded: null,
        durationMs: null,
      },
    );
    if ((result.affected ?? 0) > 0) {
      const updated = await getRenderTaskChunk(taskId, chunk.chunkIndex);
      if (updated) {
        requeued.push(updated);
      }
    }
  }

  return requeued;
}

export async function sumCompletedChunkFrames(taskId: string): Promise<number> {
  const repo = await getRepository();
  const raw = await repo
    .createQueryBuilder("chunk")
    .select("COALESCE(SUM(chunk.framesEncoded), 0)", "total")
    .where("chunk.taskId = :taskId", { taskId })
    .andWhere("chunk.status = :status", { status: "completed" })
    .getRawOne<{ total: string }>();
  return Number(raw?.total ?? 0);
}

/** Sum of per-chunk instance wall clocks for distributed billing. */
export async function sumCompletedChunkDurationsMs(taskId: string): Promise<number> {
  const repo = await getRepository();
  const raw = await repo
    .createQueryBuilder("chunk")
    .select("COALESCE(SUM(chunk.durationMs), 0)", "total")
    .where("chunk.taskId = :taskId", { taskId })
    .andWhere("chunk.status = :status", { status: "completed" })
    .getRawOne<{ total: string }>();
  return Number(raw?.total ?? 0);
}

export async function countChunksByStatus(
  taskId: string,
): Promise<Record<RenderTaskChunkStatus, number>> {
  const chunks = await listRenderTaskChunks(taskId);
  const counts: Record<RenderTaskChunkStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const chunk of chunks) {
    counts[chunk.status] += 1;
  }
  return counts;
}

/** True when every chunk is `completed` (and there is at least one). */
export async function areAllChunksCompleted(taskId: string): Promise<boolean> {
  const chunks = await listRenderTaskChunks(taskId);
  return chunks.length > 0 && chunks.every((c) => c.status === "completed");
}
