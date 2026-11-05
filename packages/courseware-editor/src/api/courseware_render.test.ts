// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRenderTask,
  deleteRenderTask,
  isRenderTaskActive,
  isRenderTaskDeletable,
  isRenderTaskRetryable,
  listRenderTasks,
  type RenderTaskDto,
} from "./courseware_render.ts";
import { coursewareApi } from "@ainobi/courseware-player/host/requester";

vi.mock("@ainobi/courseware-player/host/requester", () => ({
  coursewareApi: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeTask(overrides: Partial<RenderTaskDto> = {}): RenderTaskDto {
  return {
    id: "task-1",
    orgId: null,
    userId: null,
    coursewareId: "cw-1",
    status: "queued",
    stage: null,
    progress: 0,
    framesRendered: null,
    totalFrames: null,
    request: { url: "https://example.com/courseware-renderer" },
    result: null,
    errorMessage: null,
    retryCount: 0,
    queuedAt: null,
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isRenderTaskActive", () => {
  it("treats queued and running as active", () => {
    expect(isRenderTaskActive(makeTask({ status: "queued" }))).toBe(true);
    expect(isRenderTaskActive(makeTask({ status: "running" }))).toBe(true);
  });

  it("treats terminal statuses as inactive", () => {
    for (const status of ["completed", "failed", "interrupted", "cancelled"] as const) {
      expect(isRenderTaskActive(makeTask({ status }))).toBe(false);
    }
  });
});

describe("isRenderTaskRetryable", () => {
  it("allows retry from failed/interrupted under the max-retries cap", () => {
    expect(isRenderTaskRetryable(makeTask({ status: "failed", retryCount: 1 }), 3)).toBe(true);
    expect(isRenderTaskRetryable(makeTask({ status: "interrupted", retryCount: 2 }), 3)).toBe(true);
  });

  it("rejects retry once the max-retries cap is reached", () => {
    expect(isRenderTaskRetryable(makeTask({ status: "failed", retryCount: 3 }), 3)).toBe(false);
  });

  it("rejects retry from non-terminal or already-terminal-non-retryable statuses", () => {
    for (const status of ["queued", "running", "completed", "cancelled"] as const) {
      expect(isRenderTaskRetryable(makeTask({ status, retryCount: 0 }), 3)).toBe(false);
    }
  });
});

describe("isRenderTaskDeletable", () => {
  it("allows deleting terminal tasks", () => {
    for (const status of ["completed", "failed", "interrupted", "cancelled"] as const) {
      expect(isRenderTaskDeletable(makeTask({ status }))).toBe(true);
    }
  });

  it("rejects deleting active tasks", () => {
    for (const status of ["queued", "running"] as const) {
      expect(isRenderTaskDeletable(makeTask({ status }))).toBe(false);
    }
  });
});

describe("deleteRenderTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls DELETE with agent response options (not as request body)", async () => {
    vi.mocked(coursewareApi.delete).mockResolvedValue({ ok: true });

    const result = await deleteRenderTask("task-1");

    expect(coursewareApi.delete).toHaveBeenCalledWith(
      "/courseware/render/tasks/task-1",
      undefined,
      expect.objectContaining({ responseShape: "agent", agentErrorAsResult: true }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("surfaces a server-reported error without throwing", async () => {
    vi.mocked(coursewareApi.delete).mockResolvedValue({ ok: false, error: "not found" });

    const result = await deleteRenderTask("task-1");

    expect(result).toEqual({ ok: false, error: "not found" });
  });
});

describe("createRenderTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts to /courseware/render/tasks with coursewareId and resolution", async () => {
    const task = makeTask();
    vi.mocked(coursewareApi.post).mockResolvedValue({ ok: true, task });

    const result = await createRenderTask("cw-1", { width: 1920, height: 1080 });

    expect(coursewareApi.post).toHaveBeenCalledWith(
      "/courseware/render/tasks",
      expect.objectContaining({ coursewareId: "cw-1", width: 1920, height: 1080 }),
      expect.objectContaining({ responseShape: "agent", agentErrorAsResult: true }),
    );
    expect(result).toEqual({ ok: true, task });
  });

  it("surfaces a server-reported error without throwing", async () => {
    vi.mocked(coursewareApi.post).mockResolvedValue({ ok: false, error: "forbidden" });

    const result = await createRenderTask("cw-1");

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("catches transport errors and returns them as a result", async () => {
    vi.mocked(coursewareApi.post).mockRejectedValue(new Error("network down"));

    const result = await createRenderTask("cw-1");

    expect(result).toEqual({ ok: false, error: "network down" });
  });
});

describe("listRenderTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gets /courseware/render/tasks with coursewareId query", async () => {
    const tasks = [makeTask()];
    vi.mocked(coursewareApi.get).mockResolvedValue({ ok: true, tasks, nextCursor: null });

    const result = await listRenderTasks("cw-1", { status: "failed", limit: 10 });

    expect(coursewareApi.get).toHaveBeenCalledWith(
      "/courseware/render/tasks",
      expect.objectContaining({ coursewareId: "cw-1", status: "failed", limit: 10 }),
      expect.objectContaining({ responseShape: "agent", agentErrorAsResult: true }),
    );
    expect(result).toEqual({ ok: true, tasks, nextCursor: null });
  });

  it("defaults tasks to an empty array when the server omits it", async () => {
    vi.mocked(coursewareApi.get).mockResolvedValue({ ok: true });

    const result = await listRenderTasks("cw-1");

    expect(result).toEqual({ ok: true, tasks: [], nextCursor: null });
  });
});
