// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type RenderTaskChunkStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

@Entity({ name: "render_task_chunk" })
@Index("ix_render_task_chunk_task_status", ["taskId", "status"])
@Index("ix_render_task_chunk_affinity", ["affinityId"])
export class RenderTaskChunkEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "chunk_index", type: "int" })
  chunkIndex: number;

  @Column({ name: "start_frame", type: "int" })
  startFrame: number;

  @Column({ name: "end_frame", type: "int" })
  endFrame: number;

  @Column({ type: "varchar", length: 20 })
  status: RenderTaskChunkStatus;

  /** FC HeaderField affinity id — unique per chunk so each lands on its own instance. */
  @Column({ name: "affinity_id", type: "uuid" })
  affinityId: string;

  @Column({ name: "oss_key", type: "varchar", length: 512, nullable: true })
  ossKey: string | null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null;

  @Column({ name: "frames_encoded", type: "int", nullable: true })
  framesEncoded: number | null;

  /**
   * Wall-clock ms spent on this chunk instance (download + renderChunk + upload).
   * Summed with plan/assemble instance times for billing (`result.render.computeTakes`).
   */
  @Column({ name: "duration_ms", type: "int", nullable: true })
  durationMs: number | null;

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
