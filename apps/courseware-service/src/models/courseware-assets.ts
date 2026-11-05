// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/** JSON metadata stored after pdf2html / pptx2html conversion (`file_artifact_metadata`). */
export interface CoursewareAssetFileArtifactMetadata {
  slide_count: number;
  kind: "pdf" | "pptx";
  /** Raw JSON of the conversion service (fields may vary by service version). */
  conversion: Record<string, unknown>;
}

/**
 * Courseware asset upload record (matching the OSS path and the accessible URL).
 * `file_id` is a random RFC 4122 UUID (v4); `content_md5` is the content MD5 (32 hex characters, used for OSS dedupe and the object key).
 */
@Entity({ name: "courseware_assets" })
@Index("ix_courseware_assets_courseware_id", ["coursewareId"])
@Index("ix_courseware_assets_content_md5", ["contentMd5"])
@Index("ix_courseware_assets_courseware_content_md5", ["coursewareId", "contentMd5"], { unique: true })
@Index("ix_courseware_assets_created_at", ["createdAt"])
@Index("ix_courseware_assets_created_by", ["createdBy"])
@Index("ix_courseware_assets_updated_at", ["updatedAt"])
@Index("ix_courseware_assets_updated_by", ["updatedBy"])
@Index("ix_courseware_assets_org_id", ["orgId"])
export class CoursewareAsset {
  @PrimaryColumn({ name: "file_id", type: "uuid" })
  fileId: string;

  @Column({ name: "content_md5", type: "char", length: 32 })
  contentMd5: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @Column({ name: "courseware_id", type: "uuid" })
  coursewareId: string;

  @Column({ name: "file_name", type: "varchar", length: 255 })
  fileName: string;

  @Column({ name: "file_size", type: "int" })
  fileSize: number;

  @Column({ name: "content_type", type: "varchar", length: 255 })
  contentType: string;

  @Column({ name: "markdown_content", type: "text", nullable: true })
  markdownContent: string | null;

  @Column({ name: "file_path", type: "varchar", length: 512 })
  filePath: string;

  @Column({ name: "file_url", type: "varchar", length: 2048 })
  fileUrl: string;

  /** Public access URL of the pdf2html / pptx2html artifact on OSS; null for non-PDF/PPTX. */
  @Column({ name: "file_artifact_url", type: "varchar", length: 2048, nullable: true })
  fileArtifactUrl: string | null;

  /** PDF/PPTX conversion result JSON (with `slide_count` etc.); null for non-document assets. */
  @Column({ name: "file_artifact_metadata", type: "jsonb", nullable: true })
  fileArtifactMetadata: CoursewareAssetFileArtifactMetadata | null;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt: Date;
}
