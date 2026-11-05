// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";
import { date, number, object, string } from "yup";

import {
  CourseKnowledgeFileStatus,
  CourseKnowledgeFileType,
} from "@ainobi/api-contracts/enums/course_knowledge_file.ts";

export const courseKnowledgeFileInfoSchema = object({
  file_id: string().required().uuid(),
  file_status: string()
    .oneOf(Object.values(CourseKnowledgeFileStatus))
    .required(),
  file_type: string().oneOf(Object.values(CourseKnowledgeFileType)).required(),
  file_name: string().required().max(255),
  file_size: number().min(0).required(),
  file_md5: string().required().max(32),
  file_url: string().required().url(),
  file_text_content: string().nullable(),
  file_summary: string().nullable(),
  file_keywords: string().nullable(),
  knowledge_id: string().required().uuid(),
  course_id: string().required().uuid(),
  org_id: string().required().uuid(),
  remark: string().nullable(),
  sort: number().min(0).required(),
  duration_seconds: number().min(0).nullable(),
  created_by: string().required().uuid(),
  updated_by: string().required().uuid(),
  created_at: date().required(),
  updated_at: date().required(),
});
export type CourseKnowledgeFileInfo = InferType<
  typeof courseKnowledgeFileInfoSchema
>;
