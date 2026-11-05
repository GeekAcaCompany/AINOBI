// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Voucher domain enums.
 */

/** Voucher type (PG enum type: vouchertype) */
export const VoucherType = {
  Credit: "credit",
} as const;
export type VoucherType = (typeof VoucherType)[keyof typeof VoucherType];

/** Voucher status (PG enum type: voucherstatus) */
export const VoucherStatus = {
  Available: "available",
  Exhaustion: "exhaustion",
  Expired: "expired",
  Disabled: "disabled",
  Deleted: "deleted",
} as const;
export type VoucherStatus = (typeof VoucherStatus)[keyof typeof VoucherStatus];

/** Voucher redeem target (PG enum type: voucherredeemtarget) */
export const VoucherRedeemTarget = {
  /** Personal redemption */
  Personal: "personal",
  /** Organization redemption */
  Organization: "organization",
  /** Either */
  Both: "both",
} as const;
export type VoucherRedeemTarget =
  (typeof VoucherRedeemTarget)[keyof typeof VoucherRedeemTarget];
