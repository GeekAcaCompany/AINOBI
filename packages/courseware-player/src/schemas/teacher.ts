// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";
import { object, string, array } from "yup";

import {
  TeacherStatus
} from "../enums/teacher.ts";

import { baseUserInfoSchema } from "./base_user.ts";

export const teacherInfoSchema = object({
  teacher_id: string().uuid().required(),
  teacher_no: string().nullable(),
  teacher_name: string().required(),
  teacher_name_kana: string().nullable(),
  teacher_status: string().oneOf(Object.values(TeacherStatus)).required(),
  teacher_introduction: string().nullable(),
  teacher_titles: array().of(string()).nullable(),
  teacher_avatar_url: string().nullable(),
  org_id: string().uuid().required(),
}).concat(baseUserInfoSchema);
export type TeacherInfo = InferType<typeof teacherInfoSchema>;
