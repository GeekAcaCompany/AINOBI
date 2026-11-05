// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

/**
 * Student answer recordings of quiz shadowing/speech questions, kept apart from the editor asset library `courseware_assets`.
 * OSS object key prefix: `quiz_answer_recordings/{org_id}/{recording_id}.{ext}`.
 */
@Entity({ name: "courseware_quiz_answer_recordings" })
@Index("ix_courseware_quiz_answer_recordings_courseware_id", ["coursewareId"])
@Index("ix_courseware_quiz_answer_recordings_user_id", ["userId"])
@Index("ix_courseware_quiz_answer_recordings_org_id", ["orgId"])
@Index("ix_courseware_quiz_answer_recordings_created_at", ["createdAt"])
@Index("ix_courseware_quiz_answer_recordings_courseware_user", ["coursewareId", "userId"])
export class CoursewareQuizAnswerRecording {
  @PrimaryColumn({ name: "recording_id", type: "uuid" })
  recordingId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "courseware_id", type: "uuid" })
  coursewareId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "scene_id", type: "varchar", length: 128, nullable: true })
  sceneId: string | null;

  @Column({ name: "question_wrapper_id", type: "varchar", length: 128, nullable: true })
  questionWrapperId: string | null;

  @Column({ name: "file_name", type: "varchar", length: 255 })
  fileName: string;

  @Column({ name: "file_size", type: "int" })
  fileSize: number;

  @Column({ name: "content_type", type: "varchar", length: 255 })
  contentType: string;

  @Column({ name: "content_md5", type: "char", length: 32 })
  contentMd5: string;

  @Column({ name: "file_path", type: "varchar", length: 512 })
  filePath: string;

  @Column({ name: "file_url", type: "varchar", length: 2048 })
  fileUrl: string;

  @Column({ name: "duration_sec", type: "double precision", nullable: true })
  durationSec: number | null;

  /** true once the recording's bytes were lock+confirmed into the organization storage — only rows counted
   * this way may return quota on delete (existing rows are false, so bytes never added are never debited). */
  @Column({ name: "storage_accounted", type: "boolean", default: false })
  storageAccounted: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt: Date;
}
