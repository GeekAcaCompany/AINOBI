// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Student enrollment domain enums.
 */

/** Student enrollment status (PG enum type: studentcoursestatus) */
export const StudentCourseStatus = {
  /** In progress */
  Active: "active",
  /** Completed */
  Completed: "completed",
  /** Dropped */
  Dropped: "dropped",
} as const;
export type StudentCourseStatus =
  (typeof StudentCourseStatus)[keyof typeof StudentCourseStatus];
