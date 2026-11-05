// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Courseware main table: stores the currently effective courseware JSON (same structure as the ainobi scene, stored as jsonb).
 */
@Entity({ name: "courseware" })
@Index("UQ_courseware_key", ["key"], { unique: true })
@Index("ix_courseware_org_id", ["orgId"])
export class Courseware {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @Column({ type: "varchar", length: 256 })
  key: string;

  @Column({ type: "varchar", length: 512, nullable: true })
  title: string | null;

  @Column({ name: "cover_url", type: "varchar", length: 2048, nullable: true })
  coverUrl: string | null;

  /** Byte size of the cover object (basis for the organization storage debit); null = the cover was never counted against the quota. */
  @Column({ name: "cover_file_size", type: "bigint", nullable: true })
  coverFileSize: number | null;

  /** When true, the courseware is anonymously readable and writable (including assets, versions, conversations, etc.). */
  @Column({ name: "is_public", type: "boolean", default: false })
  isPublic: boolean;

  /** When true, the courseware detail is anonymously readable (GET /courseware); is_public implies readable. */
  @Column({ name: "is_share", type: "boolean", default: false })
  isShare: boolean;

  /** Soft-delete flag: set and unbound along with its course when that course is deleted; filtered out of the AI content list. */
  @Column({ name: "is_deleted", type: "boolean", default: false })
  isDeleted: boolean;

  @Column({ type: "jsonb" })
  content: Record<string, unknown>;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @OneToMany(() => CoursewareVersion, (v) => v.courseware)
  versions?: CoursewareVersion[];
}

/** Courseware version snapshots; each save appends one, and the service layer trims them to the latest N. */
@Entity({ name: "courseware_version" })
@Index("IDX_courseware_version_courseware_created", ["coursewareId", "createdAt"])
@Index("UQ_courseware_version_revision", ["coursewareId", "revision"], { unique: true })
export class CoursewareVersion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "courseware_id", type: "uuid" })
  coursewareId: string;

  @ManyToOne(() => Courseware, (c) => c.versions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "courseware_id", foreignKeyConstraintName: "FK_courseware_version_courseware" })
  courseware: Courseware;

  /** Monotonically increasing version number within one courseware, for display and rollback parameters */
  @Column({ type: "int" })
  revision: number;

  @Column({ type: "jsonb" })
  content: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
