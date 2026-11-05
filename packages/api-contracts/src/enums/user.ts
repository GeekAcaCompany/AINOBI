// SPDX-License-Identifier: AGPL-3.0-only
/**
 * User domain enums.
 *
 * Style convention (repo-wide): const object + union type, avoiding the friction between TS enums and
 * zod nativeEnum/jsonb round trips; member names match production for traceability.
 */

/** User status (PG enum type: userstatus) */
export const UserStatus = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
  Deleted: "deleted",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** Account nature: human (normal) vs automated agent */
export const UserType = {
  /** Human user (password / Google / email sign-up) */
  Normal: "normal",
  /** Non-human automated agent (no password/Google login; owner/org binding lives in the agent_credential table) */
  Agent: "agent",
} as const;
export type UserType = (typeof UserType)[keyof typeof UserType];

/** Account origin: self-registered personal account vs organization-provisioned enterprise account (activated by email link) */
export const AccountType = {
  /** Self-registered (invitation / verification code sign-up flow) */
  Normal: "normal",
  /** Provisioned by an enterprise organization; the personal workspace hangs under that organization, and AI spend in its context goes to that workspace first */
  Enterprise: "enterprise",
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

/** User gender */
export const UserGender = {
  Male: "male",
  Female: "female",
  Unknown: "unknown",
} as const;
export type UserGender = (typeof UserGender)[keyof typeof UserGender];

/** User role */
export const UserRole = {
  SuperAdmin: "super_admin",
  Admin: "admin",
  Manager: "manager",
  Teacher: "teacher",
  Student: "student",
  User: "user",
  Guest: "guest",
  /** Agent role: granted only to UserType.Agent accounts (fixed roles=["agent"]); permissions in core/roles/agent.ts */
  Agent: "agent",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Production role identifiers are immutable; the "manager" role's display name is now "assistant". Only for message/display text. */
export const ROLE_DISPLAY_NAMES: Record<string, string> = { manager: "assistant" };

export function roleDisplayName(role: string): string {
  return ROLE_DISPLAY_NAMES[role] ?? role;
}
