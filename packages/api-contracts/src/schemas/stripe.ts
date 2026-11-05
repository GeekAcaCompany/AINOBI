// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stripe request schemas.
 *
 * The runtime shape of the response DTOs (StripeSubscriptionInfo / PaymentRecordInfo / CreditsTopUpInfo etc.)
 * is returned by the service layer as plain objects (types in services/stripe_subscription.ts
 * and stripe_credits.ts); this file carries only the request-side zod schemas.
 */

import { z } from "zod";
import { pyBoolRequired, pyEnum, pyIntRequired } from "./helpers.ts";
import { BillingCycle } from "../enums/stripe.ts";

const billingCycleEnum = pyEnum([
  BillingCycle.Monthly,
  BillingCycle.Yearly,
] as const);

/** CreateSubscriptionRequest — create an organization subscription checkout */
export const CreateSubscriptionRequestSchema = z.object({
  subscription_code: z.string(),
  billing_cycle: billingCycleEnum,
  cancel_existing_on_payment_success: pyBoolRequired().default(false),
  cancel_existing_immediately: pyBoolRequired().default(true),
  return_path: z.string().optional().nullable(),
});

/** CreatePersonalSubscriptionRequest — personal subscription (retired; kept only for schema alignment) */
export const CreatePersonalSubscriptionRequestSchema = z.object({
  billing_cycle: billingCycleEnum,
});

/** SwitchBillingCycleRequest — schedule a billing cycle switch at the end of the period */
export const SwitchBillingCycleRequestSchema = z.object({
  billing_cycle: billingCycleEnum,
});

/** ChangePlanRequest — self-service plan tier change (basic <-> growth) */
export const ChangePlanRequestSchema = z.object({
  subscription_code: z.string(),
  billing_cycle: billingCycleEnum,
});

/** CancelSubscriptionRequest — cancel the subscription (optional JSON body) */
export const CancelSubscriptionRequestSchema = z.object({
  cancel_immediately: pyBoolRequired().default(false),
});

/** CreateCreditsTopUpRequest — one-off credits top-up checkout */
export const CreateCreditsTopUpRequestSchema = z.object({
  credits: pyIntRequired().pipe(z.number().int().gt(0)),
  return_path: z.string().optional().nullable(),
});

export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequestSchema>;
export type CreatePersonalSubscriptionRequest = z.infer<typeof CreatePersonalSubscriptionRequestSchema>;
export type SwitchBillingCycleRequest = z.infer<typeof SwitchBillingCycleRequestSchema>;
export type ChangePlanRequest = z.infer<typeof ChangePlanRequestSchema>;
export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionRequestSchema>;
export type CreateCreditsTopUpRequest = z.infer<typeof CreateCreditsTopUpRequestSchema>;
