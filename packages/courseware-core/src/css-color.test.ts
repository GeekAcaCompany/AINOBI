// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  compositeOverBackground,
  contrastRatio,
  normalizeColorToHex,
  parseCssColor,
  rgbToHex,
} from "./css-color.ts";

describe("css-color", () => {
  it("parseCssColor supports hex and rgba", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, alpha: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, alpha: 0.5 });
  });

  it("compositeOverBackground blends semi-transparent foreground", () => {
    const fg = parseCssColor("rgba(255, 255, 255, 0.5)");
    const bg = parseCssColor("#000000");
    expect(fg && bg).toBeTruthy();
    const blended = compositeOverBackground(fg!, bg!);
    expect(blended.r).toBe(127.5);
  });

  it("rgbToHex and normalizeColorToHex", () => {
    expect(rgbToHex({ r: 240, g: 240, b: 237 })).toBe("#f0f0ed");
    expect(normalizeColorToHex("#F0F0ED")).toBe("#f0f0ed");
    expect(normalizeColorToHex("rgba(10, 20, 30, 0.5)")).toBe("#0a141e");
    expect(normalizeColorToHex("transparent", "#ff0000")).toBe("#ff0000");
  });

  it("contrastRatio is symmetric and monotonic", () => {
    const white = parseCssColor("#ffffff")!;
    const black = parseCssColor("#000000")!;
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, black)).toBe(contrastRatio(black, white));
  });
});
