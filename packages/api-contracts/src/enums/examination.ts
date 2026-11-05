// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Examination domain enums.
 */

/** Examination status (PG enum type: examinationstatus) */
export const ExaminationStatus = {
  /** Draft */
  Draft: "draft",
  /** Published */
  Published: "published",
  /** In progress */
  InProgress: "in_progress",
  /** Ended */
  Ended: "ended",
  /** Deleted */
  Deleted: "deleted",
} as const;
export type ExaminationStatus =
  (typeof ExaminationStatus)[keyof typeof ExaminationStatus];

/** Examination type (PG enum type: examinationtype) */
export const ExaminationType = {
  /** Practice */
  Practice: "practice",
  /** Quiz */
  Quiz: "quiz",
  /** Exam */
  Examination: "examination",
  /** Final exam */
  Final: "final",
} as const;
export type ExaminationType = (typeof ExaminationType)[keyof typeof ExaminationType];
