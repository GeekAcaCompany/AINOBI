// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from "typeorm";

/**
 * Per-org accounting ownership for TTS audio objects.
 *
 * TTS objects live under globally content-addressed keys (raw/mp3/{md5}.mp3),
 * so "object exists in OSS" says nothing about whether THIS organization was
 * ever charged for it. A row here marks exactly that; absence means the org
 * must be charged before the object may serve it.
 */
@Entity("courseware_tts_storage_refs")
@Unique("uq_courseware_tts_storage_refs_org_key", ["orgId", "objectKey"])
@Index("ix_courseware_tts_storage_refs_courseware", ["coursewareId"])
export class CoursewareTtsStorageRef {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "object_key", type: "varchar", length: 512 })
  objectKey: string;

  @Column({ name: "size_bytes", type: "bigint" })
  sizeBytes: number;

  /** Redundant courseware ownership: deleting the whole courseware refunds and deletes objects by it; NULL for preview syntheses. */
  @Column({ name: "courseware_id", type: "uuid", nullable: true })
  coursewareId: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt: Date;
}
