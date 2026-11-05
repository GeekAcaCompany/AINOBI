// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { buildReferenceSceneBrief } from "./reference-scene-brief.ts";

describe("buildReferenceSceneBrief", () => {
  it("summarizes slide children for agent inspection", () => {
    const brief = buildReferenceSceneBrief({
      scene_id: "scene_1",
      name: "AWS Demo",
      slide_elements: [
        {
          element_id: "slide_cover",
          name: "封面",
          background_color: "#FFFDF5",
          children_elements: [
            {
              element_id: "el_title",
              element_type: "text",
              name: "title",
              text: "AWS 入门",
              position: { x: 120, y: 200 },
              size: { width: 800, height: 120 },
              color: "#2D3A4B",
              font_size: 64,
            },
          ],
        },
      ],
    });
    expect(brief.slide_count).toBe(1);
    expect(brief.slides[0]?.name).toBe("封面");
    expect(brief.slides[0]?.children[0]?.text_preview).toBe("AWS 入门");
    expect(brief.slides[0]?.children[0]?.position).toEqual({ x: 120, y: 200 });
  });

  it("default (content extract) keeps slide names and topical copy", () => {
    const brief = buildReferenceSceneBrief({
      scene_id: "scene_1",
      name: "急症病例",
      slide_elements: [
        {
          element_id: "slide_cover",
          name: "病例导入",
          background_color: "#FFFFFF",
          children_elements: [
            {
              element_id: "el_title",
              element_type: "text",
              name: "title",
              text: "胸痛鉴别与处置",
              position: { x: 120, y: 200 },
              size: { width: 800, height: 120 },
              color: "#111111",
              font_size: 48,
            },
          ],
        },
      ],
    });
    expect(brief.name).toBe("急症病例");
    expect(brief.slides[0]?.name).toBe("病例导入");
    expect(brief.slides[0]?.children[0]?.text_preview).toBe("胸痛鉴别与处置");
  });

  it("styleOnly omits topical copy and aggregates visual signals for design extraction", () => {
    const brief = buildReferenceSceneBrief(
      {
        scene_id: "scene_1",
        name: "HTML测试课件",
        slide_elements: [
          {
            element_id: "slide_cover",
            name: "HTML入门封面",
            background_color: "#1A2B4C",
            children_elements: [
              {
                element_id: "el_title",
                element_type: "text",
                name: "title",
                text: "HTML 标签与结构",
                position: { x: 120, y: 200 },
                size: { width: 800, height: 120 },
                color: "#FFFFFF",
                font_size: 64,
              },
            ],
          },
        ],
      },
      { styleOnly: true },
    );

    expect(brief.name).toBeUndefined();
    expect(brief.slides[0]?.name).toBe("slide 1");
    expect(brief.slides[0]?.children[0]?.text_preview).toBeUndefined();
    expect(brief.slides[0]?.children[0]?.name).toBeUndefined();
    expect(brief.style_signals).toEqual({
      colors: ["#FFFFFF"],
      background_colors: ["#1A2B4C"],
      font_sizes: [64],
      element_types: { text: 1 },
    });
  });
});
