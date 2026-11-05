// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Home conversation domain schemas.
 */

import { z } from "zod";
import { pyUuid } from "./helpers.ts";

const MAX_TITLE_LENGTH = 256;

const homeConversationKind = z.enum(["interaction", "create", "persona"]).default("interaction");

export const StudentHomeConversationUpsertRequestSchema = z.strictObject({
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  kind: homeConversationKind,
  messages: z.array(z.unknown()).default([]),
  create_meta: z.record(z.string(), z.unknown()).nullable().optional(),
  interaction_session_id: z.string().nullable().optional(),
  interaction_conversation_id: z.string().nullable().optional(),
  last_prompt: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }).nullable().optional(),
  updated_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export type StudentHomeConversationUpsertRequest = z.infer<typeof StudentHomeConversationUpsertRequestSchema>;

export interface StudentHomeConversationInfo {
  conversation_id: string;
  user_id: string;
  title: string;
  kind: string;
  messages: unknown[];
  create_meta: Record<string, unknown> | null;
  interaction_session_id: string | null;
  interaction_conversation_id: string | null;
  last_prompt: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface StudentHomeConversationListResponse {
  items: StudentHomeConversationInfo[];
}

export { pyUuid as homeConversationIdParam };
