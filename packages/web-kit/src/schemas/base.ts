// SPDX-License-Identifier: AGPL-3.0-only
import { object, string, date } from "yup";
import type { InferType } from "yup";

export const baseInfoSchema = object({
    created_by: string().nullable().uuid(),
    updated_by: string().nullable().uuid(),
    created_at: date().nullable(),
    updated_at: date().nullable(),
});
export type BaseInfo = InferType<typeof baseInfoSchema>;