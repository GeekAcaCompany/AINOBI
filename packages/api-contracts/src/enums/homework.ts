// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Homework domain enums.
 */

/** Homework status (PG enum type: homeworkstatus) */
export const HomeworkStatus = {
  /** Not submitted */
  NotSubmit: "not_submit",
  /** Submitted */
  Submitted: "submitted",
  /** Graded */
  Graded: "graded",
} as const;
export type HomeworkStatus = (typeof HomeworkStatus)[keyof typeof HomeworkStatus];
