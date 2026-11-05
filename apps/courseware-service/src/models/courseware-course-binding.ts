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
 * Many-to-many binding between coursewares and platform courses: one courseware may link several course_ids.
 */
@Entity({ name: "courseware_course_binding" })
@Index("UQ_courseware_course_binding_pair", ["coursewareId", "courseId"], { unique: true })
@Index("ix_courseware_course_binding_course_id", ["courseId"])
@Index("ix_courseware_course_binding_org_id", ["orgId"])
export class CoursewareCourseBinding {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "courseware_id", type: "uuid" })
  coursewareId: string;

  @ManyToOne(() => Courseware, { onDelete: "CASCADE" })
  @JoinColumn({ name: "courseware_id", foreignKeyConstraintName: "FK_courseware_course_binding_courseware" })
  courseware: Courseware;

  @Column({ name: "course_id", type: "uuid" })
  courseId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
