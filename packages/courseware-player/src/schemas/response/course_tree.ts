// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";
import { array, object } from "yup";

import { courseTreeNodeSchema } from "../course_tree.ts";

export const courseTreeResponseSchema = object({
  courses: array(courseTreeNodeSchema).required(),
});
export type CourseTreeResponse = InferType<typeof courseTreeResponseSchema>;
