// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teacher domain enums.
 */

/** Teacher status (PG enum type: teacherstatus) */
export const TeacherStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type TeacherStatus = (typeof TeacherStatus)[keyof typeof TeacherStatus];
