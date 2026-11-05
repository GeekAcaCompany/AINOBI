// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/** Courseware operation types (for audit tracing). */
export type CoursewareAuditAction =
  | "courseware.create"
  | "courseware.save"
  | "courseware.sharing"
  | "courseware.rollback"
  | "courseware.delete"
  | "courseware.unbind"
  | "asset.upload"
  | "asset.delete"
  | "asset.presign"
  | "cover.upload"
  | "chat.turn"
  | "conversation.clear";

/**
 * Courseware operation audit log: records who did what to which courseware/asset/conversation and when.
 * `account_name` comes from AINOBI check_session, so operations can trace it.
 */
@Entity({ name: "courseware_audit_log" })
@Index("ix_courseware_audit_log_org_id", ["orgId"])
@Index("ix_courseware_audit_log_courseware_id", ["coursewareId"])
@Index("ix_courseware_audit_log_user_id", ["userId"])
@Index("ix_courseware_audit_log_created_at", ["createdAt"])
export class CoursewareAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "courseware_id", type: "uuid", nullable: true })
  coursewareId: string | null;

  @Column({ name: "conversation_id", type: "uuid", nullable: true })
  conversationId: string | null;

  @Column({ name: "asset_file_id", type: "uuid", nullable: true })
  assetFileId: string | null;

  @Column({ type: "varchar", length: 64 })
  action: CoursewareAuditAction;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "account_name", type: "varchar", length: 256 })
  accountName: string;

  @Column({ type: "jsonb", nullable: true })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
