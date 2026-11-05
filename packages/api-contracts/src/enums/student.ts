// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Student domain enums.
 */

/** Student status (PG enum type: studentstatus) */
export const StudentStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type StudentStatus = (typeof StudentStatus)[keyof typeof StudentStatus];
