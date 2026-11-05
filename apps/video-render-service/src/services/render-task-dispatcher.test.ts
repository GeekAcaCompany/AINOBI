// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFcTimeoutErrorMessage,
  resolveRenderTaskFcTimeoutMs,
  resolveRenderTaskSoftTimeoutBufferMs,
  resolveRenderTaskSoftTimeoutMs,
} from "../config/video-render.ts";
import {
  abortRenderTaskExecution,
  isRenderTaskAbortRegistered,
  registerRenderTaskAbortController,
  unregisterRenderTaskAbortController,
} from "./render-task-abort.ts";
import {
  abortRenderTaskIfCancelledInDb,
  isRenderTaskHeartbeatStale,
  isRenderTaskPastFcTimeout,
  resolveRenderAbortTerminal,
} from "./render-task-dispatcher.ts";
import { toUserFacingRenderErrorMessage } from "./render-error-message.ts";

test("abortRenderTaskIfCancelledInDb signals abort when DB shows cancelled", async () => {
  const taskId = "task-cancel-poll-test";
  const signal = registerRenderTaskAbortController(taskId);
  assert.equal(signal.aborted, false);

  try {
    const aborted = await abortRenderTaskIfCancelledInDb(taskId, signal, async () => true);
    assert.equal(aborted, true);
    assert.equal(signal.aborted, true);
  } finally {
    unregisterRenderTaskAbortController(taskId);
  }
});

test("abortRenderTaskIfCancelledInDb is a no-op when DB is not cancelled", async () => {
  const taskId = "task-still-running-test";
  const signal = registerRenderTaskAbortController(taskId);

  try {
    const aborted = await abortRenderTaskIfCancelledInDb(taskId, signal, async () => false);
    assert.equal(aborted, false);
    assert.equal(signal.aborted, false);
    assert.equal(isRenderTaskAbortRegistered(taskId), true);
  } finally {
    unregisterRenderTaskAbortController(taskId);
  }
});

test("abortRenderTaskIfCancelledInDb returns true when signal already aborted", async () => {
  const taskId = "task-already-aborted-test";
  const signal = registerRenderTaskAbortController(taskId);
  abortRenderTaskExecution(taskId);

  try {
    const aborted = await abortRenderTaskIfCancelledInDb(taskId, signal, async () => false);
    assert.equal(aborted, true);
  } finally {
    unregisterRenderTaskAbortController(taskId);
  }
});

test("resolveRenderAbortTerminal: soft timeout beats abortSignal.aborted (not cancelled)", () => {
  assert.equal(resolveRenderAbortTerminal(true, true), "failed_timeout");
  assert.equal(resolveRenderAbortTerminal(true, false), "failed_timeout");
  assert.equal(resolveRenderAbortTerminal(false, true), "cancelled");
  assert.equal(resolveRenderAbortTerminal(false, false), "error");
});

test("isRenderTaskPastFcTimeout uses startedAt wall clock", () => {
  const now = Date.parse("2026-07-21T17:05:04Z");
  const fcTimeoutMs = 7_200_000;
  assert.equal(
    isRenderTaskPastFcTimeout(
      { startedAt: new Date(now - fcTimeoutMs) },
      fcTimeoutMs,
      now,
    ),
    true,
  );
  assert.equal(
    isRenderTaskPastFcTimeout(
      { startedAt: new Date(now - fcTimeoutMs + 1) },
      fcTimeoutMs,
      now,
    ),
    false,
  );
  assert.equal(isRenderTaskPastFcTimeout({ startedAt: null }, fcTimeoutMs, now), false);
});

test("isRenderTaskHeartbeatStale falls back to startedAt", () => {
  const now = Date.parse("2026-07-21T15:20:00Z");
  const staleMs = 300_000;
  assert.equal(
    isRenderTaskHeartbeatStale(
      { heartbeatAt: new Date(now - staleMs), startedAt: new Date(now - 60_000) },
      staleMs,
      now,
    ),
    true,
  );
  assert.equal(
    isRenderTaskHeartbeatStale(
      { heartbeatAt: null, startedAt: new Date(now - staleMs) },
      staleMs,
      now,
    ),
    true,
  );
  assert.equal(
    isRenderTaskHeartbeatStale(
      { heartbeatAt: new Date(now - 1_000), startedAt: new Date(now - staleMs) },
      staleMs,
      now,
    ),
    false,
  );
});

test("formatFcTimeoutErrorMessage maps to product timeout copy", () => {
  const raw = formatFcTimeoutErrorMessage(28_800_000);
  assert.equal(raw, "Function timed out after 28800 seconds");
  assert.equal(toUserFacingRenderErrorMessage(raw), "渲染超时，请稍后重试");
});

test("soft timeout is fcTimeout minus buffer", () => {
  const prevFc = process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS;
  const prevBuf = process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS;
  try {
    process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS = "28800000";
    process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS = "120000";
    assert.equal(resolveRenderTaskFcTimeoutMs(), 28_800_000);
    assert.equal(resolveRenderTaskSoftTimeoutBufferMs(), 120_000);
    assert.equal(resolveRenderTaskSoftTimeoutMs(), 28_680_000);
  } finally {
    if (prevFc === undefined) delete process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS;
    else process.env.AINOBI_VIDEO_RENDER_FC_TIMEOUT_MS = prevFc;
    if (prevBuf === undefined) delete process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS;
    else process.env.AINOBI_VIDEO_RENDER_SOFT_TIMEOUT_BUFFER_MS = prevBuf;
  }
});

test("distributed active phases skip heartbeat interrupt (FC timeout still applies)", () => {
  const now = Date.parse("2026-07-22T06:00:00Z");
  const fcTimeoutMs = 28_800_000;
  // Same wall-clock checks used by reconcile for distributed parents.
  assert.equal(
    isRenderTaskPastFcTimeout(
      { startedAt: new Date(now - fcTimeoutMs) },
      fcTimeoutMs,
      now,
    ),
    true,
  );
  assert.equal(
    isRenderTaskHeartbeatStale(
      { heartbeatAt: new Date(now - 600_000), startedAt: new Date(now - 600_000) },
      300_000,
      now,
    ),
    true,
  );
});
