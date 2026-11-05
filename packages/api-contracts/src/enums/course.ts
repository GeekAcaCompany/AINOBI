// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course domain enums.
 */

/** Course status (PG enum type: coursestatus) */
export const CourseStatus = {
  /** Draft */
  Draft: "draft",
  /** Public */
  Public: "public",
  /** Private */
  Private: "private",
  /** Taken down */
  OffShelf: "off_shelf",
  /** Deleted */
  Deleted: "deleted",
} as const;
export type CourseStatus = (typeof CourseStatus)[keyof typeof CourseStatus];
