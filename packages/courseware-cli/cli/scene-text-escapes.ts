// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeMultilineCliText } from "./cli-text.ts";
import type {
  Element,
  QuizAstNode,
  QuizAstPropValue,
  QuizQuestion,
  Scene,
} from "@ainobi/courseware-core";

const TEXT_PROP_KEYS = new Set(["placeholder"]);

const normalizeEscapedText = (value: string): string => normalizeMultilineCliText(value);

const normalizeQuizAstNode = (node: QuizAstNode): QuizAstNode => {
  if (node.kind === "text") {
    return { ...node, text: normalizeEscapedText(node.text) };
  }
  if (node.kind === "interp") return node;
  if (node.kind === "stateBranch") {
    return {
      ...node,
      children: node.children.map(normalizeQuizAstNode),
    };
  }
  const nextProps: Record<string, QuizAstPropValue> = { ...node.props };
  for (const [key, value] of Object.entries(node.props)) {
    if (typeof value === "string" && TEXT_PROP_KEYS.has(key)) {
      nextProps[key] = normalizeEscapedText(value);
    }
  }
  return {
    ...node,
    props: nextProps,
    children: node.children.map(normalizeQuizAstNode),
  };
};

const normalizeQuizQuestion = (question: QuizQuestion): QuizQuestion => {
  const common = {
    title: normalizeEscapedText(question.title),
    explanation: normalizeEscapedText(question.explanation),
    react_layout: normalizeQuizAstNode(question.react_layout),
  };

  switch (question.type) {
    case "fill_blank":
      return {
        ...question,
        ...common,
        grading_criteria: normalizeEscapedText(question.grading_criteria),
      };
    case "essay":
      return {
        ...question,
        ...common,
        reference_answer: normalizeEscapedText(question.reference_answer),
        grading_criteria: normalizeEscapedText(question.grading_criteria),
      };
    case "shadowing":
      return {
        ...question,
        ...common,
        reference_text: normalizeEscapedText(question.reference_text),
      };
    case "speech":
      return {
        ...question,
        ...common,
        prompt: normalizeEscapedText(question.prompt),
        reference_text: normalizeEscapedText(question.reference_text),
        grading_criteria: normalizeEscapedText(question.grading_criteria),
      };
    case "single_choice":
    case "multiple_choice":
      return { ...question, ...common };
  }
};

const normalizeElement = (element: Element): Element => {
  let next = element;

  if (element.element_type === "text" && typeof element.text === "string") {
    const text = normalizeEscapedText(element.text);
    if (text !== element.text) next = { ...next, text } as Element;
  }

  if (element.element_type === "textarea") {
    const value = normalizeEscapedText(element.value);
    const placeholder = normalizeEscapedText(element.placeholder);
    if (value !== element.value || placeholder !== element.placeholder) {
      next = { ...next, value, placeholder } as Element;
    }
  }

  if (element.element_type === "narration") {
    const script = normalizeEscapedText(element.script);
    const transcript = normalizeEscapedText(element.transcript);
    if (script !== element.script || transcript !== element.transcript) {
      next = { ...next, script, transcript } as Element;
    }
  }

  if ("children_elements" in element && Array.isArray(element.children_elements)) {
    const children = element.children_elements.map((child) => normalizeElement(child as Element));
    const changed = children.some((child, i) => child !== element.children_elements[i]);
    if (changed) {
      next = { ...next, children_elements: children } as Element;
    }
  }

  return next;
};

/**
 * Decode agent shell quirks where literal `\n` was stored instead of real newlines.
 * Safe to run on every parse/save: strings without backslashes are unchanged.
 */
export const normalizeLiteralEscapesInScene = (scene: Scene): Scene => {
  const slide_elements = scene.slide_elements.map((slide) => {
    const children_elements = slide.children_elements.map((child) => normalizeElement(child));
    const changed = children_elements.some((child, i) => child !== slide.children_elements[i]);
    return changed ? { ...slide, children_elements } : slide;
  });

  const quiz = scene.quiz;
  if (!quiz?.questions?.length) {
    const slidesChanged = slide_elements.some((slide, i) => slide !== scene.slide_elements[i]);
    return slidesChanged ? { ...scene, slide_elements } : scene;
  }

  const questions = quiz.questions.map(normalizeQuizQuestion);
  const quizChanged = questions.some((q, i) => q !== quiz.questions[i]);
  const slidesChanged = slide_elements.some((slide, i) => slide !== scene.slide_elements[i]);

  if (!quizChanged && !slidesChanged) return scene;

  return {
    ...scene,
    slide_elements,
    quiz: quizChanged ? { ...quiz, questions } : quiz,
  };
};
