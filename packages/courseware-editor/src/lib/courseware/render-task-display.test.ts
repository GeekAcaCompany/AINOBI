// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  formatRenderTaskDurationMs,
  resolveRenderTaskElapsedLabel,
  resolveRenderTaskElapsedMs,
  resolveRenderTaskProcessLabel,
  resolveRenderTaskVideoDurationLabel,
} from "./render-task-display.ts";

const t = (key: string, variables?: Record<string, string | number>): string => {
  if (key === "coursewareEditor.exportVideo.stageRendering") return "生成画面…";
  if (key === "coursewareEditor.exportVideo.stagePreprocessing") return "分析页面内容…";
  if (key === "coursewareEditor.exportVideo.stagePreparing") return "准备课件…";
  if (key === "coursewareEditor.exportVideo.stagePlanning") return "规划渲染…";
  if (key === "coursewareEditor.exportVideo.stageAssembling") return "合并音画…";
  if (key === "coursewareEditor.exportVideo.stageRenderingFrames" && variables) {
    return `${variables.stage} ${variables.current}/${variables.total}`;
  }
  if (key === "coursewareEditor.exportVideo.durationSeconds" && variables) {
    return `${variables.seconds}秒`;
  }
  if (key === "coursewareEditor.exportVideo.durationMinutesSeconds" && variables) {
    return `${variables.minutes}分${variables.seconds}秒`;
  }
  if (key === "coursewareEditor.exportVideo.durationHoursMinutes" && variables) {
    return `${variables.hours}小时${variables.minutes}分`;
  }
  if (key === "coursewareEditor.exportVideo.elapsed" && variables) {
    return `耗时 ${variables.duration}`;
  }
  if (key === "coursewareEditor.exportVideo.elapsedRunning" && variables) {
    return `已用 ${variables.duration}`;
  }
  if (key === "coursewareEditor.exportVideo.videoDuration" && variables) {
    return `时长 ${variables.duration}`;
  }
  return key;
};

describe("resolveRenderTaskProcessLabel", () => {
  it("appends frame counters during rendering", () => {
    expect(
      resolveRenderTaskProcessLabel(
        {
          status: "running",
          stage: "rendering",
          framesRendered: 120,
          totalFrames: 1800,
        },
        t,
      ),
    ).toBe("生成画面… 120/1800");
  });

  it("omits frames outside rendering stage", () => {
    expect(
      resolveRenderTaskProcessLabel(
        {
          status: "running",
          stage: "preprocessing",
          framesRendered: 10,
          totalFrames: 1800,
        },
        t,
      ),
    ).toBe("分析页面内容…");
  });

  it("maps distributed planning / chunking / assembling stages", () => {
    expect(
      resolveRenderTaskProcessLabel({ status: "running", stage: "planning" }, t),
    ).toBe("规划渲染…");
    expect(
      resolveRenderTaskProcessLabel(
        {
          status: "running",
          stage: "chunking",
          framesRendered: 4200,
          totalFrames: 21000,
        },
        t,
      ),
    ).toBe("生成画面… 4200/21000");
    expect(
      resolveRenderTaskProcessLabel({ status: "running", stage: "assembling" }, t),
    ).toBe("合并音画…");
  });
});

describe("resolveRenderTaskElapsedLabel", () => {
  const baseTask = {
    createdAt: "2026-07-09T08:00:00.000Z",
    queuedAt: "2026-07-09T08:00:00.000Z",
    startedAt: "2026-07-09T08:00:10.000Z",
    completedAt: "2026-07-09T08:03:22.000Z",
    result: { render: { takes: 192_000 } },
  };

  it("formats completed task elapsed time", () => {
    const label = resolveRenderTaskElapsedLabel(
      { ...baseTask, status: "completed" },
      t,
    );
    expect(label).toBe("耗时 3分12秒");
  });

  it("formats running task elapsed time", () => {
    const label = resolveRenderTaskElapsedLabel(
      { ...baseTask, status: "running", completedAt: null },
      t,
      new Date("2026-07-09T08:01:15.000Z").getTime(),
    );
    expect(label).toBe("已用 1分5秒");
  });

  it("resolveRenderTaskElapsedMs prefers completedAt over render.takes", () => {
    expect(
      resolveRenderTaskElapsedMs({ ...baseTask, status: "completed" }),
    ).toBe(192_000);
    expect(formatRenderTaskDurationMs(192_000, t)).toBe("3分12秒");
  });
});

describe("resolveRenderTaskVideoDurationLabel", () => {
  it("formats completed video content duration", () => {
    expect(
      resolveRenderTaskVideoDurationLabel(
        {
          status: "completed",
          result: { render: { duration: 62_462 } },
        },
        t,
      ),
    ).toBe("时长 1分2秒");
  });

  it("returns null when not completed or duration missing", () => {
    expect(
      resolveRenderTaskVideoDurationLabel(
        { status: "running", result: { render: { duration: 62_462 } } },
        t,
      ),
    ).toBeNull();
    expect(
      resolveRenderTaskVideoDurationLabel({ status: "completed", result: null }, t),
    ).toBeNull();
  });
});
