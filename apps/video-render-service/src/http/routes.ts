// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  authorizeRequest,
  isPublicRoute,
  sendUnauthorized,
} from "../api-auth.ts";
import { checkVideoRenderRuntimeDependencies, isRenderFunctionRole } from "../config/video-render.ts";
import { applyCorsHeaders, sendCorsPreflight } from "./cors.ts";
import { isClientFacingError, resolveErrorStatus } from "./http-error.ts";
import { attachHttpRequestLogging, formatErrorDetail, requestLogContext } from "./request-log.ts";
import { handleRenderTasksRoute } from "./handlers/render-tasks.ts";
import { handleVideoRenderRequest } from "./handlers/video-render.ts";
import { isRouteAllowedForFunctionRole } from "./function-role.ts";
import { requestPathname, sendJson } from "./request.ts";

/**
 * HTTP API (routing uses pathname only; query strings are not part of the path match).
 *
 * This service is intranet-only with a single trusted caller (ainobi-courseware-agent), so auth is
 * a shared secret only: every non-public request must carry a matching `x-ainobi-internal-token`
 * header (`AINOBI_VIDEO_RENDER_INTERNAL_TOKEN`). There is no end-user session/Bearer auth path.
 *
 * On Aliyun FC the deploy is split into two functions (`AINOBI_VIDEO_RENDER_FUNCTION_ROLE`):
 * - `query`: stateless, high concurrency — create/list/get/delete/retry (+ health)
 * - `render`: session affinity + `instanceConcurrency=1` — run/cancel (+ sync video)
 * Local dev uses role `all` (default) on a single process.
 *
 * Create/retry (on **query**) return immediately after persisting the task, then query
 * Async-invokes `POST /render/tasks/:id/run` on the **render** function:
 * - On FC: `X-Fc-Invocation-Type: Async` + `ainobi-render-task-id` on the render invoke
 * - Locally: fire-and-forget in-process (no instance freeze)
 * Clients must send `ainobi-render-task-id: <uuid>` on create (client-generated task id).
 * Cancel must hit **render** with the same header so affinity + AbortController can stop
 * an in-flight render.
 *
 * | Method | Path | Auth | Notes |
 * |--------|------|------|-------|
 * | GET | /health | public | Liveness |
 * | POST | /render/video | internal token | Render page animation to MP4 synchronously (optional OSS upload) |
 * | POST | /render/tasks | internal token | Create queued task (returns immediately); requires `ainobi-render-task-id` |
 * | GET | /render/tasks | internal token | List render tasks (`coursewareId`/`userId`/`status`/`cursor`/`limit`) |
 * | GET | /render/tasks/:id | internal token | Get one task's status/progress/result |
 * | POST | /render/tasks/:id/run | internal token | Blocking render worker (FC Async / local fire-and-forget target) |
 * | POST | /render/tasks/:id/chunks/:index/run | internal token | Distributed chunk worker |
 * | POST | /render/tasks/:id/assemble | internal token | Distributed assemble worker |
 * | POST | /render/tasks/:id/retry | internal token | Re-queue a `failed`/`interrupted` task and schedule `/run` |
 * | POST | /render/tasks/:id/cancel | internal token | Cancel a `queued` or `running` task |
 * | DELETE | /render/tasks/:id | internal token | Delete a terminal task and its OSS assets |
 */
export function createHttpHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    applyCorsHeaders(res);

    if (req.method === "OPTIONS") {
      sendCorsPreflight(res);
      return;
    }

    const pathname = requestPathname(req.url);
    const method = req.method ?? "GET";
    const logCtx = requestLogContext(req, pathname);
    const handlerError = { current: undefined as unknown };

    attachHttpRequestLogging(req, res, logCtx, () => ({
      error: handlerError.current,
    }));

    try {
      const authorized = await authorizeRequest(req);
      if (!isPublicRoute(method, pathname) && !authorized) {
        sendUnauthorized(res);
        return;
      }

      if (!isRouteAllowedForFunctionRole(method, pathname)) {
        sendJson(res, 404, { ok: false, error: "Not found" });
        return;
      }

      if (method === "GET" && pathname === "/health") {
        if (isRenderFunctionRole()) {
          const runtime = checkVideoRenderRuntimeDependencies();
          sendJson(res, 200, {
            ok: true,
            runtime: { ok: runtime.ok, warnings: runtime.warnings, errors: runtime.errors },
          });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && pathname === "/render/video") {
        await handleVideoRenderRequest(req, res);
        return;
      }

      if (pathname === "/render/tasks" || pathname.startsWith("/render/tasks/")) {
        const handled = await handleRenderTasksRoute(req, res, pathname);
        if (handled) {
          return;
        }
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      handlerError.current = error;
      if (!res.headersSent) {
        const status = resolveErrorStatus(error);
        // Only surface the real message for errors we intentionally designed to be
        // client-safe (validation, SSRF blocks, auth/authz, payload-too-large).
        // Unexpected exceptions get a generic message so internals never leak.
        const message =
          isClientFacingError(error) && error instanceof Error && error.message.trim()
            ? error.message
            : "Internal server error";
        sendJson(res, status, { ok: false, error: message });
        return;
      }
      console.error('[http] FAIL after headers sent', {
        method,
        pathname,
        detail: formatErrorDetail(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
    }
  };
}
