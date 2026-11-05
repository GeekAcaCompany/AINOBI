// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** Fine-grained lifecycle states for a render task. */
export type RenderTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

/** Whether the task runs in one FC instance or fans out across chunk workers. */
export type RenderTaskMode = "single" | "distributed";

/** Sub-phase while a distributed task is `running`. */
export type RenderTaskDistributedPhase = "planning" | "chunking" | "assembling";

/** Terminal states from which a task can be retried. */
export const RETRYABLE_RENDER_TASK_STATUSES: readonly RenderTaskStatus[] = [
  "failed",
  "interrupted",
];

/**
 * Free-form sub-stage label while `status === "running"`. `"preparing"` and
 * `"uploading"` are this service's own synthetic phases (before/after the
 * actual Hyperframes render); everything in between is whatever Hyperframes'
 * own `RenderJob.currentStage` reports (e.g. "preprocessing", "rendering",
 * "encoding", "assembling") — that field is untyped free text upstream, so we
 * don't re-encode it as a strict union here and risk drifting out of sync.
 */
export type RenderTaskStage = string;

export interface RenderTaskRequestPayload {
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  uploadToOss?: boolean;
  /** User-visible export title (shown in UI; download filename is chosen client-side). */
  title?: string;
  /**
   * Optional webhook: POSTed with `{ task }` (same shape as the HTTP API's task JSON).
   * Fired on terminal `completed`/`failed`/`interrupted`, and also best-effort while
   * `status=running` as throttled progress updates (cross-instance deduped). Carries
   * `x-ainobi-internal-token` (`AINOBI_VIDEO_RENDER_INTERNAL_TOKEN`). Delivery isn't
   * guaranteed — callers should also reconcile lazily via list/poll.
   */
  callbackUrl?: string;
}

export interface RenderTaskOssObjectPayload {
  bucket: string;
  key: string;
  /**
   * Read URL, re-derived from `key` at response time (OCI presigned GET /
   * permanent aliyun URL). Never persisted — the DB keeps only bucket + key,
   * since presigned URLs expire.
   */
  url?: string;
  /** Bytes at upload time — used by courseware-agent for org storage accounting. */
  sizeBytes?: number;
  etag?: string;
}

export interface RenderTaskResultPayload {
  localPath: string;
  outputPath: string;
  render: {
    duration: number;
    /** Parent wall-clock ms (plan start → complete). Observability only after distributed. */
    takes: number;
    rtf: number;
    /**
     * Sum of per-instance wall clocks (plan + each chunk + assemble).
     * Used for credits billing so parallelization doesn't under-charge.
     * Single-instance renders set this equal to `takes`.
     */
    computeTakes?: number;
    computeBreakdown?: {
      planMs: number;
      chunkMs: number;
      assembleMs: number;
    };
  };
  oss?: RenderTaskOssObjectPayload;
  /** Preview JPEG captured at t=1s, stored alongside the MP4 in OSS. */
  cover?: RenderTaskOssObjectPayload;
}

/**
 * Persistent render task record — the source of truth for the task pool.
 * Execution is request-driven on the FC instance that handled create/retry;
 * this table is the durable history + status/progress surface the HTTP API reads from.
 */
@Entity({ name: "render_task" })
@Index("ix_render_task_courseware_created", ["coursewareId", "createdAt"])
@Index("ix_render_task_user_created", ["userId", "createdAt"])
@Index("ix_render_task_status", ["status"])
export class RenderTaskEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  /**
   * Courseware DB primary key (`courseware.id` in ainobi-courseware-agent), **not** the
   * business `courseware.key` / editor URL `courseware_id`. The agent proxy resolves
   * key-or-id from the client and always stores/filters by this canonical UUID.
   */
  @Column({ name: "courseware_id", type: "uuid", nullable: true })
  coursewareId: string | null;

  @Column({ type: "varchar", length: 20 })
  status: RenderTaskStatus;

  @Column({ type: "varchar", length: 64, nullable: true })
  stage: RenderTaskStage | null;

  @Column({ type: "smallint", default: 0 })
  progress: number;

  /** Populated while Hyperframes is in the `rendering` stage. */
  @Column({ name: "frames_rendered", type: "int", nullable: true })
  framesRendered: number | null;

  @Column({ name: "total_frames", type: "int", nullable: true })
  totalFrames: number | null;

  @Column({ name: "render_mode", type: "varchar", length: 20, default: "single" })
  renderMode: RenderTaskMode;

  /** OSS key prefix for the Hyperframes planDir (e.g. `renders/<taskId>/plan`). */
  @Column({ name: "plan_oss_prefix", type: "varchar", length: 512, nullable: true })
  planOssPrefix: string | null;

  @Column({ name: "plan_hash", type: "varchar", length: 128, nullable: true })
  planHash: string | null;

  @Column({ name: "chunk_count", type: "int", nullable: true })
  chunkCount: number | null;

  @Column({ name: "distributed_phase", type: "varchar", length: 32, nullable: true })
  distributedPhase: RenderTaskDistributedPhase | null;

  /**
   * Plan-instance wall-clock ms (plan + planDir OSS upload) for distributed billing.
   * Summed with chunk/assemble instance times into `result.render.computeTakes`.
   */
  @Column({ name: "plan_takes_ms", type: "int", nullable: true })
  planTakesMs: number | null;

  @Column({ type: "jsonb" })
  request: RenderTaskRequestPayload;

  @Column({ type: "jsonb", nullable: true })
  result: RenderTaskResultPayload | null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null;

  @Column({ name: "retry_count", type: "int", default: 0 })
  retryCount: number;

  @Column({ name: "queued_at", type: "timestamptz" })
  queuedAt: Date;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null;

  @Column({ name: "heartbeat_at", type: "timestamptz", nullable: true })
  heartbeatAt: Date | null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
