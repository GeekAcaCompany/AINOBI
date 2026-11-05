// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stripe payment domain enums.
 */

/** Stripe subscription status (PG enum type: stripesubscriptionstatus) */
export const StripeSubscriptionStatus = {
  Active: "active",
  Canceled: "canceled",
  PastDue: "past_due",
  Unpaid: "unpaid",
  Trialing: "trialing",
  Incomplete: "incomplete",
  IncompleteExpired: "incomplete_expired",
  Paused: "paused",
} as const;
export type StripeSubscriptionStatus =
  (typeof StripeSubscriptionStatus)[keyof typeof StripeSubscriptionStatus];

/** Stripe payment status (PG enum type: stripepaymentstatus) */
export const StripePaymentStatus = {
  Succeeded: "succeeded",
  Failed: "failed",
  Pending: "pending",
  Canceled: "canceled",
  Refunded: "refunded",
  PartiallyRefunded: "partially_refunded",
} as const;
export type StripePaymentStatus =
  (typeof StripePaymentStatus)[keyof typeof StripePaymentStatus];

/** Billing cycle (PG enum type: billingcycle) */
export const BillingCycle = {
  Monthly: "monthly",
  Yearly: "yearly",
} as const;
export type BillingCycle = (typeof BillingCycle)[keyof typeof BillingCycle];

/** Payment method type (no matching PG enum type; no table uses it) */
export const PaymentMethodType = {
  Card: "card",
  Alipay: "alipay",
  WechatPay: "wechat_pay",
} as const;
export type PaymentMethodType = (typeof PaymentMethodType)[keyof typeof PaymentMethodType];

/**
 * Payment record type discriminators — plain string constants, not an enum: the personal payment table stores these two values verbatim in
 * its `record_type` column (organization rows have no such column; their type is derived in code), so the stored strings must never change.
 * Reference these two constants; do not redeclare the literals at call sites.
 */
export const RECORD_TYPE_SUBSCRIPTION_INVOICE = "subscription_invoice";
export const RECORD_TYPE_CREDITS_CHECKOUT = "credits_checkout";
