// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Organization domain enums.
 */

/** Organization status (PG enum type: organizationstatus) */
export const OrganizationStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type OrganizationStatus =
  (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

/** Organization type (PG enum type: organizationtype) */
export const OrganizationType = {
  /** Personal organization */
  Personal: "personal",
  /** Group organization */
  Group: "group",
  /** Enterprise organization */
  Enterprise: "enterprise",
} as const;
export type OrganizationType = (typeof OrganizationType)[keyof typeof OrganizationType];

/**
 * Organization default language, used to pick the email template language (matching the template file convention: no suffix = ja / -en / -zh).
 * Stored as a plain String(8) column (default_language), not a PG enum —
 * adding a language needs no migration.
 */
export const OrganizationLanguage = {
  Japanese: "ja",
  English: "en",
  Chinese: "zh",
} as const;
export type OrganizationLanguage =
  (typeof OrganizationLanguage)[keyof typeof OrganizationLanguage];
