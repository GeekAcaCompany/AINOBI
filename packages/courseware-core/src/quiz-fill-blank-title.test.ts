// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  appendFillBlankSlotToTitle,
  countFillBlankSlotsInTitle,
  parseCommaSeparatedAliases,
  removeFillBlankSlotAtIndex,
} from "./quiz-fill-blank-title.ts";

describe("removeFillBlankSlotAtIndex", () => {
  it("removes the blank at the given index without shifting the wrong slot", () => {
    expect(removeFillBlankSlotAtIndex("A___B___C", 0)).toBe("AB___C");
    expect(removeFillBlankSlotAtIndex("A___B___C", 1)).toBe("A___BC");
  });

  it("removes the only blank from the default stem", () => {
    expect(removeFillBlankSlotAtIndex("请输入题干：_____", 0)).toBe("请输入题干：");
  });
});

describe("parseCommaSeparatedAliases", () => {
  it("splits on English and Chinese commas", () => {
    expect(parseCommaSeparatedAliases("world, World，earth")).toEqual(["world", "World", "earth"]);
  });

  it("does not split on newlines", () => {
    expect(parseCommaSeparatedAliases("a\nb")).toEqual(["a\nb"]);
  });
});

describe("appendFillBlankSlotToTitle", () => {
  it("appends a distinct blank when the title already ends with underscores", () => {
    const next = appendFillBlankSlotToTitle("请输入题干：_____");
    expect(next).toBe("请输入题干：_____ ____");
    expect(countFillBlankSlotsInTitle(next)).toBe(2);
  });

  it("appends a blank marker to plain text", () => {
    const next = appendFillBlankSlotToTitle("请输入题干：");
    expect(next).toBe("请输入题干：____");
    expect(countFillBlankSlotsInTitle(next)).toBe(1);
  });

  it("adds a second slot after an inline blank", () => {
    const next = appendFillBlankSlotToTitle("Capital of France is ___");
    expect(next).toBe("Capital of France is ___ ____");
    expect(countFillBlankSlotsInTitle(next)).toBe(2);
  });
});
