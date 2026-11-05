// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  applyDesignTemplateMentionSelection,
  formatDesignTemplateMentionInsertToken,
  formatDesignTemplateMentionsForDisplay,
  parseReferencedDesignTemplatesFromText,
  type ReferencedDesignTemplateItem,
} from "./ai-design-template-mentions.ts";

const registry: ReferencedDesignTemplateItem[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "品牌蓝科技风" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Editorial Light" },
];

describe("ai-design-template-mentions", () => {
  it("formats display insert token (no wire UUID in input)", () => {
    const token = formatDesignTemplateMentionInsertToken(registry[0]!);
    expect(token).toBe("@品牌蓝科技风 ");
    expect(token).not.toContain("design_template:");
    expect(formatDesignTemplateMentionsForDisplay("@[品牌蓝科技风](design_template:11111111-1111-4111-8111-111111111111)")).toBe(
      "@品牌蓝科技风",
    );
  });

  it("parses bracket tokens from chat text", () => {
    const wire = `@[${registry[0]!.name}](design_template:${registry[0]!.id})`;
    const text = `请按 ${wire} 的风格改版`;
    const parsed = parseReferencedDesignTemplatesFromText(text, registry);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(registry[0]!.id);
  });

  it("applyDesignTemplateMentionSelection replaces active @ query with display @name", () => {
    const start = "请参考 @品".length - 2;
    const { text, cursor } = applyDesignTemplateMentionSelection(
      "请参考 @品",
      start,
      "请参考 @品".length,
      registry[0]!,
    );
    expect(text).toBe("请参考 @品牌蓝科技风 ");
    expect(text).not.toContain("design_template:");
    expect(cursor).toBe(text.length);
  });
});
