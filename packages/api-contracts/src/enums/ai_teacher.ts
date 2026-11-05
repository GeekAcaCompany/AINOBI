// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI teacher domain enums.
 */

/** AI teacher status (PG enum type: aiteacherstatus) */
export const AITeacherStatus = {
  Active: "active",
  Inactive: "inactive",
  Deleted: "deleted",
} as const;
export type AITeacherStatus = (typeof AITeacherStatus)[keyof typeof AITeacherStatus];
