// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recurring allocation domain enums.
 */

/**
 * Lifecycle of a recurring credits allocation config (PG enum type: recurringallocationstatus)
 *
 * Cancelled rows are terminal history (re-creating an allocation for the same child creates a new row / new child slot) —
 * that is what lets a cancelled cycle's retained slot balance coexist with the new config's slot.
 */
export const RecurringAllocationStatus = {
  Active: "active",
  Cancelled: "cancelled",
} as const;
export type RecurringAllocationStatus =
  (typeof RecurringAllocationStatus)[keyof typeof RecurringAllocationStatus];

/**
 * Why an allocation config was cancelled (for audit).
 *
 * Stored as a plain String(64) column (cancelled_reason), not a PG enum.
 */
export const RecurringAllocationCancelReason = {
  User: "user",
  ChildDeleted: "child_deleted",
  ChildMoved: "child_moved",
  ParentDeleted: "parent_deleted",
} as const;
export type RecurringAllocationCancelReason =
  (typeof RecurringAllocationCancelReason)[keyof typeof RecurringAllocationCancelReason];
