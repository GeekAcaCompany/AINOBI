// SPDX-License-Identifier: AGPL-3.0-only
import {
  serializeElement,
  type AudioElement,
  type Element,
  type SlideElement,
  type VtuberElement,
} from "@ainobi/courseware-core/elements.ts";
import { Transitions, type Transition } from "@ainobi/courseware-core/enums/transitions.ts";
import { deserializeScene, serializeScene, type Scene } from "@ainobi/courseware-core/scene.ts";
import type { QuizConfig, QuizGradeLevel, QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

export type SceneMergeResult = {
  scene: Scene;
  /** element_id values where local and remote both diverged from base (remote wins). */
  conflictElementIds: string[];
  /** slide element_id values that had merge conflicts. */
  conflictSlideIds: string[];
};

/** Deep-clone a scene through the canonical serialize/deserialize round-trip. */
export function cloneCoursewareScene(scene: Scene): Scene {
  return deserializeScene(serializeScene(scene));
}

function elementFingerprint(el: Element): string {
  return JSON.stringify(serializeElement(el));
}

function hasChildren(el: Element | undefined): el is Element & { children_elements: Element[] } {
  if (!el) return false;
  return Array.isArray((el as { children_elements?: unknown }).children_elements);
}

function elementShell(el: Element): Element {
  if (!hasChildren(el)) return el;
  return { ...el, children_elements: [] } as Element;
}

function shellFingerprint(el: Element): string {
  return elementFingerprint(elementShell(el));
}

function slideShell(slide: SlideElement): SlideElement {
  return { ...slide, children_elements: [] };
}

function slideShellFingerprint(slide: SlideElement): string {
  return JSON.stringify(serializeElement(slideShell(slide)));
}

function indexByElementId<T extends { element_id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.element_id, item);
  }
  return map;
}

function resolvePresence<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  id: string,
  conflicts: string[],
  fingerprint: (value: T) => string,
): boolean {
  const inBase = base !== undefined;
  const inLocal = local !== undefined;
  const inRemote = remote !== undefined;

  if (!inBase && inRemote) return true;
  if (!inBase && inLocal && !inRemote) return true;
  if (!inBase && !inRemote && inLocal) return true;

  if (inBase && !inRemote) {
    if (inLocal && fingerprint(local) !== fingerprint(base)) {
      conflicts.push(id);
    }
    return false;
  }

  if (inBase && inRemote) return true;
  return inLocal || inRemote;
}

function pickThreeWay<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  id: string,
  conflicts: string[],
  fingerprint: (value: T) => string,
): T {
  const baseFp = base !== undefined ? fingerprint(base) : null;
  const localFp = local !== undefined ? fingerprint(local) : null;
  const remoteFp = remote !== undefined ? fingerprint(remote) : null;

  if (localFp === baseFp && remoteFp !== baseFp) return remote as T;
  if (localFp !== baseFp && remoteFp === baseFp) return local as T;
  if (localFp !== baseFp && remoteFp !== baseFp) {
    if (localFp === remoteFp) return local as T;
    conflicts.push(id);
    return remote as T;
  }
  return (base ?? local ?? remote) as T;
}

function pickThreeWayJson<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  id: string,
  conflicts: string[],
): T {
  const baseFp = base !== undefined ? JSON.stringify(base) : null;
  const localFp = local !== undefined ? JSON.stringify(local) : null;
  const remoteFp = remote !== undefined ? JSON.stringify(remote) : null;

  if (localFp === baseFp && remoteFp !== baseFp) return remote as T;
  if (localFp !== baseFp && remoteFp === baseFp) return local as T;
  if (localFp !== baseFp && remoteFp !== baseFp) {
    if (localFp === remoteFp) return local as T;
    conflicts.push(id);
    return remote as T;
  }
  return (base ?? local ?? remote) as T;
}

function orderedIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

function mergeOrderedIds(
  baseIds: readonly string[],
  localIds: readonly string[],
  remoteIds: readonly string[],
  mergedById: ReadonlyMap<string, unknown>,
): string[] {
  const result: string[] = [];
  const used = new Set<string>();
  const preferLocalOrder =
    orderedIdsEqual(baseIds, remoteIds) &&
    localIds.every((id) => !id || mergedById.has(id));
  const primaryOrder = preferLocalOrder ? localIds : remoteIds;

  for (const id of primaryOrder) {
    if (!mergedById.has(id) || used.has(id)) continue;
    result.push(id);
    used.add(id);
  }

  for (let i = 0; i < localIds.length; i += 1) {
    const id = localIds[i];
    if (!id || used.has(id) || !mergedById.has(id)) continue;
    if (!baseIds.includes(id) && !remoteIds.includes(id)) {
      const insertAt = Math.min(i, result.length);
      result.splice(insertAt, 0, id);
      used.add(id);
    }
  }

  for (const id of mergedById.keys()) {
    if (!used.has(id)) result.push(id);
  }

  return result;
}

function mergeElementArrayById(
  baseArr: readonly Element[],
  localArr: readonly Element[],
  remoteArr: readonly Element[],
  conflicts: string[],
): Element[] {
  const baseMap = indexByElementId(baseArr);
  const localMap = indexByElementId(localArr);
  const remoteMap = indexByElementId(remoteArr);
  const allIds = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...remoteMap.keys(),
  ]);
  const mergedById = new Map<string, Element>();

  for (const id of allIds) {
    const merged = mergeElementThreeWay(
      baseMap.get(id),
      localMap.get(id),
      remoteMap.get(id),
      id,
      conflicts,
    );
    if (merged) mergedById.set(id, merged);
  }

  const order = mergeOrderedIds(
    baseArr.map((el) => el.element_id),
    localArr.map((el) => el.element_id),
    remoteArr.map((el) => el.element_id),
    mergedById,
  );
  return order.map((id) => mergedById.get(id)!);
}

function childrenOf(el: Element | undefined): Element[] {
  if (!el || !hasChildren(el)) return [];
  return el.children_elements;
}

function mergeElementThreeWay(
  base: Element | undefined,
  local: Element | undefined,
  remote: Element | undefined,
  id: string,
  conflicts: string[],
): Element | undefined {
  if (!resolvePresence(base, local, remote, id, conflicts, elementFingerprint)) {
    return undefined;
  }

  if (hasChildren(base) || hasChildren(local) || hasChildren(remote)) {
    const children = mergeElementArrayById(
      childrenOf(base),
      childrenOf(local),
      childrenOf(remote),
      conflicts,
    );
    const shell = pickThreeWay(
      base ? elementShell(base) : undefined,
      local ? elementShell(local) : undefined,
      remote ? elementShell(remote) : undefined,
      id,
      conflicts,
      shellFingerprint,
    );
    return { ...shell, children_elements: children } as Element;
  }

  return pickThreeWay(base, local, remote, id, conflicts, elementFingerprint);
}

function mergeSlideThreeWay(
  base: SlideElement | undefined,
  local: SlideElement | undefined,
  remote: SlideElement | undefined,
  id: string,
  conflicts: string[],
): SlideElement | undefined {
  if (!resolvePresence(base, local, remote, id, conflicts, elementFingerprint)) {
    return undefined;
  }

  const children = mergeElementArrayById(
    childrenOf(base),
    childrenOf(local),
    childrenOf(remote),
    conflicts,
  );
  const shell = pickThreeWay(
    base ? slideShell(base) : undefined,
    local ? slideShell(local) : undefined,
    remote ? slideShell(remote) : undefined,
    id,
    conflicts,
    slideShellFingerprint,
  );
  return { ...shell, children_elements: children };
}

function mergeSlides(
  base: Scene,
  local: Scene,
  remote: Scene,
  conflictElementIds: string[],
  conflictSlideIds: string[],
): SlideElement[] {
  const baseMap = indexByElementId(base.slide_elements);
  const localMap = indexByElementId(local.slide_elements);
  const remoteMap = indexByElementId(remote.slide_elements);
  const allIds = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const mergedById = new Map<string, SlideElement>();

  for (const id of allIds) {
    const conflictsBefore = conflictElementIds.length;
    const merged = mergeSlideThreeWay(
      baseMap.get(id),
      localMap.get(id),
      remoteMap.get(id),
      id,
      conflictElementIds,
    );
    if (merged) mergedById.set(id, merged);
    if (conflictElementIds.length > conflictsBefore) {
      conflictSlideIds.push(id);
    }
  }

  const order = mergeOrderedIds(
    base.slide_elements.map((slide) => slide.element_id),
    local.slide_elements.map((slide) => slide.element_id),
    remote.slide_elements.map((slide) => slide.element_id),
    mergedById,
  );
  return order.map((id) => mergedById.get(id)!);
}

function mergeIdKeyedTopLevelElements<T extends VtuberElement | AudioElement>(
  baseArr: readonly T[],
  localArr: readonly T[],
  remoteArr: readonly T[],
  conflicts: string[],
): T[] {
  const baseMap = indexByElementId(baseArr);
  const localMap = indexByElementId(localArr);
  const remoteMap = indexByElementId(remoteArr);
  const allIds = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const mergedById = new Map<string, T>();

  for (const id of allIds) {
    const merged = mergeElementThreeWay(
      baseMap.get(id),
      localMap.get(id),
      remoteMap.get(id),
      id,
      conflicts,
    );
    if (merged) mergedById.set(id, merged as T);
  }

  const order = mergeOrderedIds(
    baseArr.map((el) => el.element_id),
    localArr.map((el) => el.element_id),
    remoteArr.map((el) => el.element_id),
    mergedById,
  );
  return order.map((id) => mergedById.get(id)!);
}

function transitionsForMergedScene(
  base: Scene,
  local: Scene,
  remote: Scene,
  mergedSlideCount: number,
  conflicts: string[],
): Transition[] {
  const needed = Math.max(0, mergedSlideCount - 1);
  const slice = (scene: Scene): Transition[] => scene.transitions.slice(0, needed);
  const picked = pickThreeWayJson(
    slice(base),
    slice(local),
    slice(remote),
    "scene:transitions",
    conflicts,
  );
  const out = [...picked];
  while (out.length < needed) out.push(Transitions.NONE);
  return out.slice(0, needed);
}

function mergeQuestionsById(
  baseArr: readonly QuizQuestion[],
  localArr: readonly QuizQuestion[],
  remoteArr: readonly QuizQuestion[],
  conflicts: string[],
): QuizQuestion[] {
  const baseMap = new Map(baseArr.map((q) => [q.question_id, q]));
  const localMap = new Map(localArr.map((q) => [q.question_id, q]));
  const remoteMap = new Map(remoteArr.map((q) => [q.question_id, q]));
  const allIds = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const mergedById = new Map<string, QuizQuestion>();

  for (const id of allIds) {
    const merged = pickThreeWayJson(
      baseMap.get(id),
      localMap.get(id),
      remoteMap.get(id),
      `scene:quiz.questions.${id}`,
      conflicts,
    );
    if (merged !== undefined) mergedById.set(id, merged);
  }

  const order = mergeOrderedIds(
    baseArr.map((q) => q.question_id),
    localArr.map((q) => q.question_id),
    remoteArr.map((q) => q.question_id),
    mergedById,
  );
  return order.map((id) => mergedById.get(id)!);
}

function mergeGradeLevelsById(
  baseArr: readonly QuizGradeLevel[],
  localArr: readonly QuizGradeLevel[],
  remoteArr: readonly QuizGradeLevel[],
  conflicts: string[],
): QuizGradeLevel[] {
  const levelId = (level: QuizGradeLevel) => level.level_id;
  const baseById = new Map(baseArr.map((level) => [levelId(level), level]));
  const localById = new Map(localArr.map((level) => [levelId(level), level]));
  const remoteById = new Map(remoteArr.map((level) => [levelId(level), level]));
  const allIds = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
  const mergedById = new Map<string, QuizGradeLevel>();

  for (const id of allIds) {
    const merged = pickThreeWayJson(
      baseById.get(id),
      localById.get(id),
      remoteById.get(id),
      `scene:quiz.grade_levels.${id}`,
      conflicts,
    );
    if (merged !== undefined) mergedById.set(id, merged);
  }

  const order = mergeOrderedIds(
    baseArr.map(levelId),
    localArr.map(levelId),
    remoteArr.map(levelId),
    mergedById,
  );
  return order.map((id) => mergedById.get(id)!);
}

function mergeQuizConfigThreeWay(
  base: Scene,
  local: Scene,
  remote: Scene,
  conflicts: string[],
): Scene["quiz"] {
  const baseQuiz = base.quiz ?? null;
  const localQuiz = local.quiz ?? null;
  const remoteQuiz = remote.quiz ?? null;

  if (
    localQuiz === null &&
    baseQuiz !== null &&
    remoteQuiz !== null &&
    JSON.stringify(baseQuiz) === JSON.stringify(remoteQuiz)
  ) {
    return null;
  }

  if (
    !resolvePresence(
      baseQuiz ?? undefined,
      localQuiz ?? undefined,
      remoteQuiz ?? undefined,
      "scene:quiz",
      conflicts,
      (quiz) => JSON.stringify(quiz),
    )
  ) {
    return null;
  }

  const fallback = baseQuiz ?? localQuiz ?? remoteQuiz;
  if (!fallback) return null;

  const b = baseQuiz ?? fallback;
  const r = remoteQuiz ?? fallback;
  // local without a quiz means the quiz config wasn't changed; in the three-way merge the local side aligns with base — don't pass undefined (it would be misjudged as deleting the field).
  const pickLocalQuizField = <T>(pick: (quiz: QuizConfig) => T): T =>
    localQuiz === null ? pick(b) : pick(localQuiz);
  const localQuestions = localQuiz?.questions ?? b.questions;
  const localGradeLevels = localQuiz?.grade_levels ?? b.grade_levels;

  const merged: QuizConfig = {
    enabled: pickThreeWayJson(
      b.enabled,
      pickLocalQuizField((quiz) => quiz.enabled),
      r.enabled,
      "scene:quiz.enabled",
      conflicts,
    ),
    total_score: pickThreeWayJson(
      b.total_score,
      pickLocalQuizField((quiz) => quiz.total_score),
      r.total_score,
      "scene:quiz.total_score",
      conflicts,
    ),
    score_allocation: pickThreeWayJson(
      b.score_allocation,
      pickLocalQuizField((quiz) => quiz.score_allocation),
      r.score_allocation,
      "scene:quiz.score_allocation",
      conflicts,
    ),
    time_limit_minutes: pickThreeWayJson(
      b.time_limit_minutes,
      pickLocalQuizField((quiz) => quiz.time_limit_minutes),
      r.time_limit_minutes,
      "scene:quiz.time_limit_minutes",
      conflicts,
    ),
    questions: mergeQuestionsById(b.questions, localQuestions, r.questions, conflicts),
    grade_levels: mergeGradeLevelsById(
      b.grade_levels,
      localGradeLevels,
      r.grade_levels,
      conflicts,
    ),
    score_summary: pickThreeWayJson(
      b.score_summary,
      pickLocalQuizField((quiz) => quiz.score_summary),
      r.score_summary,
      "scene:quiz.score_summary",
      conflicts,
    ),
  };

  return merged;
}

/**
 * Three-way merge of courseware scenes keyed by `element_id`.
 * Non-conflicting local and remote edits are both kept; conflicts prefer `remote`.
 */
export function mergeCoursewareScenesThreeWay(
  base: Scene,
  local: Scene,
  remote: Scene,
): SceneMergeResult {
  const conflictElementIds: string[] = [];
  const conflictSlideIds: string[] = [];

  const slide_elements = mergeSlides(
    base,
    local,
    remote,
    conflictElementIds,
    conflictSlideIds,
  );
  const vtuber_elements = mergeIdKeyedTopLevelElements(
    base.vtuber_elements,
    local.vtuber_elements,
    remote.vtuber_elements,
    conflictElementIds,
  );
  const audio_elements = mergeIdKeyedTopLevelElements(
    base.audio_elements,
    local.audio_elements,
    remote.audio_elements,
    conflictElementIds,
  );

  const name = pickThreeWayJson(base.name, local.name, remote.name, "scene:name", conflictElementIds);
  const controller = pickThreeWayJson(
    base.controller,
    local.controller,
    remote.controller,
    "scene:controller",
    conflictElementIds,
  );
  const preset_script = pickThreeWayJson(
    base.preset_script,
    local.preset_script,
    remote.preset_script,
    "scene:preset_script",
    conflictElementIds,
  );
  const metadata = pickThreeWayJson(
    base.metadata,
    local.metadata,
    remote.metadata,
    "scene:metadata",
    conflictElementIds,
  );
  const quiz = mergeQuizConfigThreeWay(base, local, remote, conflictElementIds);
  const transitions = transitionsForMergedScene(
    base,
    local,
    remote,
    slide_elements.length,
    conflictElementIds,
  );

  const scene: Scene = {
    scene_id: local.scene_id,
    name,
    slide_elements,
    vtuber_elements,
    audio_elements,
    controller,
    transitions,
    preset_script,
    metadata,
    quiz,
  };

  return {
    scene: deserializeScene(serializeScene(scene)),
    conflictElementIds: [...new Set(conflictElementIds)],
    conflictSlideIds: [...new Set(conflictSlideIds)],
  };
}
