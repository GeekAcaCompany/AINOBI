// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { CoursewareAssetItem } from "../../api/courseware.ts";
import {
  applyAssetMentionSelection,
  formatAssetMentionToken,
  formatAssetMentionsForDisplay,
  getAlreadyMentionedAssetIdsInText,
  hasBracketAssetMentionTokens,
  matchPlainAtMentionsInText,
  parseMentionedAssetsFromText,
  splitMentionSegmentsForDisplay,
} from "./ai-asset-mentions.ts";

const asset = (id: string, name: string): CoursewareAssetItem => ({
  id,
  name,
  extension: "png",
  url: `https://example.com/${id}`,
  mimeType: "image/png",
  size: 0,
  createdAt: "",
});

describe("ai-asset-mentions", () => {
  const library = [
    asset("a1", "My Slide.png"),
    asset("a2", "cover"),
    asset("a3", "My"),
  ];

  it("applyAssetMentionSelection inserts display @name not bracket wire token", () => {
    const { text, cursor } = applyAssetMentionSelection("请改 @", 3, 4, library[0]!);
    expect(text).toBe("请改 @My Slide.png ");
    expect(cursor).toBe(text.length);
    expect(hasBracketAssetMentionTokens(text)).toBe(false);
  });

  it("formatAssetMentionToken uses bracket wire format", () => {
    expect(formatAssetMentionToken(library[0]!)).toBe("@[My Slide.png](file:a1)");
    expect(formatAssetMentionsForDisplay(formatAssetMentionToken(library[0]!))).toBe(
      "@My Slide.png",
    );
  });

  it("matchPlainAtMentionsInText matches filenames with spaces", () => {
    const text = "请修改 @My Slide.png 的布局";
    const spans = matchPlainAtMentionsInText(text, library);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: "My Slide.png",
      id: "a1",
      raw: "@My Slide.png",
    });
  });

  it("prefers longest library name when multiple prefixes match", () => {
    const text = "@My Slide.png ok";
    const spans = matchPlainAtMentionsInText(text, library);
    expect(spans[0]?.name).toBe("My Slide.png");
  });

  it("parseMentionedAssetsFromText resolves spaced display names", () => {
    const parsed = parseMentionedAssetsFromText("看看 @My Slide.png 谢谢", library);
    expect(parsed.map((a) => a.id)).toEqual(["a1"]);
  });

  it("parseMentionedAssetsFromText resolves bracket tokens before display normalization", () => {
    const parsed = parseMentionedAssetsFromText(
      `先看 ${formatAssetMentionToken(library[0]!)}`,
      library,
    );
    expect(parsed.map((a) => a.id)).toEqual(["a1"]);
  });

  it("splitMentionSegmentsForDisplay highlights full spaced filename", () => {
    const segments = splitMentionSegmentsForDisplay("引用 @My Slide.png 结束", library);
    const mention = segments.find((s) => s.kind === "mention");
    expect(mention).toMatchObject({ kind: "mention", name: "My Slide.png", id: "a1" });
  });

  it("getAlreadyMentionedAssetIdsInText counts spaced filenames", () => {
    const ids = getAlreadyMentionedAssetIdsInText("已选 @My Slide.png", library);
    expect([...ids]).toEqual(["a1"]);
  });

  it("keeps brackets in display token so library name still resolves", () => {
    const weird = asset("audio1", "Z_[04-01] _kiku1.mp3");
    const { text } = applyAssetMentionSelection("用 @", 2, 3, weird);
    expect(text).toBe("用 @Z_[04-01] _kiku1.mp3 ");
    expect(parseMentionedAssetsFromText(text, [weird]).map((a) => a.id)).toEqual(["audio1"]);
  });

  it("formatAssetMentionToken escapes brackets inside wire name", () => {
    const weird = asset("audio1", "Z_[04-01] _kiku1.mp3");
    expect(formatAssetMentionToken(weird)).toBe("@[Z__04-01_ _kiku1.mp3](file:audio1)");
  });
});
