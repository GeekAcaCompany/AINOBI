// SPDX-License-Identifier: AGPL-3.0-only
import { isRunningOnAliyunFc, resolveFunctionRole } from "./config/video-render.ts";

/**
 * FC render worker: one task per instance — exit after `/run` finishes to release
 * browser/memory. Uses explicit `AINOBI_VIDEO_RENDER_FUNCTION_ROLE=render` from
 * s.*.yaml (FC custom runtime may not inject FC_FUNCTION_NAME).
 *
 * Kubernetes workers are long-lived Deployment pods — they must NOT exit after a
 * task, so this stays FC-only.
 *
 * OS-level chrome cleanup is handled by `public/bootstrap` (EXIT trap) when Node exits.
 */
export function shouldExitFcRenderInstanceAfterTask(): boolean {
  return isRunningOnAliyunFc() && resolveFunctionRole() === "render";
}

let exitHandler: ((reason: string) => void) | null = null;
let exitRequested = false;

export function registerFcRenderInstanceExitHandler(handler: (reason: string) => void): void {
  exitHandler = handler;
}

export function requestFcRenderInstanceExit(reason: string): void {
  if (!shouldExitFcRenderInstanceAfterTask() || exitRequested) {
    return;
  }
  exitRequested = true;
  console.info(`[fc-lifecycle] ${reason}`);
  if (exitHandler) {
    exitHandler(reason);
  } else {
    process.exit(0);
  }
}

/** Test-only: reset exit guard between cases. */
export function _resetFcRenderInstanceExitForTests(): void {
  exitRequested = false;
  exitHandler = null;
}
