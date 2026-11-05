// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course chapter domain enums.
 */

/** Course chapter status (PG enum type: coursechapterstatus) */
export const CourseChapterStatus = {
  /** Draft */
  Draft: "draft",
  /** Public chapter */
  Public: "public",
  /** Private chapter */
  Private: "private",
  /** Taken down */
  OffShelf: "off_shelf",
  /** Deleted */
  Deleted: "deleted",
} as const;
export type CourseChapterStatus =
  (typeof CourseChapterStatus)[keyof typeof CourseChapterStatus];
