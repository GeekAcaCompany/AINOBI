// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Manager (academic affairs) domain schemas.
 *
 * ManagerInfo itself lives in schemas/user.ts (shared with the session codec).
 */

import { z } from "zod";
import { ManagerStatus } from "../enums/manager.ts";
import { PaginationRequestSchema } from "./user.ts";
import { UserInfoCreateSchema } from "./user.ts";
import { pyEnum, pyUuid } from "./helpers.ts";

/** Manager status enum values (pyEnum lax: accepts only the member's raw string) */
const MANAGER_STATUS_VALUES = Object.values(ManagerStatus) as readonly string[];

/** Manager list query (ManagerListRequest) */
export const ManagerListRequestSchema = PaginationRequestSchema.extend({
  manager_name: z.string().nullable().optional(),
  manager_status: pyEnum(MANAGER_STATUS_VALUES).nullable().optional(),
  manager_statuses: z.string().nullable().optional(),
});

export type ManagerListRequest = z.infer<typeof ManagerListRequestSchema>;

/** URL validation (urlparse semantics; the first failure is reported) */
function managerAvatarUrlViolation(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "manager_avatar_url must be a valid URL";
  }
  if (!parsed.protocol || !parsed.host) {
    return "manager_avatar_url must be a valid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "manager_avatar_url must use http or https protocol";
  }
  return null;
}

/** zod refine wrapper for manager_avatar_url (null/undefined pass) */
function managerAvatarUrlRefine() {
  return z
    .string()
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === null || value === undefined) {
        return;
      }
      const violation = managerAvatarUrlViolation(value);
      if (violation !== null) {
        ctx.addIssue({ code: "custom", message: violation });
      }
    });
}

/** Manager create request (ManagerCreateRequest) */
export const ManagerCreateRequestSchema = z.object({
  manager_name: z.string(),
  manager_name_kana: z.string().nullable().optional(),
  manager_status: pyEnum(MANAGER_STATUS_VALUES).default("pending"),
  manager_introduction: z.string().nullable().optional(),
  manager_avatar_url: managerAvatarUrlRefine(),
  sort: z.coerce.number().int().default(0),
  user_id: pyUuid.nullable().optional(),
  /** User info when creating a manager (used by the service layer when user_id is omitted) */
  user: UserInfoCreateSchema.nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type ManagerCreateRequest = z.infer<typeof ManagerCreateRequestSchema>;

/** Manager update request (ManagerUpdateRequest; None = unchanged) */
export const ManagerUpdateRequestSchema = z.object({
  manager_name: z.string().nullable().optional(),
  manager_name_kana: z.string().nullable().optional(),
  manager_status: pyEnum(MANAGER_STATUS_VALUES).nullable().optional(),
  manager_introduction: z.string().nullable().optional(),
  manager_avatar_url: managerAvatarUrlRefine(),
  sort: z.coerce.number().int().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export type ManagerUpdateRequest = z.infer<typeof ManagerUpdateRequestSchema>;
