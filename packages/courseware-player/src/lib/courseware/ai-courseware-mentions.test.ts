// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  applyCoursewareMentionSelection,
  formatCoursewareMentionToken,
  formatCoursewareMentionsForDisplay,
  mergeMentionLibrariesForDisplay,
  parseReferencedCoursewareFromText,
  type ReferencedCoursewareItem,
} from "./ai-courseware-mentions.ts";
import { splitMentionSegmentsForDisplay } from "./ai-asset-mentions.ts";

const ref = (
  key: string,
  title: string,
  overrides?: Partial<ReferencedCoursewareItem>,
): ReferencedCoursewareItem => ({
  id: `id-${key}`,
  key,
  title,
  jsonUrl: `https://cw.example/courseware?key=${encodeURIComponent(key)}`,
  ...overrides,
});

describe("ai-courseware-mentions", () => {
  const registry = [
    ref("deck-a", "入门课件"),
    ref("deck-b", "My Courseware Title"),
  ];

  it("applyCoursewareMentionSelection inserts display @title (titles with spaces)", () => {
    const item = ref("deck-c", "AINOBI - 企業研修イメージ資料");
    const { text, cursor } = applyCoursewareMentionSelection("参考 @", 3, 4, item);
    expect(text).toBe("参考 @AINOBI - 企業研修イメージ資料 ");
    expect(cursor).toBe(text.length);
  });

  it("mergeMentionLibrariesForDisplay highlights spaced courseware titles", () => {
    const item = ref("deck-c", "AINOBI - 企業研修イメージ資料");
    const library = mergeMentionLibrariesForDisplay([], [item]);
    const segments = splitMentionSegmentsForDisplay(
      "请参照 @AINOBI - 企業研修イメージ資料 的风格",
      library,
    );
    const mention = segments.find((s) => s.kind === "mention");
    expect(mention?.kind).toBe("mention");
    if (mention?.kind === "mention") {
      expect(mention.name).toBe("AINOBI - 企業研修イメージ資料");
      expect(mention.id).toBe("deck-c");
    }
  });

  it("applyCoursewareMentionSelection inserts display @title for simple titles", () => {
    const { text, cursor } = applyCoursewareMentionSelection("参考 @", 3, 4, registry[0]!);
    expect(text).toBe("参考 @入门课件 ");
    expect(cursor).toBe(text.length);
  });

  it("parseReferencedCoursewareFromText resolves display @title from registry", () => {
    const parsed = parseReferencedCoursewareFromText("请参照 @入门课件 的风格", registry);
    expect(parsed.map((cw) => cw.key)).toEqual(["deck-a"]);
  });

  it("parseReferencedCoursewareFromText resolves bracket wire tokens", () => {
    const wire = formatCoursewareMentionToken(registry[1]!);
    const parsed = parseReferencedCoursewareFromText(`看看 ${wire}`, registry);
    expect(parsed.map((cw) => cw.key)).toEqual(["deck-b"]);
    expect(formatCoursewareMentionsForDisplay(wire)).toBe("@My Courseware Title");
  });

  it("parseReferencedCoursewareFromText dedupes by key", () => {
    const text = "@入门课件 以及 @[入门课件](courseware:deck-a)";
    const parsed = parseReferencedCoursewareFromText(text, registry);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.key).toBe("deck-a");
  });
});
