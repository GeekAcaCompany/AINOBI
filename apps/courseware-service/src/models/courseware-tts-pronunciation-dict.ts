// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

export type CoursewareTtsPronunciationDictLanguage = "ja" | "zh";

/** Organization-level TTS pronunciation dictionary entry (Japanese kana / Chinese pinyin). */
@Entity({ name: "courseware_tts_pronunciation_dict" })
@Unique("uq_courseware_tts_pronunciation_dict_org_source", ["orgId", "sourceText"])
@Index("ix_courseware_tts_pronunciation_dict_org_id", ["orgId"])
@Index("ix_courseware_tts_pronunciation_dict_org_enabled", ["orgId", "enabled"])
@Index("ix_courseware_tts_pronunciation_dict_updated_at", ["updatedAt"])
export class CoursewareTtsPronunciationDict {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  /** Source text to match (a word or short phrase) */
  @Column({ name: "source_text", type: "varchar", length: 256 })
  sourceText: string;

  @Column({ type: "varchar", length: 8 })
  language: CoursewareTtsPronunciationDictLanguage;

  /** Japanese kana / pinyin with tone digits */
  @Column({ type: "varchar", length: 512 })
  pronunciation: string;

  @Column({ type: "boolean", default: true })
  enabled: boolean;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
