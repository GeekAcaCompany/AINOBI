// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

/**
 * Archive table of deleted coursewares: a full snapshot is written before the hard delete from `courseware`, for recovery and tracing.
 * The primary key keeps the original courseware `id`, matching `courseware_id` in the audit log.
 */
@Entity({ name: "courseware_deleted" })
@Index("ix_courseware_deleted_org_id", ["orgId"])
@Index("ix_courseware_deleted_key", ["key"])
@Index("ix_courseware_deleted_deleted_at", ["deletedAt"])
export class CoursewareDeleted {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @Column({ type: "varchar", length: 256 })
  key: string;

  @Column({ type: "varchar", length: 512, nullable: true })
  title: string | null;

  @Column({ name: "cover_url", type: "varchar", length: 2048, nullable: true })
  coverUrl: string | null;

  @Column({ type: "jsonb" })
  content: Record<string, unknown>;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy: string | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @Column({ name: "deleted_by", type: "uuid", nullable: true })
  deletedBy: string | null;

  @CreateDateColumn({ name: "deleted_at", type: "timestamptz" })
  deletedAt: Date;
}
