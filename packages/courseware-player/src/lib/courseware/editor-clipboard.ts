// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, GroupElement, HtmlElement, QuizSlideElement } from "@ainobi/courseware-core/elements.ts";
import type { QuizConfig, QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

export const COURSEWARE_EDITOR_CLIPBOARD_MARKER = "__coursewareEditorClipboard" as const;

export type CoursewareEditorClipboardPayload = {
  [COURSEWARE_EDITOR_CLIPBOARD_MARKER]: true;
  version: 1;
  sourceCoursewareId: string;
  copiedAt: string;
  elements: Element[];
  quizQuestions: QuizQuestion[];
};

export const collectQuizQuestionIdsFromElements = (roots: readonly Element[]): Set<string> => {
  const ids = new Set<string>();
  const walk = (el: Element): void => {
    if (el.element_type === "quiz") {
      const qid = (el as QuizSlideElement).quiz_question_id?.trim();
      if (qid) ids.add(qid);
    }
    if (el.element_type === "group") {
      for (const ch of (el as GroupElement).children_elements) {
        walk(ch as Element);
      }
    }
    if (el.element_type === "html") {
      for (const ch of (el as HtmlElement).children_elements) {
        walk(ch as Element);
      }
    }
  };
  for (const root of roots) walk(root);
  return ids;
};

export const collectQuizQuestionsForElements = (
  elements: readonly Element[],
  quiz: QuizConfig | null | undefined,
): QuizQuestion[] => {
  if (!quiz?.questions.length) return [];
  const needed = collectQuizQuestionIdsFromElements(elements);
  if (needed.size === 0) return [];
  return quiz.questions.filter((q) => needed.has(q.question_id));
};

export const buildCoursewareEditorClipboardPayload = (
  sourceCoursewareId: string,
  elements: readonly Element[],
  quiz: QuizConfig | null | undefined,
): CoursewareEditorClipboardPayload => ({
  [COURSEWARE_EDITOR_CLIPBOARD_MARKER]: true,
  version: 1,
  sourceCoursewareId: sourceCoursewareId.trim(),
  copiedAt: new Date().toISOString(),
  elements: JSON.parse(JSON.stringify(elements)) as Element[],
  quizQuestions: JSON.parse(JSON.stringify(collectQuizQuestionsForElements(elements, quiz))) as QuizQuestion[],
});

export const serializeCoursewareEditorClipboard = (payload: CoursewareEditorClipboardPayload): string =>
  JSON.stringify(payload);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseCoursewareEditorClipboard = (text: string): CoursewareEditorClipboardPayload | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed[COURSEWARE_EDITOR_CLIPBOARD_MARKER] !== true) return null;
  if (parsed.version !== 1) return null;
  if (typeof parsed.sourceCoursewareId !== "string") return null;
  if (!Array.isArray(parsed.elements)) return null;
  if (!Array.isArray(parsed.quizQuestions)) return null;
  return parsed as CoursewareEditorClipboardPayload;
};

export const writeCoursewareEditorClipboard = async (
  payload: CoursewareEditorClipboardPayload,
): Promise<boolean> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(serializeCoursewareEditorClipboard(payload));
    return true;
  } catch (error) {
    console.warn("Failed to write courseware editor clipboard.", error);
    return false;
  }
};

export const readCoursewareEditorClipboard = async (): Promise<CoursewareEditorClipboardPayload | null> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
  try {
    const text = await navigator.clipboard.readText();
    return parseCoursewareEditorClipboard(text);
  } catch (error) {
    console.warn("Failed to read courseware editor clipboard.", error);
    return null;
  }
};
