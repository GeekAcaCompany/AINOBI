// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import type { RenderTaskEntity } from "../models/render-task-entity.ts";
import {
  _resetRenderTaskCallbackDedupeForTests,
  notifyRenderTaskCallback,
  notifyRenderTaskProgressCallback,
} from "./render-task-callback.ts";

function withInternalTokenEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN;
  if (value === undefined) delete process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN;
  else process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN = value;
  const restore = () => {
    if (previous === undefined) delete process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN;
    else process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN = previous;
  };
  let result: T;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  // Async bodies read the token after their first await; restore only once they settle.
  if (result instanceof Promise) {
    return result.finally(restore) as T;
  }
  restore();
  return result;
}

function makeTask(overrides: Partial<RenderTaskEntity> = {}): RenderTaskEntity {
  const now = new Date();
  return {
    id: "task-1",
    orgId: null,
    userId: null,
    coursewareId: "cw-1",
    status: "completed",
    stage: null,
    progress: 100,
    framesRendered: null,
    totalFrames: null,
    request: { url: "https://example.com/render-target" },
    result: null,
    errorMessage: null,
    retryCount: 0,
    queuedAt: now,
    startedAt: now,
    heartbeatAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as RenderTaskEntity;
}

async function withMockedFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("notifyRenderTaskCallback is a no-op when the task has no callbackUrl", async () => {
  _resetRenderTaskCallbackDedupeForTests();
  let called = false;
  await withMockedFetch(
    (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
    () => notifyRenderTaskCallback(makeTask()),
  );
  assert.equal(called, false);
});

test("notifyRenderTaskCallback is a no-op when no internal token is configured", async () => {
  _resetRenderTaskCallbackDedupeForTests();
  let called = false;
  await withInternalTokenEnv(undefined, () =>
    withMockedFetch(
      (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      () =>
        notifyRenderTaskCallback(
          makeTask({ request: { url: "https://x", callbackUrl: "https://agent.example.com/callback" } }),
        ),
    ),
  );
  assert.equal(called, false);
});

test("notifyRenderTaskCallback POSTs the task with the internal token header", async () => {
  _resetRenderTaskCallbackDedupeForTests();
  const calls: { url: string; init?: RequestInit }[] = [];
  await withInternalTokenEnv("shared-secret", () =>
    withMockedFetch(
      (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      () =>
        notifyRenderTaskCallback(
          makeTask({ request: { url: "https://x", callbackUrl: "https://agent.example.com/callback" } }),
        ),
    ),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://agent.example.com/callback");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["x-ainobi-internal-token"], "shared-secret");
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.equal(body.task.id, "task-1");
  assert.equal(body.task.status, "completed");
});

test("notifyRenderTaskCallback retries on failure and eventually gives up without throwing", async () => {
  _resetRenderTaskCallbackDedupeForTests();
  let attempts = 0;
  await withInternalTokenEnv("shared-secret", () =>
    withMockedFetch(
      (async () => {
        attempts += 1;
        return new Response("{}", { status: 500 });
      }) as typeof fetch,
      () =>
        notifyRenderTaskCallback(
          makeTask({ request: { url: "https://x", callbackUrl: "https://agent.example.com/callback" } }),
        ),
    ),
  );
  assert.equal(attempts, 3);
});

test("notifyRenderTaskCallback stops retrying once a call succeeds", async () => {
  _resetRenderTaskCallbackDedupeForTests();
  let attempts = 0;
  await withInternalTokenEnv("shared-secret", () =>
    withMockedFetch(
      (async () => {
        attempts += 1;
        return new Response("{}", { status: attempts < 2 ? 500 : 200 });
      }) as typeof fetch,
      () =>
        notifyRenderTaskCallback(
          makeTask({ request: { url: "https://x", callbackUrl: "https://agent.example.com/callback" } }),
        ),
    ),
  );
  assert.equal(attempts, 2);
});

test("notifyRenderTaskProgressCallback throttles locally when Redis is unavailable", async () => {
  _resetRenderTaskCallbackDedupeForTests();
  const prevHost = process.env.REDIS_HOST;
  delete process.env.REDIS_HOST;

  let attempts = 0;
  try {
    await withInternalTokenEnv("shared-secret", () =>
      withMockedFetch(
        (async () => {
          attempts += 1;
          return new Response("{}", { status: 200 });
        }) as typeof fetch,
        async () => {
          const running = makeTask({
            status: "running",
            progress: 20,
            request: { url: "https://x", callbackUrl: "https://agent.example.com/callback" },
          });
          await notifyRenderTaskProgressCallback(running);
          await notifyRenderTaskProgressCallback({ ...running, progress: 21 });
          await notifyRenderTaskProgressCallback({ ...running, progress: 40 });
        },
      ),
    );
  } finally {
    if (prevHost === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = prevHost;
  }

  // First call sends; +1 within interval/delta skipped; +20 still skipped by interval.
  assert.equal(attempts, 1);
});
