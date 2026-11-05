// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";
import {
  compositeOverBackground,
  contrastRatio,
  parseCssColor,
  type Rgb,
} from "@ainobi/courseware-core/css-color.ts";
import type { Element, Scene, SlideElement, TextElement } from "@ainobi/courseware-core";
import { resolveEffectiveTextColor } from "./text-element-normalize.ts";

/** Warn when text/background contrast is below this (WCAG large-text AA is 3:1). */
export const LOW_TEXT_CONTRAST_RATIO_THRESHOLD = 3;

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

const isTransparentColor = (value: string | undefined): boolean => {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "transparent" || normalized === "none";
};

/** Text is drawn on its own fill, quiz option card, or the slide background (in that order). */
const effectiveBackgroundRgb = (text: TextElement, slideBg: Rgb): Rgb => {
  if (!isTransparentColor(text.text_background_color)) {
    const textBg = parseCssColor(text.text_background_color);
    if (textBg && textBg.alpha > 0.05) {
      return { r: textBg.r, g: textBg.g, b: textBg.b };
    }
  }

  const metadata = text.metadata as Record<string, unknown> | undefined;
  const metaBgRaw = metadata?.background_color;
  if (typeof metaBgRaw === "string" && !isTransparentColor(metaBgRaw)) {
    const metaBg = parseCssColor(metaBgRaw);
    if (metaBg && metaBg.alpha > 0.05) {
      return { r: metaBg.r, g: metaBg.g, b: metaBg.b };
    }
  }

  return slideBg;
};

const effectiveTextRgb = (
  text: TextElement,
  slideBg: Rgb,
): { rgb: Rgb; contrast: number; background: Rgb } | null => {
  const textColor = parseCssColor(resolveEffectiveTextColor(text));
  if (!textColor) return null;

  const bgRgb = effectiveBackgroundRgb(text, slideBg);
  const elementOpacity = Math.min(1, Math.max(0, text.style.opacity ?? 1));
  const compositeAlpha = textColor.alpha * elementOpacity;
  if (compositeAlpha <= 0.01) return null;

  const fg: Rgb =
    compositeAlpha >= 0.999
      ? { r: textColor.r, g: textColor.g, b: textColor.b }
      : compositeOverBackground({ ...textColor, alpha: compositeAlpha }, bgRgb);

  return { rgb: fg, contrast: contrastRatio(fg, bgRgb), background: bgRgb };
};

const slideBackgroundRgb = (slide: SlideElement): Rgb | null => {
  const parsed = parseCssColor(slide.background_color);
  if (!parsed) return null;
  return { r: parsed.r, g: parsed.g, b: parsed.b };
};

/**
 * Warn when a text element's effective color is very close to the slide background
 * (low WCAG contrast ratio).
 */
export const collectLowTextContrastWarnings = (scene: Scene): CliIssue[] => {
  const warnings: CliIssue[] = [];

  scene.slide_elements.forEach((slide, slideIndex) => {
    const bgRgb = slideBackgroundRgb(slide);
    if (!bgRgb) return;

    const slideLabel = slide.name?.trim() || `index ${slideIndex}`;
    const children = flattenSlideChildren(slide.children_elements);

    for (const element of children) {
      if (!isTextElement(element)) continue;
      if (!element.text?.trim()) continue;

      const effective = effectiveTextRgb(element, bgRgb);
      if (!effective || effective.contrast >= LOW_TEXT_CONTRAST_RATIO_THRESHOLD) continue;

      const comparedBackground =
        effective.background.r === bgRgb.r &&
        effective.background.g === bgRgb.g &&
        effective.background.b === bgRgb.b
          ? slide.background_color
          : (element.metadata as Record<string, unknown> | undefined)?.background_color ??
            element.text_background_color ??
            slide.background_color;

      warnings.push({
        path: `slide_elements[${slideIndex}].children_elements (${element.element_id})`,
        message:
          `Text "${element.name || element.element_id}" on slide "${slideLabel}" has low contrast ` +
          `(${effective.contrast.toFixed(2)}:1) between color "${resolveEffectiveTextColor(element)}" and background ` +
          `"${comparedBackground}"; lighten/darken text or adjust the background.`,
        value: {
          slide_index: slideIndex,
          slide_id: slide.element_id,
          element_id: element.element_id,
          text_color: resolveEffectiveTextColor(element),
          root_color: element.color,
          slide_background_color: slide.background_color,
          compared_background: comparedBackground,
          contrast_ratio: Number(effective.contrast.toFixed(3)),
          threshold: LOW_TEXT_CONTRAST_RATIO_THRESHOLD,
        },
      });
    }
  });

  return warnings;
};
