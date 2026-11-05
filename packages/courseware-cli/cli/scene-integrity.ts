// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError, type CliIssue } from "./errors.ts";
import type { Element, Scene } from "@ainobi/courseware-core";
import { validateQuizSlideBindings } from "@ainobi/courseware-core";

const walkElements = (
  elements: Element[],
  visit: (element: Element) => void,
): void => {
  for (const element of elements) {
    visit(element);
    if ("children_elements" in element && Array.isArray(element.children_elements)) {
      walkElements(element.children_elements, visit);
    }
  }
};

const recordId = (
  occurrences: Map<string, string[]>,
  elementId: string,
  path: string,
): void => {
  const trimmed = elementId.trim();
  if (!trimmed) return;
  const paths = occurrences.get(trimmed) ?? [];
  paths.push(path);
  occurrences.set(trimmed, paths);
};

/**
 * Scene-wide element_id uniqueness (slides, nested children, vtuber/audio tracks).
 * Duplicate ids break React keys in the editor/player.
 */
export const collectDuplicateElementIdIssues = (scene: Scene): CliIssue[] => {
  const occurrences = new Map<string, string[]>();

  scene.slide_elements.forEach((slide, slideIndex) => {
    const slidePath = `slide_elements[${slideIndex}]`;
    recordId(occurrences, slide.element_id, `${slidePath}.element_id`);
    walkElements(slide.children_elements, (element) => {
      recordId(occurrences, element.element_id, `${slidePath}.${element.element_id}`);
    });
  });

  scene.vtuber_elements.forEach((element, index) => {
    recordId(occurrences, element.element_id, `vtuber_elements[${index}].element_id`);
  });

  scene.audio_elements.forEach((element, index) => {
    recordId(occurrences, element.element_id, `audio_elements[${index}].element_id`);
  });

  const issues: CliIssue[] = [];
  for (const [elementId, paths] of occurrences) {
    if (paths.length < 2) continue;
    issues.push({
      path: paths[0],
      message: `Duplicate element_id ${elementId} (${paths.length} occurrences: ${paths.join(", ")})`,
    });
  }
  return issues.sort((a, b) => a.path.localeCompare(b.path));
};

export const assertSceneElementIdsUnique = (scene: Scene): void => {
  const issues = collectDuplicateElementIdIssues(scene);
  if (issues.length === 0) return;
  throw new AinobiCliError("VALIDATION_ERROR", "Scene contains duplicate element_id values.", {
    issues,
    hint: "Regenerate ids (e.g. `ainobi slide duplicate <ref>`) or remove the duplicate slide/element.",
  });
};

/**
 * `scene.quiz.questions[]` entries with no matching slide quiz element.
 * Same issues as `ainobi quiz validate` / `ainobi validate` binding checks.
 */
export const collectOrphanQuizQuestionIssues = (scene: Scene): CliIssue[] => {
  if (!scene.quiz || scene.quiz.questions.length === 0) return [];
  return validateQuizSlideBindings(scene.quiz, scene.slide_elements).map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
};

/**
 * Hard-fail before save when orphan quiz questions would leave the scene invalid.
 * Prefer `ainobi quiz prune-orphans` (or delete via `quiz delete` / cascaded `slide delete`).
 */
export const assertNoOrphanQuizQuestions = (scene: Scene): void => {
  const issues = collectOrphanQuizQuestionIssues(scene);
  if (issues.length === 0) return;
  throw new AinobiCliError(
    "VALIDATION_ERROR",
    `Scene has ${issues.length} orphan quiz question(s) not bound to any slide.`,
    {
      issues,
      hint: "Run `ainobi quiz prune-orphans` to drop unbound questions, or re-bind with `ainobi quiz insert`.",
    },
  );
};
