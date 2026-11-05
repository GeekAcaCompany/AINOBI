// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Study companion persona domain enums.
 */

/** Study companion persona status (PG enum type: companionpersonastatus) */
export const CompanionPersonaStatus = {
  Active: "active",
  Deleted: "deleted",
} as const;
export type CompanionPersonaStatus =
  (typeof CompanionPersonaStatus)[keyof typeof CompanionPersonaStatus];
