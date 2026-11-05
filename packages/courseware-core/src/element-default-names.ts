// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, ElementType, SlideElement } from "./elements.ts";

/** Editor-facing Chinese labels for default element names (e.g. 图片1, 文本2). */
export const ELEMENT_TYPE_DISPLAY_NAME_ZH: Record<ElementType, string> = {
  audio: "音频",
  button: "按钮",
  slide: "幻灯片",
  arrow: "箭头",
  ellipse: "椭圆",
  group: "组",
  html: "HTML",
  image: "图片",
  input: "输入框",
  line: "线条",
  narration: "旁白",
  ppt: "PPT",
  quiz: "题目",
  quiz_score_summary: "分数统计",
  rectangle: "矩形",
  rich: "组件",
  svg: "SVG",
  text: "文本",
  textarea: "多行文本",
  video: "视频",
  vtuber: "虚拟教师",
};

/**
 * Injected localized labels for default element naming. This module is synced
 * to the CLI repo, so it must stay self-contained (no "@/lib/i18n" import):
 * hosts inject translations; omitting the argument keeps the Chinese defaults.
 */
export type ElementNameLabels = {
  displayNames?: Partial<Record<ElementType, string>>;
  formatName?: (label: string, ordinal: number) => string;
};

export const needsDefaultElementName = (name: unknown): boolean =>
  typeof name !== "string" || name.trim() === "";

/** Count direct slide children of the given type (siblings only). */
export const countSlideChildrenOfType = (
  slide: Pick<SlideElement, "children_elements">,
  elementType: ElementType,
): number => (slide.children_elements ?? []).filter((el) => el.element_type === elementType).length;

export const nextDefaultElementName = (
  slide: Pick<SlideElement, "children_elements">,
  elementType: ElementType,
  labels?: ElementNameLabels,
): string => {
  const label =
    labels?.displayNames?.[elementType] ?? ELEMENT_TYPE_DISPLAY_NAME_ZH[elementType] ?? elementType;
  const ordinal = countSlideChildrenOfType(slide, elementType) + 1;
  return labels?.formatName ? labels.formatName(label, ordinal) : `${label}${ordinal}`;
};

/** Assign `name` on a copy when missing/blank. */
export const withDefaultElementName = <E extends Element>(
  element: E,
  slide: Pick<SlideElement, "children_elements">,
  labels?: ElementNameLabels,
): E => {
  if (!needsDefaultElementName(element.name)) return element;
  return { ...element, name: nextDefaultElementName(slide, element.element_type, labels) };
};

/** Mutating variant for loose records (CLI). */
export const applyDefaultElementNameIfEmpty = (
  record: Record<string, unknown>,
  elementType: ElementType,
  slide: Pick<SlideElement, "children_elements">,
  labels?: ElementNameLabels,
): boolean => {
  if (!needsDefaultElementName(record.name)) return false;
  record.name = nextDefaultElementName(slide, elementType, labels);
  return true;
};
