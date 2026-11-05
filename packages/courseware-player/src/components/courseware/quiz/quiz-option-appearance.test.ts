// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { mergeQuizOptionStyle, resolveQuizOptionVisualState } from "./quiz-option-appearance.ts";

describe("resolveQuizOptionVisualState", () => {
  it("marks every correct option green after submit", () => {
    expect(
      resolveQuizOptionVisualState({
        submitted: true,
        selected: false,
        isCorrect: true,
        hovered: false,
      }),
    ).toBe("submitted-correct");
  });

  it("marks selected wrong option red after submit", () => {
    expect(
      resolveQuizOptionVisualState({
        submitted: true,
        selected: true,
        isCorrect: false,
        hovered: false,
      }),
    ).toBe("submitted-incorrect");
  });

  it("uses selected and hover before submit", () => {
    expect(
      resolveQuizOptionVisualState({
        submitted: false,
        selected: true,
        isCorrect: false,
        hovered: false,
      }),
    ).toBe("selected");
    expect(
      resolveQuizOptionVisualState({
        submitted: false,
        selected: false,
        isCorrect: false,
        hovered: true,
      }),
    ).toBe("hover");
  });
});

describe("mergeQuizOptionStyle", () => {
  it("lets state colors override author background after submit", () => {
    const merged = mergeQuizOptionStyle(
      { backgroundColor: "#ffffff", borderColor: "#000" },
      "submitted-correct",
    );
    expect(merged.backgroundColor).toBe("#e8f0e8");
    expect(merged.borderColor).toBe("#9ab89a");
  });

  it("preserves author colors before submit when customized", () => {
    const merged = mergeQuizOptionStyle(
      { backgroundColor: "#faf9f6", borderColor: "#ccc5b8", color: "#333" },
      "idle",
    );
    expect(merged.backgroundColor).toBe("#faf9f6");
    expect(merged.borderColor).toBe("#ccc5b8");
  });
});
