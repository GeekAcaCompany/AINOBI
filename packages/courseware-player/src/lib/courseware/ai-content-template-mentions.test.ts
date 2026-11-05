// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  applyContentTemplateMentionSelection,
  formatContentTemplateMentionInsertToken,
  formatContentTemplateMentionsForDisplay,
  parseReferencedContentTemplatesFromText,
  type ReferencedContentTemplateItem,
} from "./ai-content-template-mentions.ts";

const registry: ReferencedContentTemplateItem[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "医学病例讲解页纲" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Editorial Light" },
];

describe("ai-content-template-mentions", () => {
  it("formats display insert token (no wire UUID in input)", () => {
    const token = formatContentTemplateMentionInsertToken(registry[0]!);
    expect(token).toBe("@医学病例讲解页纲 ");
    expect(token).not.toContain("content_template:");
    expect(formatContentTemplateMentionsForDisplay("@[医学病例讲解页纲](content_template:11111111-1111-4111-8111-111111111111)")).toBe(
      "@医学病例讲解页纲",
    );
  });

  it("parses bracket tokens from chat text", () => {
    const wire = `@[${registry[0]!.name}](content_template:${registry[0]!.id})`;
    const text = `请按 ${wire} 的风格改版`;
    const parsed = parseReferencedContentTemplatesFromText(text, registry);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(registry[0]!.id);
  });

  it("applyContentTemplateMentionSelection replaces active @ query with display @name", () => {
    const start = "请参考 @品".length - 2;
    const { text, cursor } = applyContentTemplateMentionSelection(
      "请参考 @品",
      start,
      "请参考 @品".length,
      registry[0]!,
    );
    expect(text).toBe("请参考 @医学病例讲解页纲 ");
    expect(text).not.toContain("content_template:");
    expect(cursor).toBe(text.length);
  });
});
