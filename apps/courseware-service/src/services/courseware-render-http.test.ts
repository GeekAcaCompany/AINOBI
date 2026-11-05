// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRendererUrl,
  mergeRenderTaskLists,
  redactRenderTokenFromUrl,
  sanitizeRenderTaskForClient,
} from "./courseware-render-http.ts";

function withStudentViewBaseUrl<T>(baseUrl: string, fn: () => T): T {
  const previous = process.env.AINOBI_STUDENT_VIEW_BASE_URL;
  process.env.AINOBI_STUDENT_VIEW_BASE_URL = baseUrl;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AINOBI_STUDENT_VIEW_BASE_URL;
    else process.env.AINOBI_STUDENT_VIEW_BASE_URL = previous;
  }
}

test("buildRendererUrl embeds courseware key and render_token as query params", () => {
  withStudentViewBaseUrl("https://student.example.com", () => {
    const url = new URL(buildRendererUrl("9064f857-1f37-4083-b6d1-e0f9f2809594", "tok-abc"));
    assert.equal(url.pathname, "/courseware-renderer");
    assert.equal(url.searchParams.get("courseware_id"), "9064f857-1f37-4083-b6d1-e0f9f2809594");
    assert.equal(url.searchParams.get("render_token"), "tok-abc");
  });
});

test("redactRenderTokenFromUrl masks the render_token query param", () => {
  const redacted = redactRenderTokenFromUrl(
    "https://example.com/courseware-renderer?courseware_id=cw-123&render_token=super-secret",
  );
  const url = new URL(redacted);
  assert.equal(url.searchParams.get("render_token"), "[redacted]");
  assert.equal(url.searchParams.get("courseware_id"), "cw-123");
});

test("redactRenderTokenFromUrl is a no-op when there's no render_token param", () => {
  const input = "https://example.com/courseware-renderer?courseware_id=cw-123";
  assert.equal(redactRenderTokenFromUrl(input), input);
});

test("redactRenderTokenFromUrl returns the input unchanged for invalid URLs", () => {
  assert.equal(redactRenderTokenFromUrl("not a url"), "not a url");
});

test("sanitizeRenderTaskForClient redacts render_token inside task.request.url", () => {
  const task = {
    id: "task-1",
    request: {
      url: "https://example.com/courseware-renderer?courseware_id=cw-123&render_token=super-secret",
      width: 1920,
    },
  };
  const sanitized = sanitizeRenderTaskForClient(task);
  const sanitizedRequest = sanitized.request as { url: string; width: number };
  assert.equal(new URL(sanitizedRequest.url).searchParams.get("render_token"), "[redacted]");
  assert.equal(sanitizedRequest.width, 1920);
  // Original object must not be mutated.
  assert.match(task.request.url, /render_token=super-secret/);
});

test("sanitizeRenderTaskForClient passes through tasks without a request.url", () => {
  const task = { id: "task-1", request: { foo: "bar" } };
  assert.deepEqual(sanitizeRenderTaskForClient(task), task);
});

test("sanitizeRenderTaskForClient passes through tasks without a request object", () => {
  const task = { id: "task-1" };
  assert.deepEqual(sanitizeRenderTaskForClient(task), task);
});

test("sanitizeRenderTaskForClient strips the internal-only callbackUrl", () => {
  const task = {
    id: "task-1",
    request: { url: "https://example.com/x", callbackUrl: "http://internal/courseware/render/callback" },
  };
  const sanitized = sanitizeRenderTaskForClient(task);
  assert.equal((sanitized.request as Record<string, unknown>).callbackUrl, undefined);
  assert.equal((sanitized.request as { url: string }).url, "https://example.com/x");
  // Original object must not be mutated.
  assert.equal(task.request.callbackUrl, "http://internal/courseware/render/callback");
});

test("mergeRenderTaskLists de-dupes by id and sorts newest-first", () => {
  const merged = mergeRenderTaskLists(
    [
      { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", createdAt: "2026-01-03T00:00:00.000Z" },
    ],
    [
      { id: "b", createdAt: "2026-01-03T00:00:00.000Z" },
      { id: "c", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: 1 },
      null,
    ],
  );
  assert.deepEqual(
    merged.map((t) => t.id),
    ["b", "c", "a"],
  );
});
