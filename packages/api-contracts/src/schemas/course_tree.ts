// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course tree schemas.
 */

import type { CourseInfo } from "./course.ts";
import type { CourseChapterInfo } from "./course_chapter.ts";
import type { CourseSectionInfo } from "./course_section.ts";

/** Section tree node */
export interface CourseSectionTreeNode {
  section: CourseSectionInfo;
}

/** Chapter tree node (with its sorted sections) */
export interface CourseChapterTreeNode {
  chapter: CourseChapterInfo;
  sections: CourseSectionTreeNode[];
}

/** Course tree node (with its sorted chapters) */
export interface CourseTreeNode {
  course: CourseInfo;
  chapters: CourseChapterTreeNode[];
}

/** Course tree response (GET /{course_id}/tree) */
export interface CourseTreeResponse {
  courses: CourseTreeNode[];
}
