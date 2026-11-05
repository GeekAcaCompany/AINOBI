// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Archived oversized agent tool outputs for on-demand recall (`ainobi recall`).
 * Transcript / model context keeps a structured stub; full body lives here.
 */
@Entity({ name: "courseware_tool_result_blob" })
@Index("UQ_cw_tool_result_blob_tool_use", ["sessionId", "toolUseId"], { unique: true })
@Index("ix_cw_tool_result_blob_conversation", ["conversationId"])
@Index("ix_cw_tool_result_blob_session", ["sessionId"])
export class CoursewareToolResultBlob {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "conversation_id", type: "uuid", nullable: true })
  conversationId: string | null;

  @Column({ name: "session_id", type: "varchar", length: 64 })
  sessionId: string;

  @Column({ name: "tool_use_id", type: "varchar", length: 128 })
  toolUseId: string;

  @Column({ name: "tool_name", type: "varchar", length: 64 })
  toolName: string;

  @Column({ name: "command_summary", type: "varchar", length: 512, nullable: true })
  commandSummary: string | null;

  @Column({ name: "preview", type: "text" })
  preview: string;

  @Column({ type: "text" })
  content: string;

  @Column({ name: "byte_size", type: "int" })
  byteSize: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
