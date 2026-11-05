// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { Courseware } from "./courseware.ts";

/**
 * Metadata of one multi-turn "courseware agent" conversation: binds the business courseware, the editor's live preview session, and the Claude Agent SDK session_id (for resume).
 *
 * The full transcript (line entries equivalent to the SDK's local JSONL) is in {@link CoursewareSessionTranscriptLine},
 * written by {@link createPgSessionStore}, so stateless instances can restore the session.
 */
@Entity({ name: "courseware_conversation" })
@Index("ix_courseware_conversation_org_id", ["orgId"])
@Index("IDX_courseware_conversation_claude_session", ["claudeSessionId"])
@Index("UQ_courseware_conversation_claude_session", ["claudeSessionId"], {
  unique: true,
  where: '"claude_session_id" IS NOT NULL',
})
export class CoursewareConversation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @Column({ name: "courseware_id", type: "uuid", nullable: true })
  coursewareId: string | null;

  /** Conversation title: summarized from the user query by an LLM and shown directly in the frontend history list */
  @Column({ type: "varchar", length: 128, nullable: true })
  title: string | null;

  /**
   * Conversation kind: `agent` (default, an agent session that edits the courseware directly) or `plan` (a Plan mode courseware design session).
   * Separates the conversation list by kind: Plan sessions never appear in the agent history, and vice versa.
   */
  @Column({ type: "varchar", length: 16, default: "agent" })
  kind: string;

  @ManyToOne(() => Courseware, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "courseware_id", foreignKeyConstraintName: "FK_courseware_conversation_courseware" })
  courseware?: Courseware | null;

  /** session_id returned by the Claude Agent SDK; backfilled by the service after the first turn */
  @Column({ name: "claude_session_id", type: "varchar", length: 64, nullable: true })
  claudeSessionId: string | null;

  /** projectKey the SDK uses internally for the SessionStore (usually a stable derivation of cwd); for troubleshooting and reconciliation */
  @Column({ name: "session_project_key", type: "varchar", length: 512, nullable: true })
  sessionProjectKey: string | null;

  @Column({ name: "live_preview_session_id", type: "varchar", length: 256, nullable: true })
  livePreviewSessionId: string | null;

  /** Cumulative input tokens (sum over every agent turn in the conversation) */
  @Column({ name: "input_tokens", type: "bigint", default: 0 })
  inputTokens: string;

  /** Cumulative output tokens */
  @Column({ name: "output_tokens", type: "bigint", default: 0 })
  outputTokens: string;

  /** Cumulative total tokens (input + output + cache) */
  @Column({ name: "total_tokens", type: "bigint", default: 0 })
  totalTokens: string;

  /** Cumulative cache tokens (cache creation + cache read) */
  @Column({ name: "cache_tokens", type: "bigint", default: 0 })
  cacheTokens: string;

  /** Extension fields: e.g. lastResult, workspace path */
  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

/**
 * Mirrors the JSONL lines of the claude-agent-sdk SessionStore; the persisted form of chat history.
 * The SDK requires loading back into memory in insertion order, then materializing a temporary JSONL for the subprocess to resume.
 */
@Entity({ name: "courseware_session_transcript_line" })
@Index("IDX_cw_transcript_lookup", ["projectKey", "sessionId", "subpath"])
@Index("IDX_cw_transcript_user_chat", ["projectKey", "sessionId", "subpath", "exposeInUserChat"])
@Index("UQ_cw_session_transcript_line_entry_uuid", ["projectKey", "sessionId", "subpath", "entryUuid"], {
  unique: true,
  where: '"entry_uuid" IS NOT NULL',
})
export class CoursewareSessionTranscriptLine {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id: string;

  @Column({ name: "project_key", type: "varchar", length: 512 })
  projectKey: string;

  @Column({ name: "session_id", type: "varchar", length: 64 })
  sessionId: string;

  /** The main transcript stores an empty string; subagents use the SDK's subpath */
  @Column({ type: "varchar", length: 512, default: "" })
  subpath: string;

  @Column({ type: "jsonb" })
  entry: Record<string, unknown>;

  @Column({ name: "entry_uuid", type: "varchar", length: 64, nullable: true })
  entryUuid: string | null;

  /**
   * Whether it can be shown in the courseware editor sidebar as a "user message".
   * The SDK transcript's `entry` stays complete for resume; this column is written on mirror append.
   * false for editor context, Live Preview blocks, interrupted-turn resume instructions (`CHAT_TURN_RESUME_TRANSCRIPT_HEADER`) etc.
   */
  @Column({ name: "expose_in_user_chat", type: "boolean", default: true })
  exposeInUserChat: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
