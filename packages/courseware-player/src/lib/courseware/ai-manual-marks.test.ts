// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  buildChatInputWithManualMarks,
  buildManualMarksEditorContextSection,
  clampManualMarkRect,
  displayToLogicalMarkRect,
  formatManualMarkToken,
  formatManualMarksForDisplay,
  splitAiPanelRichTextSegments,
  syncManualMarkRegionsFromChatInput,
} from "./ai-manual-marks.ts";
import { formatAssetMentionToken } from "./ai-asset-mentions.ts";
import { formatContentTemplateMentionToken } from "./ai-content-template-mentions.ts";
import { formatDesignTemplateMentionToken } from "./ai-design-template-mentions.ts";
import { formatCoursewareMentionToken } from "./ai-courseware-mentions.ts";

describe("ai-manual-marks", () => {
  it("clamps rects to slide bounds", () => {
    const r = clampManualMarkRect(-10, -10, 2000, 1200)!;
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBeLessThanOrEqual(1920);
    expect(r.height).toBeLessThanOrEqual(1080);
  });

  it("converts display pixels to logical coords", () => {
    const r = displayToLogicalMarkRect(96, 54, 192, 108, 0.1);
    expect(r.x).toBeCloseTo(960, 0);
    expect(r.y).toBeCloseTo(540, 0);
    expect(r.width).toBeCloseTo(960, 0);
    expect(r.height).toBeCloseTo(540, 0);
  });

  it("merges mark tokens into chat input", () => {
    const merged = buildChatInputWithManualMarks("请改标题", [
      {
        markId: "m1",
        index: 1,
        description: "放大",
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
      },
    ]);
    expect(merged).toContain("请改标题");
    expect(merged).toContain("标记1:放大");
  });

  it("removes canvas regions when display labels are deleted from chat input", () => {
    const regions = [
      {
        markId: "m1",
        index: 1,
        description: "放大",
        position: { x: 10, y: 20 },
        size: { width: 100, height: 50 },
      },
      {
        markId: "m2",
        index: 2,
        description: "改色",
        position: { x: 200, y: 80 },
        size: { width: 80, height: 40 },
      },
    ];
    const next = syncManualMarkRegionsFromChatInput("请改标题\n标记2:改色", regions);
    expect(next).toHaveLength(1);
    expect(next[0]?.markId).toBe("m2");
    expect(next[0]?.description).toBe("改色");
  });

  it("splitAiPanelRichTextSegments renders file: asset bracket tokens as chips", () => {
    const token = formatAssetMentionToken({ id: "f1", name: "diagram.png" });
    const segments = splitAiPanelRichTextSegments(`请参考 ${token} 修改`);
    const mention = segments.find((s) => s.kind === "assetMention");
    expect(mention).toMatchObject({
      kind: "assetMention",
      name: "diagram.png",
      id: "f1",
      mentionSource: "asset",
    });
  });

  it("splitAiPanelRichTextSegments distinguishes courseware / design / content template sources", () => {
    const cw = formatCoursewareMentionToken({ key: "cw-1", title: "参考课件" });
    const dt = formatDesignTemplateMentionToken({ id: "tpl-1", name: "设计模板" });
    const ct = formatContentTemplateMentionToken({ id: "tpl-2", name: "内容模板" });
    const segments = splitAiPanelRichTextSegments(`${cw} ${dt} ${ct}`);
    expect(segments.filter((s) => s.kind === "assetMention")).toEqual([
      expect.objectContaining({
        name: "参考课件",
        id: "cw-1",
        mentionSource: "courseware",
      }),
      expect.objectContaining({
        name: "设计模板",
        id: "tpl-1",
        mentionSource: "design_template",
      }),
      expect.objectContaining({
        name: "内容模板",
        id: "tpl-2",
        mentionSource: "content_template",
      }),
    ]);
  });

  it("formats tokens and editorContext section", () => {
    const token = formatManualMarkToken(1, "放大标题", "m1");
    expect(formatManualMarksForDisplay(token)).toBe("标记1:放大标题");
    const ctx = buildManualMarksEditorContextSection({
      pageIndex: 0,
      slideId: "slide-a",
      playheadMs: 1500,
      regions: [
        {
          markId: "m1",
          index: 1,
          description: "放大标题",
          position: { x: 100, y: 200 },
          size: { width: 400, height: 120 },
        },
      ],
    });
    expect(ctx).toContain("slide_id: slide-a");
    expect(ctx).toContain("position: { x: 100, y: 200 }");
    expect(ctx).toContain("size: { width: 400, height: 120 }");
    expect(ctx).toContain("需求: 放大标题");
  });
});
