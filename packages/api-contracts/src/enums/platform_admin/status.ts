// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform admin status enums.
 */

/** Platform admin status (PG enum type: platformadminstatus) */
export const PlatformAdminStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type PlatformAdminStatus =
  (typeof PlatformAdminStatus)[keyof typeof PlatformAdminStatus];
