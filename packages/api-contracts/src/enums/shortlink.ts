// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Short link domain enums.
 */

/** Short link status (PG enum type: shortlinkstatus) */
export const ShortLinkStatus = {
  Active: "active",
  Inactive: "inactive",
  Deleted: "deleted",
} as const;
export type ShortLinkStatus = (typeof ShortLinkStatus)[keyof typeof ShortLinkStatus];
