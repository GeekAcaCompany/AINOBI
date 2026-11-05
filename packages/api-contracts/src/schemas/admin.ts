// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Organization admin domain schemas.
 *
 * AdminInfo itself lives in schemas/user.ts (shared with the session codec).
 */

import { z } from "zod";
import { AdminStatus } from "../enums/admin.ts";
import { PaginationRequestSchema } from "./user.ts";
import { UserInfoCreateSchema } from "./user.ts";
import { EnterpriseProvisionRequestSchema } from "./enterprise_member.ts";
import { pyEnum, pyUuid } from "./helpers.ts";

/** Admin status enum values (pyEnum lax: accepts only the member's raw string) */
const ADMIN_STATUS_VALUES = Object.values(AdminStatus) as readonly string[];

/** Admin list query (AdminListRequest) */
export const AdminListRequestSchema = PaginationRequestSchema.extend({
  admin_name: z.string().nullable().optional(),
  admin_status: pyEnum(ADMIN_STATUS_VALUES).nullable().optional(),
  admin_statuses: z.string().nullable().optional(),
});

export type AdminListRequest = z.infer<typeof AdminListRequestSchema>;

/** URL validation (urlparse semantics; the first failure is reported) */
function adminAvatarUrlViolation(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "admin_avatar_url must be a valid URL";
  }
  if (!parsed.protocol || !parsed.host) {
    return "admin_avatar_url must be a valid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "admin_avatar_url must use http or https protocol";
  }
  return null;
}

/** zod refine wrapper for admin_avatar_url (null/undefined pass) */
function adminAvatarUrlRefine() {
  return z
    .string()
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === null || value === undefined) {
        return;
      }
      const violation = adminAvatarUrlViolation(value);
      if (violation !== null) {
        ctx.addIssue({ code: "custom", message: violation });
      }
    });
}

/** Admin create request (AdminCreateRequest) */
export const AdminCreateRequestSchema = z.object({
  admin_name: z.string(),
  admin_name_kana: z.string().nullable().optional(),
  admin_status: pyEnum(ADMIN_STATUS_VALUES).default("pending"),
  admin_introduction: z.string().nullable().optional(),
  admin_avatar_url: adminAvatarUrlRefine(),
  sort: z.coerce.number().int().default(0),
  user_id: pyUuid.nullable().optional(),
  /** User info used when user_id is omitted */
  user: UserInfoCreateSchema.nullable().optional(),
  /** Enterprise provisioning block: when present, switches to the enterprise member provisioning flow */
  enterprise: EnterpriseProvisionRequestSchema.nullable().optional(),
  /**
   * Role row the enterprise provisioning branch writes (admin = administrator / manager = assistant).
   * Non-enterprise invitations pick the role through the invite code; the default matches the historical hard-coded row.
   */
  role: z.enum(["admin", "manager"]).default("admin"),
  remark: z.string().nullable().optional(),
});

export type AdminCreateRequest = z.infer<typeof AdminCreateRequestSchema>;

/** Admin update request (AdminUpdateRequest; None = unchanged) */
export const AdminUpdateRequestSchema = z.object({
  admin_name: z.string().nullable().optional(),
  admin_name_kana: z.string().nullable().optional(),
  admin_status: pyEnum(ADMIN_STATUS_VALUES).nullable().optional(),
  admin_introduction: z.string().nullable().optional(),
  admin_avatar_url: adminAvatarUrlRefine(),
  sort: z.coerce.number().int().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type AdminUpdateRequest = z.infer<typeof AdminUpdateRequestSchema>;
