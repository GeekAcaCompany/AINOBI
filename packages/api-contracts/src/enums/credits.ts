// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Credits billing domain enums.
 *
 * Used only at the request layer of the explicit consume API; no matching PG enum type.
 */

/** Credits billing source of the explicit consume API */
export const CreditsConsumptionType = {
  User: "user",
  Organization: "organization",
} as const;
export type CreditsConsumptionType =
  (typeof CreditsConsumptionType)[keyof typeof CreditsConsumptionType];

/** Unit `amount` is interpreted in before the asset ledger is debited */
export const CreditsAmountUnit = {
  Tokens: "tokens",
  Credits: "credits",
} as const;
export type CreditsAmountUnit =
  (typeof CreditsAmountUnit)[keyof typeof CreditsAmountUnit];
