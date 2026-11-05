// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform admin role enums.
 */

/**
 * Platform admin role (PG enum type: platformadminrole)
 *
 * Parallel to UserRole; used only inside the platform admin subsystem.
 */
export const PlatformAdminRole = {
  SuperPlatformAdmin: "super_platform_admin",
} as const;
export type PlatformAdminRole = (typeof PlatformAdminRole)[keyof typeof PlatformAdminRole];
