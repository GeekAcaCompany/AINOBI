// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, QuizSlideElement, SlideElement, VtuberElement } from "./elements.ts";

type CourseElement = Element;

/** Slide index of the quiz element bound to `questionId`; null if not on any slide. */
export function findSlideIndexForQuizQuestion(
  slides: readonly SlideElement[],
  questionId: string,
): number | null {
  if (!questionId.trim()) return null;
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    if (!slide) continue;
    const hit = slide.children_elements.some(
      (el) => el.element_type === "quiz" && (el as QuizSlideElement).quiz_question_id === questionId,
    );
    if (hit) return i;
  }
  return null;
}

export function listVtubersOnSlide(slide: SlideElement): VtuberElement[] {
  return slide.children_elements.filter((el): el is VtuberElement => el.element_type === "vtuber");
}

export function sceneHasVtuberOnAnySlide(slides: readonly SlideElement[]): boolean {
  for (const slide of slides) {
    if (listVtubersOnSlide(slide).length > 0) return true;
  }
  return false;
}

/**
 * Stack render unit on the slide canvas. With the new quiz model every quiz is
 * a single positionable element, so the only kind needed is `"single"`.
 */
export type SlideStackRenderUnit = { kind: "single"; element: CourseElement };

export function getQuestionGroupIdsForChildIndex(
  slide: SlideElement,
  childIndex: number,
): Set<string> | null {
  const el = slide.children_elements[childIndex];
  if (!el) return null;
  return new Set([el.element_id]);
}

export function buildQuestionStackRenderUnits(slide: SlideElement): SlideStackRenderUnit[] {
  const sorted = [...slide.children_elements].sort((a, b) => a.style.z_index - b.style.z_index);
  return sorted.map((element) => ({ kind: "single", element }));
}

/**
 * Plain single-element reorder of `children` by index. Quiz elements are
 * single boxes now, so we no longer need to move a group of sibling members.
 */
export function reorderSlideChildren(
  children: CourseElement[],
  fromIndex: number,
  toIndex: number,
): CourseElement[] {
  const len = children.length;
  if (fromIndex < 0 || fromIndex >= len) return children;
  const clampedTo = Math.max(0, Math.min(len - 1, toIndex));
  if (fromIndex === clampedTo) return children;
  const next = [...children];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/**
 * Same semantics as `reorderSlideChildren`, but in terms of "layer rows" in
 * the editor sidebar — equivalent now that every element is its own row.
 */
export function reorderSlideByLayerRow(
  slide: SlideElement,
  fromRow: number,
  toRow: number,
): CourseElement[] {
  return reorderSlideChildren(slide.children_elements, fromRow, toRow);
}
