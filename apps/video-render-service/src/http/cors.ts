// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CORS binding — the mechanism is in @ainobi/http; the policy reads environment variables per request (CORS_ALLOW_ORIGIN /
 * CORS_ALLOW_HEADERS), and the default allowed headers additionally admit the render task affinity header.
 */
import { createCors, DEFAULT_CORS_ALLOW_HEADERS } from "@ainobi/http";
import { RENDER_TASK_AFFINITY_HEADER_NAME } from "../config/video-render.ts";

export const { corsHeaders, applyCorsHeaders, sendCorsPreflight, sendJsonWithCors } = createCors(() => ({
  allowOrigin: process.env.CORS_ALLOW_ORIGIN,
  allowHeaders:
    process.env.CORS_ALLOW_HEADERS?.trim() ||
    `${DEFAULT_CORS_ALLOW_HEADERS}, ${RENDER_TASK_AFFINITY_HEADER_NAME}`,
}));
