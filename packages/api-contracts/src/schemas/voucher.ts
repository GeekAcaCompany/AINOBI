// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Voucher domain schemas.
 *
 * amount is a lax Decimal: accepts a JSON number or numeric string,
 * must be whole credits (fractions refused), gt=0.
 */

import { Decimal } from "decimal.js";
import { z } from "zod";
import { pyUuid, zQueryScalar } from "./helpers.ts";
import { PaginationRequestSchema } from "./user.ts";

// The real value sets of the PG enums vouchertype / voucherstatus
const voucherTypeEnum = z.enum(["credit"]);
const voucherStatusEnum = z.enum(["available", "exhaustion", "expired", "disabled", "deleted"]);
const redeemTargetEnum = z.enum(["personal", "organization", "both"]);

/** Whole credits (WholeCredits): > 0 with no fractional part */
const wholeCredits = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value as string | number);
    } catch {
      ctx.addIssue({ code: "custom", message: "Input should be a valid decimal, unable to parse string as decimal" });
      return z.NEVER;
    }
    if (!parsed.isInteger()) {
      ctx.addIssue({
        code: "custom",
        message: "amount must be a whole number of credits; decimal values are not allowed",
      });
      return z.NEVER;
    }
    if (parsed.lessThanOrEqualTo(0)) {
      ctx.addIssue({ code: "custom", message: "Input should be greater than 0" });
      return z.NEVER;
    }
    return parsed.toString();
  });

export const VoucherListRequestSchema = PaginationRequestSchema.extend({
  voucher_id: pyUuid.optional(),
  voucher_code: z.string().optional(),
  voucher_type: voucherTypeEnum.optional(),
  voucher_status: voucherStatusEnum.optional(),
  /** Comma-separated statuses; invalid values silently dropped */
  voucher_statuses: z.string().optional(),
  voucher_name: z.string().optional(),
  creator_id: pyUuid.optional(),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
});

export const VoucherCreateRequestSchema = z
  .object({
    voucher_type: voucherTypeEnum,
    voucher_name: z.string().min(1).max(200),
    voucher_description: z.string().max(500).nullable().optional(),
    amount: wholeCredits,
    /** 0 = unlimited */
    usage_limit: z.coerce.number().int().min(0).default(0),
    redeem_target: redeemTargetEnum.default("both"),
    allow_repeat_redeem: z.boolean().default(false),
    valid_from: z.string().nullable().optional(),
    valid_to: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // repeat + unlimited quantity = endless credits minted by the same owner — refuse to issue
    if (value.allow_repeat_redeem && value.usage_limit === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["usage_limit"],
        message:
          "allow_repeat_redeem requires a finite usage_limit (> 0): " +
          "usage_limit=0 means unlimited, which would allow the same " +
          "owner to redeem credits without bound",
      });
    }
  });

export const VoucherUpdateRequestSchema = z.object({
  voucher_name: z.string().min(1).max(200).nullable().optional(),
  voucher_description: z.string().max(500).nullable().optional(),
  amount: wholeCredits.optional(),
  usage_limit: z.coerce.number().int().min(0).nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_to: z.string().nullable().optional(),
  voucher_status: voucherStatusEnum.nullable().optional(),
  redeem_target: redeemTargetEnum.nullable().optional(),
  allow_repeat_redeem: z.boolean().nullable().optional(),
});

export const VoucherRedeemRequestSchema = z.object({
  voucher_code: z.string().min(1).max(50),
  target_org_id: pyUuid.nullable().optional(),
});

export const VoucherUsageListRequestSchema = PaginationRequestSchema.extend({
  usage_id: pyUuid.optional(),
  voucher_id: pyUuid.optional(),
  user_id: pyUuid.optional(),
  voucher_code: z.string().optional(),
  user_required: zQueryScalar(z.boolean()).optional().default(false),
});

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export type VoucherListRequest = z.infer<typeof VoucherListRequestSchema>;
export type VoucherCreateRequest = z.infer<typeof VoucherCreateRequestSchema>;
export type VoucherUpdateRequest = z.infer<typeof VoucherUpdateRequestSchema>;
export type VoucherUsageListRequest = z.infer<typeof VoucherUsageListRequestSchema>;

export interface VoucherInfo {
  voucher_id: string;
  voucher_code: string;
  voucher_type: string;
  voucher_status: string;
  voucher_name: string;
  voucher_description: string | null;
  /** Decimal → string (the production JSON serialization form) */
  amount: string;
  /** int (bigint column) — JSON number */
  usage_limit: number;
  used_count: number;
  creator_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  redeem_target: string;
  allow_repeat_redeem: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoucherUsage {
  usage_id: string;
  voucher_id: string;
  user_id: string;
  org_id: string | null;
  redeem_scope: string;
  voucher_code: string;
  amount: string;
  used_at: string;
}

export interface VoucherRedeemToOrganizationResponse {
  voucher_info: VoucherInfo;
  organization_asset_id: string;
  organization_asset_amount: string;
  ledger_id: string;
  usage_id: string;
  org_id: string;
}
