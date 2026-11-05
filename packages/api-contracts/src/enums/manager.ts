// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Manager (academic affairs) domain enums.
 */

/** Manager status (PG enum type: managerstatus) */
export const ManagerStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type ManagerStatus = (typeof ManagerStatus)[keyof typeof ManagerStatus];
