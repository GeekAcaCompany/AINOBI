// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Section unlock / deadline condition domain enums.
 */

/**
 * Start condition type of a course section (PG enum type: sectionstartcondition)
 *
 * Controls when the section opens to students.
 */
export const SectionStartCondition = {
  /** Not locked, accessible immediately */
  NONE: "none",
  /** Unlocks once the previous section in order is completed */
  AFTER_PREVIOUS_COMPLETED: "after_previous_completed",
  /** Unlocks X days after the previous section is completed */
  DAYS_AFTER_PREVIOUS_COMPLETED: "days_after_previous_completed",
  /** Unlocks on a given date */
  FIXED_DATE: "fixed_date",
} as const;
export type SectionStartCondition =
  (typeof SectionStartCondition)[keyof typeof SectionStartCondition];

/**
 * Deadline condition type of a course section (PG enum type: sectiondeadlinecondition)
 *
 * Controls when the section expires and is no longer accessible.
 */
export const SectionDeadlineCondition = {
  /** No deadline */
  NONE: "none",
  /** Expires X days after the previous section is completed */
  DAYS_AFTER_PREVIOUS_COMPLETED: "days_after_previous_completed",
  /** Expires on a given date */
  FIXED_DATE: "fixed_date",
} as const;
export type SectionDeadlineCondition =
  (typeof SectionDeadlineCondition)[keyof typeof SectionDeadlineCondition];
