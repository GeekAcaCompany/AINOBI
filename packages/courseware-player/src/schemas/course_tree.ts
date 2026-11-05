// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";
import { array, object } from "yup";

import { courseInfoSchema } from "./course.ts";
import { courseChapterInfoSchema } from "@ainobi/web-kit/schemas/course_chapter";
import { courseSectionInfoSchema } from "./course_section.ts";

export const courseSectionTreeNodeSchema = object({
  section: courseSectionInfoSchema.required(),
});
export type CourseSectionTreeNode = InferType<
  typeof courseSectionTreeNodeSchema
>;

export const courseChapterTreeNodeSchema = object({
  chapter: courseChapterInfoSchema.required(),
  sections: array(courseSectionTreeNodeSchema).required(),
});
export type CourseChapterTreeNode = InferType<
  typeof courseChapterTreeNodeSchema
>;

export const courseTreeNodeSchema = object({
  course: courseInfoSchema.required(),
  chapters: array(courseChapterTreeNodeSchema).required(),
});
export type CourseTreeNode = InferType<typeof courseTreeNodeSchema>;
