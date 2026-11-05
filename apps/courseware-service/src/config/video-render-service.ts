// SPDX-License-Identifier: AGPL-3.0-only
import { timingSafeEqual } from "node:crypto";

/**
 * FC HeaderField affinity header for ainobi-video-render-service.
 * Must match `RENDER_TASK_AFFINITY_HEADER_NAME` / `sessionAffinityConfig.affinityHeaderFieldName`
 * on that service. Value is the render task UUID (client-generated on create).
 */
export const RENDER_TASK_AFFINITY_HEADER_NAME = "ainobi-render-task-id";

export type VideoRenderServiceTarget = "render" | "query";

function trimBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

/**
 * Legacy single base URL — local dev or a shared custom domain that routes by path/method.
 * Used as fallback when `AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL` /
 * `AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL` are unset.
 */
export function resolveVideoRenderServiceLegacyBaseUrl(): string | undefined {
  const raw = process.env.AINOBI_VIDEO_RENDER_SERVICE_URL?.trim();
  return raw ? trimBaseUrl(raw) : undefined;
}

/** @deprecated Prefer `resolveVideoRenderServiceRenderBaseUrl` / `resolveVideoRenderServiceQueryBaseUrl`. */
export function resolveVideoRenderServiceBaseUrl(): string {
  return resolveVideoRenderServiceQueryBaseUrl();
}

/** Render FC function — create / run / retry / cancel (session affinity). */
export function resolveVideoRenderServiceRenderBaseUrl(): string {
  const raw =
    process.env.AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL?.trim() ||
    resolveVideoRenderServiceLegacyBaseUrl();
  if (!raw) {
    throw new Error(
      "AINOBI_VIDEO_RENDER_SERVICE_RENDER_URL (or legacy AINOBI_VIDEO_RENDER_SERVICE_URL) is not configured",
    );
  }
  return trimBaseUrl(raw);
}

/** Query FC function — list / get / delete (stateless, high concurrency). */
export function resolveVideoRenderServiceQueryBaseUrl(): string {
  const raw =
    process.env.AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL?.trim() ||
    resolveVideoRenderServiceLegacyBaseUrl();
  if (!raw) {
    throw new Error(
      "AINOBI_VIDEO_RENDER_SERVICE_QUERY_URL (or legacy AINOBI_VIDEO_RENDER_SERVICE_URL) is not configured",
    );
  }
  return trimBaseUrl(raw);
}

export function videoRenderServiceUrl(path: string, target: VideoRenderServiceTarget): string {
  const base =
    target === "render"
      ? resolveVideoRenderServiceRenderBaseUrl()
      : resolveVideoRenderServiceQueryBaseUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Base URL of the student-view frontend (no trailing slash) — builds the `courseware-renderer` URL handed to the headless browser. */
export function resolveStudentViewBaseUrl(): string {
  const raw = process.env.AINOBI_STUDENT_VIEW_BASE_URL?.trim();
  if (!raw) {
    throw new Error("AINOBI_STUDENT_VIEW_BASE_URL is not configured");
  }
  return raw.replace(/\/+$/, "");
}

/** Base URL at which ainobi-video-render-service can reach *this* service (no trailing slash) — used to build the `/courseware/render/callback` webhook URL handed to it on task creation. */
export function resolveCoursewareAgentBaseUrl(): string {
  const raw = process.env.AINOBI_COURSEWARE_AGENT_BASE_URL?.trim();
  if (!raw) {
    throw new Error("AINOBI_COURSEWARE_AGENT_BASE_URL is not configured");
  }
  return raw.replace(/\/+$/, "");
}

/** Full callback URL handed to ainobi-video-render-service when creating a render task. */
export function coursewareRenderCallbackUrl(): string {
  return `${resolveCoursewareAgentBaseUrl()}/courseware/render/callback`;
}

/**
 * Shared secret used in both directions between this service and ainobi-video-render-service:
 * sent as `x-ainobi-internal-token` on every outbound call to its `/render/tasks*`, and expected
 * back as the same header on its inbound `/courseware/render/callback` webhook. That service's
 * only auth path is this shared secret (it's intranet-only with no end-user-facing API), and this
 * proxy has already verified the requesting user's own access to the courseware (org membership /
 * share / public / section-binding) before ever reaching either call. Must match
 * ainobi-video-render-service's own `AINOBI_VIDEO_RENDER_INTERNAL_TOKEN`.
 */
export function resolveVideoRenderInternalToken(): string {
  const raw = process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN?.trim();
  if (!raw) {
    throw new Error("AINOBI_VIDEO_RENDER_INTERNAL_TOKEN is not configured");
  }
  return raw;
}

/** Fail-closed check for the inbound `/courseware/render/callback` webhook's `x-ainobi-internal-token` header. */
export function isValidVideoRenderCallbackToken(provided: string | null | undefined): boolean {
  const expected = process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN?.trim();
  if (!expected || !provided?.trim()) {
    return false;
  }
  const a = Buffer.from(provided.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
