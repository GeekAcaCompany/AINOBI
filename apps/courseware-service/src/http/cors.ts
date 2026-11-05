// SPDX-License-Identifier: AGPL-3.0-only
/** CORS binding — the mechanism is in @ainobi/http; the policy reads environment variables per request (CORS_ALLOW_ORIGIN / CORS_ALLOW_HEADERS). */
import { createCors } from "@ainobi/http";

export const { corsHeaders, applyCorsHeaders, sendCorsPreflight, sendJsonWithCors } = createCors(() => ({
  allowOrigin: process.env.CORS_ALLOW_ORIGIN,
  allowHeaders: process.env.CORS_ALLOW_HEADERS,
}));
