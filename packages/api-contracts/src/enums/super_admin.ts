// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Super admin domain enums.
 */

/** Super admin status (PG enum type: superadminstatus) */
export const SuperAdminStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type SuperAdminStatus = (typeof SuperAdminStatus)[keyof typeof SuperAdminStatus];
