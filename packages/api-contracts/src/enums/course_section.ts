// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course section domain enums.
 */

/** Course section status (PG enum type: coursesectionstatus) */
export const CourseSectionStatus = {
  /** Draft */
  Draft: "draft",
  /** Public */
  Public: "public",
  /** Taken down */
  OffShelf: "off_shelf",
  /** Deleted */
  Deleted: "deleted",
} as const;
export type CourseSectionStatus =
  (typeof CourseSectionStatus)[keyof typeof CourseSectionStatus];

/** Course section type (PG enum type: coursesectiontype) */
export const CourseSectionType = {
  /** Video */
  Video: "video",
  /** Live */
  Live: "live",
  /** AI */
  AI: "ai",
} as const;
export type CourseSectionType = (typeof CourseSectionType)[keyof typeof CourseSectionType];
