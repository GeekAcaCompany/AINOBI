// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Service pricing domain enums.
 */

/** Billing mode (PG enum type: billingmode) */
export const BillingMode = {
  /** Billed per token */
  TokenBased: "token_based",
  /** Billed per call (per request / per invocation) */
  CountBased: "count_based",
} as const;
export type BillingMode = (typeof BillingMode)[keyof typeof BillingMode];

/** Service price status (PG enum type: servicepricestatus) */
export const ServicePriceStatus = {
  /** Enabled */
  Active: "active",
  /** Disabled */
  Inactive: "inactive",
  /** Deprecated */
  Deprecated: "deprecated",
} as const;
export type ServicePriceStatus =
  (typeof ServicePriceStatus)[keyof typeof ServicePriceStatus];
