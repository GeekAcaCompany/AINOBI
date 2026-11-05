// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";

import { date, number, object, string } from "yup";

import { CourseChapterStatus } from "@ainobi/api-contracts/enums/course_chapter.ts";

export const courseChapterInfoSchema = object({
  chapter_id: string().uuid().required(),
  chapter_name: string().required(),
  chapter_status: string().oneOf(Object.values(CourseChapterStatus)).required(),
  chapter_description: string().nullable(),
  main_image_url: string().nullable(),
  chapter_price: number().nullable(),
  chapter_original_price: number().nullable(),
  course_id: string().uuid().required(),
  org_id: string().uuid().required(),
  remark: string().nullable(),
  sort: number().nullable(),
  published_by: string().uuid().nullable(),
  published_at: date().nullable(),
});
export type CourseChapterInfo = InferType<typeof courseChapterInfoSchema>;
