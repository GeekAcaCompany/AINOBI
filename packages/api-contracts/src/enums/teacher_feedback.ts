// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teacher feedback domain enums.
 */

/**
 * Teacher feedback type (PG enum type: feedbacktype)
 *
 * - to_student: sent to the student (visible to the student)
 * - to_admin_system_note: sent to managers / system note (internal, never shown to the student)
 */
export const FeedbackType = {
  /** Sent to the student */
  ToStudent: "to_student",
  /** Sent to managers / system note */
  ToAdminSystemNote: "to_admin_system_note",
} as const;
export type FeedbackType = (typeof FeedbackType)[keyof typeof FeedbackType];
