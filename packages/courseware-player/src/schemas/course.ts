// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";

import { array, boolean, date, number, object, string } from "yup";

import { CourseStatus } from "@ainobi/api-contracts/enums/course.ts";
import { teacherInfoSchema } from "./teacher.ts";
import { aiTeacherInfoSchema } from "./ai_teacher.ts";

export const courseInfoSchema = object({
  course_id: string().uuid().required(),
  course_name: string().required(),
  course_status: string().oneOf(Object.values(CourseStatus)).required(),
  course_description: string().nullable(),
  main_image_url: string().nullable(),
  course_price: number().nullable(),
  course_original_price: number().nullable(),
  course_color: string().nullable(),
  course_emoji: string().nullable(),
  student_count: number().nullable(),
  chapter_count: number().nullable(),
  section_count: number().nullable(),
  teachers: array().of(teacherInfoSchema).nullable(),
  ai_teachers: array().of(aiTeacherInfoSchema).nullable(),
  org_id: string().uuid().required(),
  remark: string().nullable(),
  sort: number().nullable(),
  published_by: string().uuid().nullable(),
  published_at: date().nullable(),
  last_unfinished_chapter_id: string().uuid().nullable(),
  last_unfinished_section_id: string().uuid().nullable(),
  is_public_course: boolean().optional().default(false),
});
export type CourseInfo = InferType<typeof courseInfoSchema>;
