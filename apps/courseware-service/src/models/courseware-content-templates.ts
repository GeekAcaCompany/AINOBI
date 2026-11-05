// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type CoursewareContentTemplateSourceType =
  | "courseware"
  | "asset"
  | "manual"
  | "extracted";

/** Organization-level courseware content template (Markdown content/outline rules, not stored in OSS). */
@Entity({ name: "courseware_content_templates" })
@Index("ix_courseware_content_templates_org_id", ["orgId"])
@Index("ix_courseware_content_templates_org_name", ["orgId", "name"])
@Index("ix_courseware_content_templates_updated_at", ["updatedAt"])
export class CoursewareContentTemplate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 128 })
  name: string;

  @Column({ type: "varchar", length: 512, nullable: true })
  description: string | null;

  @Column({ type: "text" })
  content: string;

  @Column({ name: "source_type", type: "varchar", length: 32, default: "manual" })
  sourceType: CoursewareContentTemplateSourceType;

  @Column({ name: "source_meta", type: "jsonb", nullable: true })
  sourceMeta: Record<string, unknown> | null;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
