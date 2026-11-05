// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Entrypoint for K8s render Jobs ("one render = one pod" dispatch).
 *
 * The Job pod runs exactly one unit of work — a full run, one distributed
 * chunk, or an assemble — by invoking the same dispatcher functions the HTTP
 * worker uses, then exits. Completion/failure state is recorded in the DB by
 * those functions (including cancel polling and timeouts), so the Job simply
 * needs to reach a terminal exit code; `restartPolicy: OnFailure` plus the
 * dispatcher's own idempotency guards make restarts safe.
 *
 * Env: AINOBI_RENDER_JOB_TYPE = run | chunk | assemble
 *      AINOBI_RENDER_JOB_TASK_ID = <uuid>
 *      AINOBI_RENDER_JOB_CHUNK_INDEX = <n> (chunk only)
 */
import { ensureDataSource } from "../db/ensure-data-source.ts";
import {
  runRenderTaskAssembleWorker,
  runRenderTaskChunkWorker,
  runRenderTaskExecution,
} from "../services/render-task-dispatcher.ts";
import { getRenderTaskById } from "../services/render-task-store.ts";

async function main(): Promise<void> {
  const type = process.env.AINOBI_RENDER_JOB_TYPE?.trim();
  const taskId = process.env.AINOBI_RENDER_JOB_TASK_ID?.trim();
  if (!type || !taskId) {
    throw new Error(`job entry: AINOBI_RENDER_JOB_TYPE / AINOBI_RENDER_JOB_TASK_ID unset`);
  }
  await ensureDataSource();

  if (type === "run") {
    // Mirror the HTTP run guard: only a queued task may start.
    const task = await getRenderTaskById(taskId);
    if (!task) {
      throw new Error(`job entry: task ${taskId} not found`);
    }
    if (task.status !== "queued") {
      console.info(`[job] run task=${taskId} status=${task.status}; nothing to do`);
      return;
    }
    await runRenderTaskExecution(taskId);
    return;
  }
  if (type === "chunk") {
    const chunkIndex = Number(process.env.AINOBI_RENDER_JOB_CHUNK_INDEX);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new Error(`job entry: invalid AINOBI_RENDER_JOB_CHUNK_INDEX`);
    }
    await runRenderTaskChunkWorker(taskId, chunkIndex);
    return;
  }
  if (type === "assemble") {
    await runRenderTaskAssembleWorker(taskId);
    return;
  }
  throw new Error(`job entry: unknown AINOBI_RENDER_JOB_TYPE "${type}"`);
}

main()
  .then(() => {
    console.info(`[job] finished`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      `[job] failed:`,
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exit(1);
  });
