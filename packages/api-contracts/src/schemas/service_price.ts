// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Service pricing domain schemas.
 *
 * Internal models of the credits consumption chain (rows of the service_price / service_plan_ratio tables +
 * token/count consume requests + consume/estimate results). The pg driver returns Decimal ratio columns as strings,
 * and at runtime everything goes through decimal.js strings.
 */

import type { BillingMode, ServicePriceStatus } from "../enums/service_price.ts";
import type { UsageType } from "../enums/asset.ts";

/** service_price row */
export interface ServicePriceInfo {
  service_id: string;
  service_name: string;
  service_code: string;
  billing_mode: BillingMode;
  status: ServicePriceStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** service_plan_ratio row (ratios are decimal.js strings) */
export interface ServicePlanRatioInfo {
  ratio_id: string;
  service_id: string;
  asset_code: string;
  input_credit_ratio: string | null;
  output_credit_ratio: string | null;
  cache_credit_ratio: string | null;
  count_credit_ratio: string | null;
  status: ServicePriceStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Token-billed consume request */
export interface TokenConsumptionRequest {
  service_code: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  session_id?: string | null;
  remark?: string | null;
  usage_type?: UsageType | null;
}

/** Per-call consume request */
export interface CountConsumptionRequest {
  service_code: string;
  count: number;
  unit_count: number;
  session_id?: string | null;
  remark?: string | null;
  usage_type?: UsageType | null;
}

/** Consume result (Decimal fields are decimal.js strings) */
export interface ServiceConsumptionResult {
  success: boolean;
  credits_consumed: string;
  remaining_credits: string;
  service_id: string | null;
  ledger_id: string | null;
  error: string | null;
}

/** Estimate result */
export interface CreditCalculationResult {
  service_code: string;
  service_name: string | null;
  billing_mode: BillingMode;
  input_credits: string;
  output_credits: string;
  cache_credits: string;
  count_credits: string;
  total_credits: string;
  breakdown: Record<string, unknown>;
}

/** Balance check result (returned as a dict) */
export interface CreditsBalanceCheck {
  sufficient: boolean;
  available_balance: string;
  required_credits: string;
  asset_id: string | null;
  message: string;
}
