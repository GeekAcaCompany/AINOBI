// SPDX-License-Identifier: AGPL-3.0-only
import {
  cloneQuizQuestionWithFreshIds,
  maybeApplyEvenQuizScores,
  newQuizGradeLevel,
} from "@ainobi/courseware-core/quiz.ts";
import type {
  Element,
  GroupElement,
  HtmlElement,
  NarrationElement,
  QuizSlideElement,
  SlideElement,
} from "@ainobi/courseware-core/elements.ts";
import type { QuizConfig, QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

const genId = (prefix: string): string => {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
};

/** @see {@link cloneQuizQuestionWithFreshIds} */
export const cloneQuizQuestionForCanvasPaste = cloneQuizQuestionWithFreshIds;

const collectSubtreeElementIds = (el: Element, into: Set<string>): void => {
  into.add(el.element_id);
  if (el.element_type === "group") {
    for (const ch of (el as GroupElement).children_elements) {
      collectSubtreeElementIds(ch as Element, into);
    }
  }
  if (el.element_type === "html") {
    for (const ch of (el as HtmlElement).children_elements) {
      collectSubtreeElementIds(ch as Element, into);
    }
  }
};

const buildElementIdMapForPaste = (roots: Element[]): Map<string, string> => {
  const allIds = new Set<string>();
  for (const r of roots) {
    collectSubtreeElementIds(r, allIds);
  }
  const idMap = new Map<string, string>();
  for (const id of allIds) {
    idMap.set(id, genId("el"));
  }
  return idMap;
};

const remapElementTreeForPaste = (el: Element, idMap: Map<string, string>): Element => {
  const mapId = (id: string): string => (idMap.has(id) ? idMap.get(id)! : id);
  const nextId = mapId(el.element_id);
  let next: Element = { ...el, element_id: nextId } as Element;

  if (next.element_type === "narration") {
    const n = next as NarrationElement;
    next = {
      ...n,
      vtuber_element_id: n.vtuber_element_id ? mapId(n.vtuber_element_id) : n.vtuber_element_id,
    } as NarrationElement;
  } else if (next.element_type === "group") {
    const g = next as GroupElement;
    next = {
      ...g,
      children_elements: g.children_elements.map((ch) =>
        remapElementTreeForPaste(ch as Element, idMap),
      ),
    } as GroupElement;
  } else if (next.element_type === "html") {
    const h = next as HtmlElement;
    next = {
      ...h,
      children_elements: h.children_elements.map((ch) =>
        remapElementTreeForPaste(ch as Element, idMap),
      ),
    } as HtmlElement;
  }

  if (next.event_bindings.length > 0) {
    next = {
      ...next,
      event_bindings: next.event_bindings.map((b) => ({
        ...b,
        binding_id: genId("bind"),
      })),
    } as Element;
  }

  if (next.highlight_segments && next.highlight_segments.length > 0) {
    next = {
      ...next,
      highlight_segments: next.highlight_segments.map((h) => ({
        ...h,
        highlight_id: genId("hl"),
      })),
    } as Element;
  }

  return next;
};

const findSourceQuizQuestion = (
  questionId: string,
  quiz: QuizConfig | null | undefined,
  extraQuestions: readonly QuizQuestion[],
): QuizQuestion | undefined =>
  quiz?.questions.find((q) => q.question_id === questionId) ??
  extraQuestions.find((q) => q.question_id === questionId);

/** Remap element subtree IDs (and quiz bindings) for an independent canvas copy. */
export const cloneSlideChildrenWithFreshIds = (
  sources: Element[],
  quiz: QuizConfig | null | undefined,
  extraQuestions: readonly QuizQuestion[] = [],
): { children: Element[]; newQuestions: QuizQuestion[] } => {
  const idMap = buildElementIdMapForPaste(sources);
  let remapped = sources.map((el) => remapElementTreeForPaste(el, idMap));

  const quizIdMap = new Map<string, string>();
  const newQuestions: QuizQuestion[] = [];
  for (const el of remapped) {
    if (el.element_type !== "quiz") continue;
    const oldQid = (el as QuizSlideElement).quiz_question_id;
    if (!oldQid || quizIdMap.has(oldQid)) continue;
    const sourceQuiz = findSourceQuizQuestion(oldQid, quiz, extraQuestions);
    if (!sourceQuiz) continue;
    const clonedQ = cloneQuizQuestionForCanvasPaste(sourceQuiz);
    quizIdMap.set(oldQid, clonedQ.question_id);
    newQuestions.push(clonedQ);
  }

  remapped = remapped.map((el) => {
    if (el.element_type !== "quiz") return el;
    const wrap = el as QuizSlideElement;
    const oldQid = wrap.quiz_question_id;
    if (!oldQid) return el;
    const nu = quizIdMap.get(oldQid);
    if (nu) return { ...wrap, quiz_question_id: nu };
    const stillExists = quiz?.questions.some((q) => q.question_id === oldQid);
    return stillExists ? el : { ...wrap, quiz_question_id: "" };
  });

  return { children: remapped, newQuestions };
};

export const cloneSlideChildrenIndependent = (
  children: readonly Element[],
  quiz: QuizConfig | null | undefined,
  extraQuestions: readonly QuizQuestion[] = [],
): { children: Element[]; newQuestions: QuizQuestion[] } =>
  cloneSlideChildrenWithFreshIds(
    JSON.parse(JSON.stringify(children)) as Element[],
    quiz,
    extraQuestions,
  );

export const mergeClonedQuizQuestionsIntoConfig = (
  prevQuiz: QuizConfig | null | undefined,
  newQuestions: QuizQuestion[],
  defaultGradeLevels: Parameters<typeof newQuizGradeLevel>[0][],
): QuizConfig | null | undefined => {
  if (newQuestions.length === 0) return prevQuiz;
  const baseQuiz: QuizConfig =
    prevQuiz ?? {
      enabled: true,
      total_score: 100,
      score_allocation: "even_split",
      time_limit_minutes: null,
      questions: [],
      grade_levels: defaultGradeLevels.map((g) => newQuizGradeLevel(g)),
      score_summary: null,
    };
  let nextQuiz: QuizConfig = {
    ...baseQuiz,
    enabled: true,
    questions: [...baseQuiz.questions, ...newQuestions],
  };
  return maybeApplyEvenQuizScores(nextQuiz) ?? nextQuiz;
};

export const cloneSlideForDuplicate = (
  source: SlideElement,
  quiz: QuizConfig | null | undefined,
  slideCopyName: string,
): { slide: SlideElement; newQuestions: QuizQuestion[] } => {
  const slideDraft = JSON.parse(JSON.stringify(source)) as SlideElement;
  const { children, newQuestions } = cloneSlideChildrenIndependent(slideDraft.children_elements, quiz);
  return {
    slide: {
      ...slideDraft,
      element_id: genId("el_slide"),
      name: slideCopyName,
      children_elements: children,
      event_bindings: slideDraft.event_bindings.map((b: SlideElement["event_bindings"][number]) => ({
        ...b,
        binding_id: genId("bind"),
      })),
      highlight_segments: slideDraft.highlight_segments?.map(
        (h: NonNullable<SlideElement["highlight_segments"]>[number]) => ({
          ...h,
          highlight_id: genId("hl"),
        }),
      ),
    },
    newQuestions,
  };
};
