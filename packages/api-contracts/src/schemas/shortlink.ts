// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Short link domain schemas
 * (the server-side create path: needed by consumer modules such as course clone links).
 */

import { z } from "zod";
import { ShortLinkStatus } from "../enums/shortlink.ts";

/** Create short link request (the service-internal call form — course clone links etc.) */
export const ShortLinkCreateRequestSchema = z.object({
  original_url: z.string(),
  redirect_url: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  expires_at: z.string().datetime({ offset: true }).optional().nullable(),
});

export type ShortLinkCreateRequest = z.infer<typeof ShortLinkCreateRequestSchema>;

/** Short link response (ShortLinkRedirectResponse is in services/shortlink.ts) */
export interface ShortLinkResponse {
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;

  shortlink_id: string;
  short_code: string;
  content_md5: string;
  shortlink_status: ShortLinkStatus;
  original_url: string;
  redirect_url: string | null;
  description: string | null;
  expires_at: string | null;
  click_count: number;
  short_url: string;
}
