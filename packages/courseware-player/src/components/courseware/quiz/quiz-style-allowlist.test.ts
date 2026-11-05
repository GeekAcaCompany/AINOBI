// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  QUIZ_STYLE_ALLOWED_KEYS,
  normalizeQuizAstStyle,
  sanitizeQuizAstStyleObject,
} from "./quiz-style-allowlist.ts";

describe("sanitizeQuizAstStyleObject", () => {
  it("keeps whitelisted typographic and layout keys", () => {
    const cleaned = sanitizeQuizAstStyleObject({
      color: "#0F172A",
      fontSize: 24,
      padding: "16px",
      display: "flex",
      gap: 12,
      transition: "background-color 140ms ease",
    });
    expect(cleaned).toEqual({
      color: "#0F172A",
      fontSize: 24,
      padding: "16px",
      display: "flex",
      gap: 12,
      transition: "background-color 140ms ease",
    });
  });

  it("drops unsafe position values but keeps other layout keys", () => {
    const cleaned = sanitizeQuizAstStyleObject({
      position: "fixed",
      top: 0,
      left: 0,
      zIndex: 9999,
      transform: "translateY(-4px)",
      color: "#fff",
    });
    expect(cleaned).toEqual({
      top: 0,
      left: 0,
      zIndex: 9999,
      transform: "translateY(-4px)",
      color: "#fff",
    });
  });

  it("keeps common presentation keys (textShadow, backdropFilter, filter blur)", () => {
    const cleaned = sanitizeQuizAstStyleObject({
      textShadow: "0 1px 2px rgba(0,0,0,0.12)",
      backdropFilter: "blur(8px)",
      filter: "blur(4px)",
      boxSizing: "border-box",
      overflow: "hidden",
    });
    expect(cleaned).toEqual({
      textShadow: "0 1px 2px rgba(0,0,0,0.12)",
      backdropFilter: "blur(8px)",
      filter: "blur(4px)",
      boxSizing: "border-box",
      overflow: "hidden",
    });
  });

  it("rejects values containing `url(...)`, `expression(...)`, `!important`, or absolute positioning shorthand", () => {
    const cleaned = sanitizeQuizAstStyleObject({
      background: "url(https://evil.test/leak.png)",
      color: "red !important",
      fontFamily: "expression(alert('xss'))",
      padding: "8px",
      // shorthand inside an *allowed* key like `background` should still be rejected
      backgroundColor: "position:fixed; color:red",
    });
    expect(cleaned).toEqual({ padding: "8px" });
  });

  it("drops javascript: scheme and inline comments", () => {
    const cleaned = sanitizeQuizAstStyleObject({
      background: "javascript:fetch('/x')",
      color: "/* sneaky */ red",
      padding: 8,
    });
    expect(cleaned).toEqual({ padding: 8 });
  });

  it("ignores non-string non-number values", () => {
    const cleaned = sanitizeQuizAstStyleObject({
      color: { hex: "#fff" } as unknown as string,
      fontSize: null as unknown as number,
      padding: undefined as unknown as number,
      margin: true as unknown as string,
      gap: 12,
    });
    expect(cleaned).toEqual({ gap: 12 });
  });

  it("trims whitespace on string values", () => {
    const cleaned = sanitizeQuizAstStyleObject({ color: "  #0F172A  " });
    expect(cleaned).toEqual({ color: "#0F172A" });
  });

  it("drops empty strings", () => {
    const cleaned = sanitizeQuizAstStyleObject({ color: "", fontSize: "" });
    expect(cleaned).toEqual({});
  });
});

describe("normalizeQuizAstStyle (React.CSSProperties adapter)", () => {
  it("returns undefined for null/undefined/non-object inputs", () => {
    expect(normalizeQuizAstStyle(null)).toBeUndefined();
    expect(normalizeQuizAstStyle(undefined)).toBeUndefined();
    expect(normalizeQuizAstStyle(42)).toBeUndefined();
    expect(normalizeQuizAstStyle("color:red")).toBeUndefined();
    expect(normalizeQuizAstStyle(["color", "red"])).toBeUndefined();
  });

  it("returns undefined when every key gets dropped", () => {
    expect(normalizeQuizAstStyle({ position: "fixed" })).toBeUndefined();
  });

  it("returns a sanitized CSSProperties object", () => {
    const style = normalizeQuizAstStyle({
      color: "#fff",
      fontSize: 24,
      position: "fixed",
      transform: "translateY(-2px)",
      backgroundColor: "url(/leak.png)",
      padding: "8px",
    });
    expect(style).toEqual({
      color: "#fff",
      fontSize: 24,
      transform: "translateY(-2px)",
      padding: "8px",
    });
  });
});
