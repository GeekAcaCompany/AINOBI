// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { Courseware } from "./courseware.ts";

/**
 * Many-to-many binding between coursewares and course sections: one courseware may link several section_ids,
 * and one section may bind several coursewares; `is_current` marks the courseware the section currently teaches (at most one per section).
 */
@Entity({ name: "courseware_section_binding" })
@Index("UQ_courseware_section_binding_pair", ["coursewareId", "sectionId"], { unique: true })
@Index("ix_courseware_section_binding_section_id", ["sectionId"])
@Index("ix_courseware_section_binding_course_id", ["courseId"])
@Index("ix_courseware_section_binding_org_id", ["orgId"])
@Index("UQ_courseware_section_binding_current", ["sectionId"], {
  unique: true,
  where: '"is_current" = true',
})
export class CoursewareSectionBinding {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "courseware_id", type: "uuid" })
  coursewareId: string;

  @ManyToOne(() => Courseware, { onDelete: "CASCADE" })
  @JoinColumn({ name: "courseware_id", foreignKeyConstraintName: "FK_courseware_section_binding_courseware" })
  courseware: Courseware;

  @Column({ name: "section_id", type: "uuid" })
  sectionId: string;

  @Column({ name: "course_id", type: "uuid" })
  courseId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  /** Reserved chapter ID, empty by default. */
  @Column({ name: "chapter_id", type: "uuid", nullable: true })
  chapterId: string | null;

  /** Whether this is the courseware the section currently teaches. */
  @Column({ name: "is_current", type: "boolean", default: false })
  isCurrent: boolean;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
