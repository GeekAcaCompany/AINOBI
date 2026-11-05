// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { Courseware } from "./courseware.ts";

export type CoursewareQuizAttemptStatus = "active" | "completed";
export type CoursewareQuizSubmissionStatus = "pending" | "scored" | "failed";
export type CoursewareQuizProjectionStatus = "pending" | "projected" | "failed" | "skipped";

@Entity({ name: "courseware_quiz_attempt_session" })
@Index("ix_courseware_quiz_attempt_courseware_user", ["coursewareId", "userId"])
@Index("ix_courseware_quiz_attempt_section_user", ["sectionId", "userId"])
@Index("ix_courseware_quiz_attempt_org_id", ["orgId"])
@Index("ix_courseware_quiz_attempt_created_at", ["createdAt"])
export class CoursewareQuizAttemptSession {
  @PrimaryColumn({ name: "attempt_session_id", type: "uuid" })
  attemptSessionId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "courseware_id", type: "uuid" })
  coursewareId: string;

  @ManyToOne(() => Courseware, { onDelete: "CASCADE" })
  @JoinColumn({ name: "courseware_id", foreignKeyConstraintName: "FK_courseware_quiz_attempt_courseware" })
  courseware: Courseware;

  @Column({ name: "courseware_revision", type: "int", nullable: true })
  coursewareRevision: number | null;

  @Column({ name: "courseware_snapshot", type: "jsonb" })
  coursewareSnapshot: Record<string, unknown>;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "course_id", type: "uuid", nullable: true })
  courseId: string | null;

  @Column({ name: "section_id", type: "uuid", nullable: true })
  sectionId: string | null;

  @Column({ name: "scene_id", type: "varchar", length: 128, nullable: true })
  sceneId: string | null;

  @Column({ type: "varchar", length: 32, default: "active" })
  status: CoursewareQuizAttemptStatus;

  @Column({ name: "total_score", type: "double precision", default: 0 })
  totalScore: number;

  @Column({ name: "max_score", type: "double precision", default: 0 })
  maxScore: number;

  @Column({ name: "answered_count", type: "int", default: 0 })
  answeredCount: number;

  @Column({ name: "total_count", type: "int", default: 0 })
  totalCount: number;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null;

  @Column({ name: "progress_projection_status", type: "varchar", length: 32, default: "pending" })
  progressProjectionStatus: CoursewareQuizProjectionStatus;

  @Column({ name: "progress_projection_error", type: "text", nullable: true })
  progressProjectionError: string | null;

  @Column({ name: "progress_projected_at", type: "timestamptz", nullable: true })
  progressProjectedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt: Date;
}

@Entity({ name: "courseware_quiz_submission" })
@Index("UQ_courseware_quiz_submission_attempt_idempotency", ["attemptSessionId", "submissionId"], {
  unique: true,
})
@Index("UQ_courseware_quiz_submission_one_active_per_question", ["attemptSessionId", "questionWrapperId"], {
  unique: true,
  where: `"is_active" = true`,
})
@Index("ix_courseware_quiz_submission_attempt_question", ["attemptSessionId", "questionWrapperId"])
@Index("ix_courseware_quiz_submission_recording_id", ["recordingId"])
@Index("ix_courseware_quiz_submission_created_at", ["createdAt"])
export class CoursewareQuizSubmission {
  @PrimaryColumn({ name: "submission_id", type: "uuid" })
  submissionId: string;

  @Column({ name: "attempt_session_id", type: "uuid" })
  attemptSessionId: string;

  @ManyToOne(() => CoursewareQuizAttemptSession, { onDelete: "CASCADE" })
  @JoinColumn({
    name: "attempt_session_id",
    foreignKeyConstraintName: "FK_courseware_quiz_submission_attempt",
  })
  attemptSession: CoursewareQuizAttemptSession;

  @Column({ name: "question_id", type: "varchar", length: 128 })
  questionId: string;

  @Column({ name: "question_wrapper_id", type: "varchar", length: 128 })
  questionWrapperId: string;

  @Column({ name: "slide_element_id", type: "varchar", length: 128, nullable: true })
  slideElementId: string | null;

  @Column({ name: "question_type", type: "varchar", length: 64 })
  questionType: string;

  @Column({ name: "question_title", type: "varchar", length: 512, nullable: true })
  questionTitle: string | null;

  @Column({ type: "jsonb" })
  answer: Record<string, unknown>;

  @Column({ type: "double precision" })
  score: number;

  @Column({ name: "max_score", type: "double precision" })
  maxScore: number;

  @Column({ name: "raw_score", type: "double precision" })
  rawScore: number;

  @Column({ type: "boolean" })
  passed: boolean;

  @Column({ name: "can_advance", type: "boolean" })
  canAdvance: boolean;

  @Column({ type: "text" })
  feedback: string;

  @Column({ name: "feedback_detail", type: "jsonb", nullable: true })
  feedbackDetail: Record<string, unknown> | null;

  @Column({ name: "recording_id", type: "uuid", nullable: true })
  recordingId: string | null;

  @Column({ name: "billing_transaction_id", type: "varchar", length: 128, nullable: true })
  billingTransactionId: string | null;

  @Column({ name: "projection_status", type: "varchar", length: 32, default: "pending" })
  projectionStatus: CoursewareQuizProjectionStatus;

  @Column({ name: "projection_error", type: "text", nullable: true })
  projectionError: string | null;

  @Column({ name: "projected_at", type: "timestamptz", nullable: true })
  projectedAt: Date | null;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ type: "varchar", length: 32, default: "scored" })
  status: CoursewareQuizSubmissionStatus;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt: Date;
}
