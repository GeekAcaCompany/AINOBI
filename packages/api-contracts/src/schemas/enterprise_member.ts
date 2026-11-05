// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Enterprise member domain schemas.
 *
 * - The public activation subset (used by the user routes)
 * - Member quota view DTOs (used by the organization route members/{user_id}/quota;
 *   MemberQuotaAdjustRequest is already in schemas/organization.ts)
 * - EnterpriseProvisionRequest (the provisioning block embedded in org-side teacher/student/admin
 *   create requests)
 */

import { z } from "zod";
import { pyBool } from "./helpers.ts";
import { pyDecimal } from "./organization.ts";

/**
 * Enterprise member provisioning block (EnterpriseProvisionRequest).
 * Embedded in org-side teacher/student/admin create requests: when present, it switches the create flow to enterprise provisioning (Pending user + activation email +
 * a personal-workspace child organization under the enterprise).
 */
export const EnterpriseProvisionRequestSchema = z
  .object({
    /** Login email of the provisioned account (becomes account_name + email; the activation email goes here) */
    email: z.email(),
    /**
     * Quota tool: monthly = the enterprise subscription pool allocates per cycle; total = top-level/voucher pool
     * one-off allocation. Omitted = no quota yet (the member just shares the organization balance).
     */
    quota_mode: z.enum(["monthly", "total"]).nullable().optional(),
    /** Per-cycle amount (monthly) or one-off amount (total). Required when quota_mode is set. */
    quota_amount: pyDecimal({ gt: 0, message: "Input should be greater than 0" }).nullable().optional(),
    /** Access switches (issue #857): all False by default, enterprise accounts are limited to their organization by default */
    allow_platform_courses: pyBool().optional().default(false),
    allow_join_other_orgs: pyBool().optional().default(false),
    /** Source pool of a one-off (total) allocation; only meaningful when quota_mode == 'total' */
    quota_source_pool: z.enum(["topup", "voucher"]).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // Model-level after validation (validate_quota_fields semantics)
    if (value.quota_mode == null) {
      // Refuse orphan quota fields: provisioning would silently drop the requested allocation
      if (value.quota_amount != null) {
        ctx.addIssue({ code: "custom", message: "quota_amount requires quota_mode to be set" });
      }
      if (value.quota_source_pool != null) {
        ctx.addIssue({ code: "custom", message: "quota_source_pool requires quota_mode to be set" });
      }
    } else if (value.quota_mode === "monthly" && value.quota_source_pool != null) {
      // monthly is always backed by the subscription pool; source pool only matters for one-off allocations
      ctx.addIssue({ code: "custom", message: "quota_source_pool is only valid when quota_mode is 'total'" });
    } else {
      if (value.quota_amount == null) {
        ctx.addIssue({ code: "custom", message: "quota_amount is required when quota_mode is set" });
      }
      if (value.quota_mode === "total" && value.quota_source_pool == null) {
        ctx.addIssue({ code: "custom", message: "quota_source_pool is required when quota_mode is 'total'" });
      }
    }
  });

export type EnterpriseProvisionRequest = z.infer<typeof EnterpriseProvisionRequestSchema>;

/** Public token check request (pre-login activation page, no auth) */
export const ActivationValidateRequestSchema = z.object({
  /** Raw token from the activation email link */
  token: z.string().min(16),
});

/**
 * Public activation request: consumes the email token + sets the login password.
 * The password policy mirrors student sign-up (8+ characters with both letters and digits).
 */
export const ActivationActivateRequestSchema = z.object({
  token: z.string().min(16),
  account_password: z
    .string()
    .min(8)
    .max(200)
    .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
      message: "Password must be at least 8 characters and include both letters and numbers",
    }),
});

/** Public token check result (activation page render data; datetimes are isoformat strings) */
export interface ActivationValidateInfo {
  email: string;
  user_name: string;
  org_name: string;
  role: string | null;
  expires_at: string;
}

export type ActivationValidateRequest = z.infer<typeof ActivationValidateRequestSchema>;
export type ActivationActivateRequest = z.infer<typeof ActivationActivateRequestSchema>;

// ---------------------------------------------------------------------------
// Member quota view DTOs
// ---------------------------------------------------------------------------

/** Monthly cycle allocation status of an enterprise member */
export interface MemberQuotaRecurringInfo {
  config_id: string;
  /** Amount the member's subscription slot resets to each cycle */
  amount: string;
  status: string;
  revision: number;
  last_applied_amount: string | null;
  /** Funding shortfall reported by the last apply/sweep (0/None = healthy) */
  last_shortfall_amount: string | null;
  last_applied_at: string | null;
}

/** One-off allocation batch on the member workspace */
export interface MemberQuotaOnetimeInfo {
  source_pool: "topup" | "voucher";
  allocated_total: string;
  remaining_total: string;
}

/** Current-cycle usage of the workspace allocation subscription slot (monthly cycle quota) */
export interface MemberQuotaSubscriptionUsage {
  total: string;
  used: string;
  remaining: string;
  period_end: string | null;
}

/** Enterprise member quota view (quota tools of the member's personal workspace + the workspace's spendable balance) */
export interface MemberQuotaInfo {
  user_id: string;
  account_type: string;
  workspace_org_id: string | null;
  quota_mode: "monthly" | "total" | "none";
  recurring: MemberQuotaRecurringInfo | null;
  /** Current-cycle usage of the monthly slot (null when there is no cycle config and no live subscription slot) */
  subscription_usage: MemberQuotaSubscriptionUsage | null;
  /** Every per-type one-off pool holding an allocation (topup and voucher can coexist); onetime keeps main-pool compatibility */
  onetime_pools: MemberQuotaOnetimeInfo[];
  onetime: MemberQuotaOnetimeInfo | null;
  workspace_remaining_credits: string;
}

/** Activation email resend result */
export interface ResendActivationResult {
  sent: boolean;
  expires_at: string;
}
