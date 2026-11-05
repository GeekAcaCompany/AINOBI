// SPDX-License-Identifier: AGPL-3.0-only
/** In-flight render abort handles — keyed by task id or `taskId:chunk:N` / `taskId:assemble`. */
const abortControllersByKey = new Map<string, AbortController>();

export function registerRenderTaskAbortController(taskId: string): AbortSignal {
  const existing = abortControllersByKey.get(taskId);
  if (existing) {
    return existing.signal;
  }
  const controller = new AbortController();
  abortControllersByKey.set(taskId, controller);
  return controller.signal;
}

export function unregisterRenderTaskAbortController(taskId: string): void {
  abortControllersByKey.delete(taskId);
}

/** Returns true when an in-flight abort was signaled on this instance (task + chunk/assemble keys). */
export function abortRenderTaskExecution(taskId: string): boolean {
  let any = false;
  for (const [key, controller] of abortControllersByKey) {
    if (key !== taskId && !key.startsWith(`${taskId}:`)) {
      continue;
    }
    if (!controller.signal.aborted) {
      controller.abort();
      any = true;
    }
  }
  return any;
}

/** Exact-key check (does not match child keys like `taskId:chunk:0`). */
export function isRenderTaskAbortRegistered(taskId: string): boolean {
  return abortControllersByKey.has(taskId);
}
