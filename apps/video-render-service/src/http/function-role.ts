// SPDX-License-Identifier: AGPL-3.0-only
import {
  resolveFunctionRole,
  type VideoRenderFunctionRole,
} from "../config/video-render.ts";
import { resolveRenderJobDispatchEnabled } from "../services/k8s-jobs.ts";

/** Whether this route is served by the current FC function role (`all` serves everything). */
export function isRouteAllowedForFunctionRole(
  method: string,
  pathname: string,
  role: VideoRenderFunctionRole = resolveFunctionRole(),
): boolean {
  if (role === "all") {
    return true;
  }

  if (method === "GET" && pathname === "/health") {
    return true;
  }

  if (role === "render") {
    if (method === "POST" && pathname === "/render/video") {
      return true;
    }
    if (method === "POST" && /^\/render\/tasks\/[^/]+\/chunks\/[^/]+\/run$/.test(pathname)) {
      return true;
    }
    const taskRoute = pathname.match(/^\/render\/tasks\/([^/]+)(?:\/([^/]+))?$/);
    if (taskRoute) {
      const action = taskRoute[2];
      if (!action) {
        return false;
      }
      return (
        method === "POST" &&
        (action === "run" || action === "cancel" || action === "assemble")
      );
    }
    return false;
  }

  if (role === "query") {
    if (pathname === "/render/tasks" && (method === "GET" || method === "POST")) {
      return true;
    }
    const taskRoute = pathname.match(/^\/render\/tasks\/([^/]+)(?:\/([^/]+))?$/);
    if (taskRoute) {
      const action = taskRoute[2];
      if (!action) {
        return method === "GET" || method === "DELETE";
      }
      // Job-dispatch mode: serve cancel here too. The render executions are
      // ephemeral Job pods that poll the DB cancel flag every 3s, so marking the
      // row cancelled is the whole job — no need to reach the FC affinity session
      // (the render-role route stays for non-job dispatch).
      if (method === "POST" && action === "cancel" && resolveRenderJobDispatchEnabled()) {
        return true;
      }
      return method === "POST" && action === "retry";
    }
    return false;
  }

  return false;
}
