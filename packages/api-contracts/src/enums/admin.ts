// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Admin domain enums.
 */

/** Admin status (PG enum type: adminstatus) */
export const AdminStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type AdminStatus = (typeof AdminStatus)[keyof typeof AdminStatus];
