// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Organization domain schemas.
 *
 * OrganizationInfo (embedded in the session) lives in schemas/user.ts.
 *
 * Decimal request fields (lax Decimal: int/float/string all accepted) are all normalized to strings
 * by pyDecimal() (math happens later in decimal.js, never Number()).
 */

import { Decimal } from "decimal.js";
import { z } from "zod";
import { OrganizationStatus } from "../enums/organization.ts";
import { UserRole } from "../enums/user.ts";
import { pyBool, pyUuid } from "./helpers.ts";
import { PaginationRequestSchema } from "./user.ts";
import { UserFileListRequestSchema } from "./user_file.ts";

/** Organization list query (OrganizationListRequest) */
export const OrganizationListRequestSchema = PaginationRequestSchema.extend({
  /** Organization status (single value) */
  org_status: z.nativeEnum(OrganizationStatus).optional(),
  /** Organization statuses (comma-separated; invalid values silently dropped) */
  org_statuses: z.string().optional(),
  /** Organization name (case-insensitive fuzzy match) */
  org_name: z.string().optional(),
  /** Organization name kana (fuzzy) */
  org_name_kana: z.string().optional(),
  /** Organization number (fuzzy) */
  org_no: z.string().optional(),
  /** Remark (fuzzy) */
  remark: z.string().optional(),
});

export type OrganizationListRequest = z.infer<typeof OrganizationListRequestSchema>;

/**
 * Lax Decimal semantics: accepts a JSON number or numeric string,
 * always outputs a normalized decimal.js string ("1.5", "0", etc.).
 * gt: greater-than constraint (amount > 0); add le/ge as needed.
 *
 * Missing (undefined) → "Field required" (a zod union would report undefined as
 * "Invalid input", which differs from production's missing-field text — required Decimal fields need diagnostics with a location).
 */
export function pyDecimal(options?: { gt?: number; message?: string }) {
  return z
    .any()
    .superRefine((value, ctx): void => {
      if (value === undefined) {
        ctx.addIssue({ code: "custom", path: [], message: "Field required" });
        return;
      }
      if (typeof value !== "string" && typeof value !== "number") {
        ctx.addIssue({
          code: "custom",
          path: [],
          message: "Input should be a valid decimal, unable to parse string as decimal",
        });
        return;
      }
    })
    .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value as string | number);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Input should be a valid decimal, unable to parse string as decimal",
      });
      return z.NEVER;
    }
    if (options?.gt !== undefined && parsed.lessThanOrEqualTo(options.gt)) {
      ctx.addIssue({
        code: "custom",
        message: options.message ?? `Input should be greater than ${options.gt}`,
      });
      return z.NEVER;
    }
    return parsed.toString();
  });
}

/** URL validation (scheme + netloc both required, and http/https) */
function httpUrlValidator(value: string | undefined | null, ctx: z.RefinementCtx): void {
  if (value === undefined || value === null) {
    return;
  }
  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.host) {
      ctx.addIssue({ code: "custom", message: "org_avatar_url must be a valid URL" });
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      ctx.addIssue({
        code: "custom",
        message: "org_avatar_url must use http or https protocol",
      });
    }
  } catch {
    ctx.addIssue({ code: "custom", message: "org_avatar_url must be a valid URL" });
  }
}

/** Organization register request (extra=forbid — refuses unknown fields such as a stale parent_org_id) */
export const OrganizationRegisterRequestSchema = z
  .strictObject({
    org_no: z.string().nullable().optional(),
    org_name: z.string(),
    org_name_kana: z.string().nullable().optional(),
    org_introduction: z.string().nullable().optional(),
    org_avatar_url: z
      .string()
      .nullable()
      .optional()
      .superRefine(httpUrlValidator),
  });

export type OrganizationRegisterRequest = z.infer<typeof OrganizationRegisterRequestSchema>;

/** Child organization create request (the register shape + an optional owner) */
export const OrganizationChildCreateRequestSchema =
  OrganizationRegisterRequestSchema.extend({
    leader_user_id: pyUuid.nullable().optional(),
  });

export type OrganizationChildCreateRequest = z.infer<
  typeof OrganizationChildCreateRequestSchema
>;

/** Organization update request (None = unchanged; empty string = clear an optional field; extra=forbid prevents smuggling) */
export const OrganizationUpdateRequestSchema = z
  .strictObject({
    org_name: z.string().max(255).nullable().optional()
      .superRefine((value, ctx) => {
        // Blank names are refused (None still means "unchanged")
        if (value !== null && value !== undefined && !value.trim()) {
          ctx.addIssue({ code: "custom", message: "org_name must not be blank" });
        }
      }),
    org_name_kana: z.string().max(255).nullable().optional(),
    org_introduction: z.string().max(2000).nullable().optional(),
    // Object key or URL, normalized by the server — deliberately no http(s) check
    org_avatar_url: z.string().nullable().optional(),
    default_language: z.string().nullable().optional()
      .superRefine((value, ctx) => {
        if (value !== null && value !== undefined && !["ja", "en", "zh"].includes(value)) {
          ctx.addIssue({
            code: "custom",
            message: "default_language must be one of: ja, en, zh",
          });
        }
      }),
  });

export type OrganizationUpdateRequest = z.infer<typeof OrganizationUpdateRequestSchema>;

/** Invite a user into the organization */
export const OrganizationInviteUserRequestSchema = z.object({
  user_id: pyUuid,
  role: z.nativeEnum(UserRole),
  role_id: pyUuid.nullable().optional(),
});

export type OrganizationInviteUserRequest = z.infer<typeof OrganizationInviteUserRequestSchema>;

/** Generate an invite code */
export const OrganizationGenerateInviteCodeRequestSchema = z.object({
  role: z.nativeEnum(UserRole),
  role_id: pyUuid.nullable().optional(),
  redirect_url: z.string().nullable().optional(),
  ttl_seconds: z.coerce.number().int().min(60).max(2592000).nullable().optional(),
});

export type OrganizationGenerateInviteCodeRequest = z.infer<
  typeof OrganizationGenerateInviteCodeRequestSchema
>;

/** Join an organization with an invite code */
export const OrganizationJoinRequestSchema = z.object({
  role: z.nativeEnum(UserRole),
  role_id: pyUuid.nullable().optional(),
  code: z.string(),
});

export type OrganizationJoinRequest = z.infer<typeof OrganizationJoinRequestSchema>;

/** Organization member list query */
export const OrganizationUserListRequestSchema = PaginationRequestSchema.extend({
  role: z.nativeEnum(UserRole).optional(),
  roles: z.string().optional(),
  user_id: pyUuid.optional(),
  account_name: z.string().optional(),
  user_name: z.string().optional(),
  email: z.string().optional(),
  search_keyword: z.string().optional(),
  remark: z.string().optional(),
});

export type OrganizationUserListRequest = z.infer<typeof OrganizationUserListRequestSchema>;

/** Leave an organization */
export const OrganizationLeaveRequestSchema = z.object({
  role: z.nativeEnum(UserRole).nullable().optional(),
  role_id: pyUuid.nullable().optional(),
  delete_role: pyBool().optional().default(true),
});

export type OrganizationLeaveRequest = z.infer<typeof OrganizationLeaveRequestSchema>;

/** Child organization list (paginated, no extra filters) */
export const OrganizationChildrenListRequestSchema = PaginationRequestSchema;

export type OrganizationChildrenListRequest = z.infer<typeof OrganizationChildrenListRequestSchema>;

/** Allocate credits to a child organization */
export const OrganizationAllocateCreditsRequestSchema = z.object({
  child_org_id: pyUuid,
  adjustment: pyDecimal(),
  source_pool: z.enum(["topup", "voucher"]),
});

export type OrganizationAllocateCreditsRequest = z.infer<
  typeof OrganizationAllocateCreditsRequestSchema
>;

/** Recurring allocation upsert (amount > 0) */
export const OrganizationRecurringAllocationUpsertRequestSchema = z.object({
  amount: pyDecimal({ gt: 0, message: "Input should be greater than 0" }),
});

export type OrganizationRecurringAllocationUpsertRequest = z.infer<
  typeof OrganizationRecurringAllocationUpsertRequestSchema
>;

/** Change a child organization's super admin */
export const OrganizationReplaceSubOrgSuperAdminRequestSchema = z.object({
  user_id: pyUuid,
});

export type OrganizationReplaceSubOrgSuperAdminRequest = z.infer<
  typeof OrganizationReplaceSubOrgSuperAdminRequestSchema
>;

// ---------------------------------------------------------------------------
// Storage capacity
// ---------------------------------------------------------------------------

export const OrganizationStorageLockRequestSchema = z.object({
  size_bytes: z.coerce.number().int().min(1),
  remark: z.string().max(300).nullable().optional(),
});

export type OrganizationStorageLockRequest = z.infer<typeof OrganizationStorageLockRequestSchema>;

export const OrganizationStorageDecrementRequestSchema = z.object({
  size_bytes: z.coerce.number().int().min(1),
});

export type OrganizationStorageDecrementRequest = z.infer<
  typeof OrganizationStorageDecrementRequestSchema
>;

export const OrganizationStorageConfirmRequestSchema = z.object({
  actual_size_bytes: z.coerce.number().int().min(1).nullable().optional(),
});

export type OrganizationStorageConfirmRequest = z.infer<
  typeof OrganizationStorageConfirmRequestSchema
>;

/** Storage capacity snapshot (response DTO) */
export interface OrganizationStorageInfo {
  org_id: string;
  quota_bytes: number;
  used_bytes: number;
  own_used_bytes: number;
  locked_bytes: number;
  available_bytes: number;
  unlimited: boolean;
}

export interface OrganizationStorageLockInfo {
  lock_id: string;
  org_id: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
  ttl_seconds: number;
}

export interface OrganizationStorageConfirmResult {
  lock_id: string;
  org_id: string;
  committed_bytes: number;
  released_bytes: number;
  storage: OrganizationStorageInfo;
}

export interface OrganizationStorageDecrementResult {
  org_id: string;
  decremented_bytes: number;
  storage: OrganizationStorageInfo;
}

export interface OrganizationStorageReleaseResult {
  lock_id: string;
  org_id: string;
  released_bytes: number;
  storage: OrganizationStorageInfo;
}

// ---------------------------------------------------------------------------
// Enterprise member quota (MemberQuotaAdjustRequest)
// ---------------------------------------------------------------------------

export const MemberQuotaAdjustRequestSchema = z
  .object({
    recurring_amount: pyDecimal({ gt: 0, message: "Input should be greater than 0" })
      .nullable()
      .optional(),
    recurring_enabled: pyBool().nullable().optional(),
    onetime_adjustment: pyDecimal().nullable().optional(),
    onetime_source_pool: z.enum(["topup", "voucher"]).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.onetime_adjustment != null && value.onetime_source_pool == null) {
      ctx.addIssue({
        code: "custom",
        // Model-level validation error → loc ["body"]
        path: ["body"],
        message: "onetime_source_pool is required when onetime_adjustment is set",
      });
    }
    if (
      value.recurring_amount == null &&
      value.recurring_enabled == null &&
      value.onetime_adjustment == null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "at least one quota knob is required",
      });
    }
  });

export type MemberQuotaAdjustRequest = z.infer<typeof MemberQuotaAdjustRequestSchema>;

// ---------------------------------------------------------------------------
// Organization member file list (OrgMemberUserFileListRequest)
// ---------------------------------------------------------------------------

export const OrgMemberUserFileListRequestSchema = UserFileListRequestSchema.extend({
  /** Target member user ID (required) */
  user_id: pyUuid,
});

export type OrgMemberUserFileRequest = z.infer<typeof OrgMemberUserFileListRequestSchema>;

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

export const ImageGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  size: z.string().max(20).nullable().optional(),
  n: z.coerce.number().int().min(1).max(4).default(1),
});

export type ImageGenerationRequest = z.infer<typeof ImageGenerationRequestSchema>;

// ---------------------------------------------------------------------------
// Response DTOs (types only for handler assembly, not validated at runtime)
// ---------------------------------------------------------------------------

import type {
  AdminInfo,
  ManagerInfo,
  StudentInfo,
  SuperAdminInfo,
  TeacherInfo,
  UserInfo,
} from "./user.ts";

/** Organization member row (each user/list row: one role of one user) */
export interface OrganizationUserInfo {
  user_id: string | null;
  role: string;
  user_info: UserInfo;
  super_admin_info: SuperAdminInfo | null;
  manager_info: ManagerInfo | null;
  admin_info: AdminInfo | null;
  teacher_info: TeacherInfo | null;
  student_info: StudentInfo | null;
  org_id: string | null;
}

/** Organization tree node (hierarchy /tree) */
export interface OrganizationTreeNode {
  org_id: string;
  org_name: string;
  org_type: string | null;
  org_status: string;
  org_level: number;
  is_root: boolean;
  parent_org_id: string | null;
  org_avatar_url: string | null;
  children: OrganizationTreeNode[];
}

/** Breadcrumbs (root → current) */
export interface OrganizationBreadcrumb {
  org_id: string;
  org_name: string;
  org_level: number;
}

/** Organization stats */
export interface OrganizationStatistics {
  org_id: string;
  org_name: string;
  org_level: number;
  is_root: boolean;
  direct_children_count: number;
  all_descendants_count: number;
  siblings_count: number;
}

/** Seat stats (seat/stats) */
export interface OrganizationSeatRoleBreakdown {
  role: string;
  used: number;
  total: number;
  usage_rate: number;
}

export interface OrganizationSeatStats {
  total_seats: number;
  used_seats: number;
  available_seats: number;
  usage_rate: number;
  role_breakdown: OrganizationSeatRoleBreakdown[];
  ai_teacher_used: number;
  human_teacher_used: number;
}

/** Subscription card (subscription) */
export interface OrganizationSubscriptionInfo {
  subscription_code: string | null;
  subscription_name: string | null;
  price: number | null;
  period: string | null;
  status: string | null;
  next_billing_date: string | null;
  seats_used: number | null;
  seats_total: number | null;
  admin_seat_limit?: number | null;
  teacher_seat_limit?: number | null;
  org_id: string | null;
  org_name: string | null;
  cancel_at_period_end?: boolean | null;
  scheduled_billing_cycle?: string | null;
  scheduled_asset_code?: string | null;
}

/** Generate invite code response */
export interface OrganizationGenerateInviteCodeResponse {
  invite_code: string;
}

/** Credits stats (credits/stats — the core bucket breakdown) */
export interface OrganizationCreditsStats {
  total_credits: string;
  allocated_credits: string;
  remaining_credits: string;
  allocation_percentage: number;
  subscription_total_credits: string;
  subscription_used_credits: string;
  subscription_remaining_credits: string;
  /** Legacy merged-line fields (deployed frontends still render them — remove after a same-window deploy) */
  topup_grant_remaining_credits: string;
  topup_remaining_credits: string;
  grant_remaining_credits: string;
  allocated_to_children_credits: string;
  allocated_to_children_topup_credits: string;
  allocated_to_children_voucher_credits: string;
  /** Strictly per-source allocatable amount for the allocation dialog (not the bucket remainder) */
  topup_allocatable_credits: string;
  voucher_allocatable_credits: string;
  /** Amount currently allocated out per cycle (physical sum of live slots) */
  allocated_to_children_subscription_credits: string;
}

/** Child organization row (children/list — with credits info) */
export interface OrganizationChildInfo {
  org_id: string;
  org_name: string;
  org_type: string | null;
  org_status: string;
  leader_name: string | null;
  leader_user_id: string | null;
  total_credits: string;
  used_credits: string;
  remaining_credits: string;
  created_at: string;
  subscription_remaining_credits: string | null;
  topup_remaining_credits: string | null;
  grant_remaining_credits: string | null;
  recurring_amount: string | null;
  recurring_shortfall: string | null;
}

/** Recurring allocation config (parent view) */
export interface OrganizationRecurringAllocationInfo {
  config_id: string;
  child_org_id: string;
  child_org_name: string | null;
  amount: string;
  status: string;
  revision: number;
  last_applied_boundary: string | null;
  last_applied_amount: string | null;
  last_shortfall_amount: string;
  last_applied_at: string | null;
  created_at: string;
  updated_at: string;
}
