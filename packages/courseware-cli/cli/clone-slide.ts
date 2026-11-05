// SPDX-License-Identifier: AGPL-3.0-only
import { newBindingId, newElementId, newPauseId } from "./ids.ts";

const walkElements = (
  elements: Record<string, unknown>[],
  visit: (el: Record<string, unknown>) => void,
): void => {
  for (const element of elements) {
    visit(element);
    const children = element.children_elements;
    if (Array.isArray(children)) {
      walkElements(children as Record<string, unknown>[], visit);
    }
  }
};

export type ClonedSlideResult = {
  slide: Record<string, unknown>;
  /** old element_id → new element_id */
  idMap: Map<string, string>;
};

/**
 * Deep-clone a slide subtree with fresh `element_id` / `binding_id` / `pause_id`,
 * and remap in-slide references (`vtuber_element_id`).
 */
export function cloneSlideWithNewIds(slide: Record<string, unknown>): ClonedSlideResult {
  const cloned = JSON.parse(JSON.stringify(slide)) as Record<string, unknown>;
  const idMap = new Map<string, string>();

  walkElements([cloned], (element) => {
    const old = typeof element.element_id === "string" ? element.element_id : "";
    const type = typeof element.element_type === "string" ? element.element_type : "element";
    const next = newElementId(type);
    if (old) idMap.set(old, next);
    element.element_id = next;
    const bindings = element.event_bindings;
    if (Array.isArray(bindings)) {
      for (const binding of bindings as Record<string, unknown>[]) {
        binding.binding_id = newBindingId();
      }
    }
  });

  walkElements([cloned], (element) => {
    if (typeof element.vtuber_element_id === "string" && idMap.has(element.vtuber_element_id)) {
      element.vtuber_element_id = idMap.get(element.vtuber_element_id);
    }
  });

  const pauses = cloned.flow_pause_points;
  if (Array.isArray(pauses)) {
    for (const point of pauses as Record<string, unknown>[]) {
      point.pause_id = newPauseId();
    }
  }

  return { slide: cloned, idMap };
}

/**
 * After cloning a quiz question into the target scene, remap fields that pointed at
 * sibling element ids on the source slide (e.g. content narration vtuber).
 */
export function remapQuizQuestionElementRefs(
  question: Record<string, unknown>,
  idMap: Map<string, string>,
): void {
  const vtuberKey = "content_narration_vtuber_element_id";
  const old = typeof question[vtuberKey] === "string" ? question[vtuberKey].trim() : "";
  if (old && idMap.has(old)) {
    question[vtuberKey] = idMap.get(old);
  }
}

/**
 * Pad / trim `scene.transitions` to `slide_count - 1` without wiping existing entries.
 * Matches `operations.ts` slide insert/duplicate behavior.
 */
export function syncSceneTransitionsLength(scene: Record<string, unknown>): void {
  const slides = (scene.slide_elements as unknown[] | undefined) ?? [];
  const needed = Math.max(0, slides.length - 1);
  const existing = Array.isArray(scene.transitions) ? [...scene.transitions] : [];
  while (existing.length < needed) existing.push("none");
  scene.transitions = existing.slice(0, needed);
}
