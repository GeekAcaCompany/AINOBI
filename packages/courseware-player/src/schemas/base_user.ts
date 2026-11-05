// SPDX-License-Identifier: AGPL-3.0-only
import { object, string, date } from "yup";
import type { InferType } from "yup";

import { baseInfoSchema } from "@ainobi/web-kit/schemas/base";

export const baseUserInfoSchema = object({
    ...baseInfoSchema.fields,
    user_id: string().uuid().required(),
    remark: string().nullable().max(500),
    last_login_at: date().nullable(),
});
export type BaseUserInfo = InferType<typeof baseUserInfoSchema>;