// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicit credits consumption domain schemas.
 *
 * Key S2S endpoint (courseware-service / interaction-service depend on it):
 * - amount is a lax Decimal (number or numeric string)
 * - service_code accepts the historical product_code alias (AliasChoices semantics)
 * - idempotency keys / credits math go through decimal.js strings, never Number()
 */

import { z } from "zod";
import { Decimal } from "decimal.js";
import { pyEnum, pyUuid } from "./helpers.ts";
import { UsageType } from "../enums/asset.ts";
import { CreditsAmountUnit, CreditsConsumptionType } from "../enums/credits.ts";

/**
 * Production contract for a required positive Decimal, reproduced verbatim:
 * - missing → "Field required"
 * - null/bool/object → "Decimal input should be an integer, float, string or Decimal object"
 * - non-numeric string → "Input should be a valid decimal"
 * - ≤ 0 → "Input should be greater than 0"
 * Outputs a normalized decimal.js string (later math does new Decimal(str)).
 */
const creditsAmount = z
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
        message:
          "Decimal input should be an integer, float, string or Decimal object",
      });
    }
  })
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value as string | number);
    } catch {
      ctx.addIssue({ code: "custom", message: "Input should be a valid decimal" });
      return z.NEVER;
    }
    if (parsed.lessThanOrEqualTo(0)) {
      ctx.addIssue({ code: "custom", message: "Input should be greater than 0" });
      return z.NEVER;
    }
    // Decimal keeps the input scale: string input keeps its decimal places, number input follows
    // its repr (converted via str(), no binary tail)
    if (typeof value === "string") {
      const dot = value.indexOf(".");
      const scale = dot === -1 ? 0 : value.length - dot - 1;
      return parsed.toFixed(scale);
    }
    return String(value);
  });

/** Required int (body; null refused) */
function pyRequiredInt<T extends z.ZodType<number>>(schema: T) {
  return schema
    .nullable()
    .refine((value) => value !== null, {
      message: "Input should be a valid integer",
    }) as unknown as z.ZodType<number>;
}

/** Explicit credits consume request (POST /credits/consume) */
export const CreditsConsumeRequestSchema = z.preprocess(
  (value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (record.service_code === undefined && record.product_code !== undefined) {
        return { ...record, service_code: record.product_code };
      }
    }
    return value;
  },
  z.object({
    service_code: z.string().min(1).max(120),
    /** Deprecated compatibility field: the server decides the billing source from org_id */
    consumption_type: pyEnum([
      CreditsConsumptionType.User,
      CreditsConsumptionType.Organization,
    ]).nullable().optional(),
    org_id: pyUuid.nullable().optional(),
    /** Token count (or the unsplit total) for the tokens unit; the exact amount to debit for the credits unit */
    amount: creditsAmount,
    amount_unit: pyEnum([
      CreditsAmountUnit.Tokens,
      CreditsAmountUnit.Credits,
    ]).default(CreditsAmountUnit.Tokens),
    input_tokens: pyRequiredInt(z.coerce.number().int().min(0)).default(0),
    output_tokens: pyRequiredInt(z.coerce.number().int().min(0)).default(0),
    cache_tokens: pyRequiredInt(z.coerce.number().int().min(0)).default(0),
    count: pyRequiredInt(z.coerce.number().int().min(1)).default(1),
    unit_count: pyRequiredInt(z.coerce.number().int().min(0)).default(0),
    content: z.string().min(1).max(300),
    /** Caller business key: replaying the same key returns the original ledger entry without debiting again */
    idempotency_key: z.string().min(1).max(128).nullable().optional(),
    usage_type: pyEnum(Object.values(UsageType)).nullable().optional(),
  }),
);
export type CreditsConsumeRequest = z.infer<typeof CreditsConsumeRequestSchema>;

/**
 * Explicit credits consume response. credits_consumed / remaining_credits are
 * Decimal strings (scale kept, e.g. "1", "0.007857142800000").
 */
export interface CreditsConsumeResponse {
  service_code: string;
  consumption_type: CreditsConsumptionType;
  amount_unit: CreditsAmountUnit;
  org_id: string | null;
  credits_consumed: string;
  remaining_credits: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  service_id: string | null;
  ledger_id: string | null;
}
