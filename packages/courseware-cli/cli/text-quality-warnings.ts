// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";
import type { Element, Scene, TextElement } from "@ainobi/courseware-core";
import { resolveTextLineHeight } from "@ainobi/courseware-core";

/**
 * Teaching-text minimum font size on the 1920×1080 logical canvas. Below this,
 * body copy reads as tiny on a projected/full-screen slide. Captions may go
 * smaller, so the small-font warning only fires for substantial copy.
 */
export const MIN_TEACHING_FONT_SIZE_PX = 32;

/** Only nudge about small fonts when the copy is long enough to be teaching text (not a tiny label/caption). */
const SMALL_FONT_MIN_TEXT_LENGTH = 10;

/** Slack factor so the box-capacity heuristic does not fire on borderline boxes. */
const BOX_CAPACITY_SLACK = 1.08;

export interface TextQualityInspectableElement {
  element_id: string;
  element_type: string;
  name?: string;
  text: string;
  font_size: number;
  line_height?: number;
  size: { width: number; height: number };
}

export interface TextQualityContext {
  path: string;
}

const isWideGlyph = (codePoint: number): boolean => {
  // CJK Unified Ideographs + Ext A, Hiragana/Katakana, Hangul, full-width forms, CJK symbols/punctuation.
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals / symbols & punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Hiragana, Katakana, CJK symbols
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Ext A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified Ideographs
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Full-width forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) // Full-width signs
  );
};

const estimateGlyphWidthPx = (ch: string, fontSize: number): number => {
  const code = ch.codePointAt(0);
  if (code === undefined) return fontSize * 0.55;
  if (isWideGlyph(code)) return fontSize;
  return fontSize * 0.55;
};

/**
 * Rough wrapped-line estimate for a text block at a given font size and box width.
 * Width-only metrics (no real font shaping), so this is a heuristic intended to catch
 * obvious overflow — not exact layout. Explicit `\n` always starts a new line.
 */
export const estimateTextLineCount = (
  text: string,
  fontSize: number,
  boxWidth: number,
): number => {
  if (!text) return 0;
  if (!(fontSize > 0) || !(boxWidth > 0)) return text.split("\n").length;
  let lines = 0;
  for (const rawLine of text.split("\n")) {
    if (rawLine.length === 0) {
      lines += 1;
      continue;
    }
    let lineWidth = 0;
    for (const ch of rawLine) lineWidth += estimateGlyphWidthPx(ch, fontSize);
    lines += Math.max(1, Math.ceil(lineWidth / boxWidth));
  }
  return Math.max(1, lines);
};

/**
 * Quality warnings for a single `text` element: teaching font size too small,
 * and box too short to hold the copy (silent overflow in the player).
 */
export const collectTextElementQualityIssues = (
  element: TextQualityInspectableElement,
  context: TextQualityContext,
): CliIssue[] => {
  const issues: CliIssue[] = [];
  if (element.element_type !== "text") return issues;
  const text = element.text ?? "";
  const trimmed = text.trim();
  if (!trimmed) return issues;

  const fontSize = element.font_size;
  const { width, height } = element.size;

  if (
    Number.isFinite(fontSize) &&
    fontSize > 0 &&
    fontSize < MIN_TEACHING_FONT_SIZE_PX &&
    trimmed.length >= SMALL_FONT_MIN_TEXT_LENGTH
  ) {
    issues.push({
      path: `${context.path}.font_size`,
      message:
        `Text "${element.name || element.element_id}" uses font_size=${Math.round(fontSize)} on the 1920×1080 canvas, ` +
        `which reads small for teaching copy. Recommended bands: titles 56–96, sections 40–56, body 32–44 ` +
        `(captions 24–32 only for short secondary lines).`,
      value: {
        element_id: element.element_id,
        font_size: fontSize,
        recommended_min: MIN_TEACHING_FONT_SIZE_PX,
      },
    });
  }

  if (width > 0 && height > 0 && fontSize > 0) {
    const lineHeight = resolveTextLineHeight(element.line_height);
    const lineCount = estimateTextLineCount(text, fontSize, width);
    const requiredHeight = lineCount * lineHeight * fontSize;
    if (requiredHeight > height * BOX_CAPACITY_SLACK) {
      issues.push({
        path: `${context.path}.size.height`,
        message:
          `Text "${element.name || element.element_id}" likely overflows its box: ~${lineCount} line(s) ` +
          `need about ${Math.ceil(requiredHeight)}px tall (line_height ${lineHeight} × font_size ${Math.round(fontSize)}), ` +
          `but size.height=${Math.round(height)}. The player does not clip or shrink text, so it spills out. ` +
          `Increase size.height, reduce font_size, widen the box, or shorten the copy.`,
        value: {
          element_id: element.element_id,
          estimated_line_count: lineCount,
          estimated_required_height: Math.ceil(requiredHeight),
          size_height: height,
          size_width: width,
          font_size: fontSize,
          line_height: lineHeight,
        },
      });
    }
  }

  return issues;
};

const isTextElement = (element: Element): element is TextElement => element.element_type === "text";

const flattenSlideChildren = (elements: Element[]): Element[] => {
  const out: Element[] = [];
  for (const element of elements) {
    out.push(element);
    if ("children_elements" in element && Array.isArray(element.children_elements)) {
      out.push(...flattenSlideChildren(element.children_elements as Element[]));
    }
  }
  return out;
};

/** Scene-wide text-quality warnings (small fonts, likely overflow) for `ainobi validate`. */
export const collectSceneTextQualityWarnings = (scene: Scene): CliIssue[] => {
  const warnings: CliIssue[] = [];
  scene.slide_elements.forEach((slide, slideIndex) => {
    const children = flattenSlideChildren(slide.children_elements);
    for (const element of children) {
      if (!isTextElement(element)) continue;
      const issues = collectTextElementQualityIssues(
        {
          element_id: element.element_id,
          element_type: element.element_type,
          name: element.name,
          text: element.text,
          font_size: element.font_size,
          line_height: element.line_height,
          size: element.size,
        },
        { path: `slide_elements[${slideIndex}].children_elements (${element.element_id})` },
      );
      warnings.push(...issues);
    }
  });
  return warnings;
};
