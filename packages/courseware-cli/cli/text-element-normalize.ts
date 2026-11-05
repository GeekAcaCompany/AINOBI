// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";
import type { Element, Scene, TextElement } from "@ainobi/courseware-core";

const STYLE_TYPOGRAPHY_KEYS = [
  "color",
  "font_size",
  "font_family",
  "font_weight",
  "letter_spacing",
  "line_height",
  "text_align",
  "align",
] as const;

/** `--set style.*` typography paths are aliases; canonical fields live on the element root. */
const STYLE_TYPOGRAPHY_SET_ALIASES: Readonly<Record<string, string>> = {
  "style.color": "color",
  "style.font_size": "font_size",
  "style.font_family": "font_family",
  "style.line_height": "line_height",
  "style.align": "align",
  "style.text_align": "align",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asPositiveInt = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
};

const asLineHeight = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0.5 || n > 5) return undefined;
  return n;
};

const fontWeightToBold = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 600;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "bold" || normalized === "bolder") return true;
    if (normalized === "normal" || normalized === "lighter") return false;
    const n = Number(normalized);
    if (Number.isFinite(n)) return n >= 600;
  }
  return undefined;
};

const boldSetEntryFromFontWeightRhs = (rhs: string): string | null => {
  const trimmed = rhs.trim();
  if (trimmed === "true" || trimmed === "bold" || trimmed === "bolder") return "bold=true";
  if (trimmed === "false" || trimmed === "normal" || trimmed === "lighter") return "bold=false";
  const n = Number(trimmed);
  if (Number.isFinite(n)) return n >= 600 ? "bold=true" : "bold=false";
  return null;
};

/**
 * Duplicate `--set style.color=…` (etc.) onto root `color=…` so schema + player stay in sync.
 * The original style.* entry is kept for deepMerge, then stripped by {@link normalizeTextElementRecord}.
 */
export const expandTextTypographySetEntries = (setEntries: string[]): string[] => {
  const expanded = [...setEntries];
  for (const entry of setEntries) {
    const equals = entry.indexOf("=");
    if (equals <= 0) continue;
    const path = entry.slice(0, equals).trim();
    const rhs = entry.slice(equals + 1);
    const rootPath = STYLE_TYPOGRAPHY_SET_ALIASES[path];
    if (rootPath) {
      expanded.push(`${rootPath}=${rhs}`);
      continue;
    }
    if (path === "style.font_weight") {
      const boldEntry = boldSetEntryFromFontWeightRhs(rhs);
      if (boldEntry) expanded.push(boldEntry);
    }
  }
  return expanded;
};

/**
 * Player/editor may store typography under `style.*`. Promote to schema fields and strip extras.
 */
export const normalizeTextElementRecord = (
  record: Record<string, unknown>,
): { record: Record<string, unknown>; promotions: string[] } => {
  if (record.element_type !== "text" && record.element_type !== undefined) {
    return { record, promotions: [] };
  }

  const style = isRecord(record.style) ? { ...record.style } : undefined;
  if (!style) return { record, promotions: [] };

  const promotions: string[] = [];
  const next: Record<string, unknown> = { ...record };

  const styleColor = asString(style.color);
  if (styleColor) {
    next.color = styleColor;
    promotions.push("style.color→color");
  }

  const styleFontSize = asPositiveInt(style.font_size);
  if (styleFontSize !== undefined) {
    next.font_size = styleFontSize;
    promotions.push("style.font_size→font_size");
  }

  const styleFontFamily = asString(style.font_family);
  if (styleFontFamily) {
    next.font_family = styleFontFamily;
    promotions.push("style.font_family→font_family");
  }

  const styleAlign = asString(style.text_align) ?? asString(style.align);
  if (styleAlign) {
    next.align = styleAlign;
    promotions.push("style.align→align");
  }

  const styleLineHeight = asLineHeight(style.line_height);
  if (styleLineHeight !== undefined) {
    next.line_height = styleLineHeight;
    promotions.push("style.line_height→line_height");
  }

  const bold = fontWeightToBold(style.font_weight);
  if (bold !== undefined) {
    next.bold = bold;
    promotions.push("style.font_weight→bold");
  }

  const cleanedStyle: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if ((STYLE_TYPOGRAPHY_KEYS as readonly string[]).includes(key)) continue;
    cleanedStyle[key] = value;
  }
  next.style = cleanedStyle;

  return { record: next, promotions };
};

export const resolveEffectiveTextColor = (text: TextElement): string => {
  const style = text.style as unknown as Record<string, unknown>;
  const styleColor = isRecord(style) ? asString(style.color) : undefined;
  return styleColor ?? text.color;
};

const flattenTextElements = (elements: Element[]): TextElement[] => {
  const out: TextElement[] = [];
  for (const element of elements) {
    if (element.element_type === "text") out.push(element);
    if ("children_elements" in element && Array.isArray(element.children_elements)) {
      out.push(...flattenTextElements(element.children_elements as Element[]));
    }
  }
  return out;
};

export const normalizeTextElementsInScene = (
  scene: Scene,
): { scene: Scene; warnings: CliIssue[] } => {
  const warnings: CliIssue[] = [];

  const slides = scene.slide_elements.map((slide) => {
    const normalizeChildren = (elements: Element[]): Element[] =>
      elements.map((element) => {
        if (element.element_type === "text") {
          const serialized = { ...element } as unknown as Record<string, unknown>;
          const { record, promotions } = normalizeTextElementRecord(serialized);
          if (promotions.length > 0) {
            warnings.push({
              path: `slide_elements[].children_elements (${element.element_id})`,
              message:
                `Text element "${element.name || element.element_id}" had typography under style; ` +
                `promoted ${promotions.join(", ")}. Use root fields: color, font_size, line_height, bold, align.`,
              value: { element_id: element.element_id, promotions },
            });
          }
          return { ...element, ...record } as TextElement;
        }
        if ("children_elements" in element && Array.isArray(element.children_elements)) {
          return {
            ...element,
            children_elements: normalizeChildren(element.children_elements as Element[]),
          } as Element;
        }
        return element;
      });

    return {
      ...slide,
      children_elements: normalizeChildren(slide.children_elements),
    };
  });

  return { scene: { ...scene, slide_elements: slides }, warnings };
};

/** Legacy/editor JSON where style.color still disagrees with root color after promotion pass. */
export const collectTextTypographyDriftWarnings = (scene: Scene): CliIssue[] => {
  const warnings: CliIssue[] = [];
  scene.slide_elements.forEach((slide, slideIndex) => {
    for (const text of flattenTextElements(slide.children_elements)) {
      const style = text.style as unknown as Record<string, unknown>;
      const styleColor = isRecord(style) ? asString(style.color) : undefined;
      if (!styleColor) continue;
      const rootColor = asString(text.color);
      if (!rootColor || styleColor === rootColor) continue;
      warnings.push({
        path: `slide_elements[${slideIndex}].children_elements (${text.element_id})`,
        message:
          `Text "${text.name || text.element_id}" has mismatched color: root "${rootColor}" vs style.color "${styleColor}". ` +
          "Run `ainobi element update … --set color=…` or save to normalize; `--set style.color` is an alias copied to root.",
        value: { element_id: text.element_id, color: rootColor, style_color: styleColor },
      });
    }
  });
  return warnings;
};
