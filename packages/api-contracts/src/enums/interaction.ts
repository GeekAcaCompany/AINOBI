// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Interaction domain enums.
 *
 * This module defines the enums for interactive learning activities.
 */

/**
 * Interaction question type (PG enum type: interactionquestiontype)
 *
 * The question types an interaction section may contain.
 */
export const InteractionQuestionType = {
  /** Choice question (single or multiple choice) */
  MULTIPLE_CHOICE: "multiple_choice",
  /** Fill-in-the-blank question (cloze form, e.g. "我是[大]聪明"). Handled much like TEXT, but its type value is "fill" */
  FILL: "fill",
  /** Open text answer question (TEXT stays in case it ever needs to differ from fill-in-the-blank) */
  TEXT: "text",
  /** Voice answer question (AI scored) */
  AUDIO: "audio",
} as const;
export type InteractionQuestionType =
  (typeof InteractionQuestionType)[keyof typeof InteractionQuestionType];

/**
 * Interaction content type
 *
 * The content element types an interaction section may contain. No matching PG enum type: question components are embedded in
 * the interaction side's content_elements JSON.
 */
export const InteractionContentType = {
  // Pure content components
  /** Text content */
  TEXT: "text",
  /** Image content */
  IMAGE: "image",
  /** Audio content */
  AUDIO: "audio",
  /** LLM-generated explanation content */
  LLM_EXPLANATION: "llm_explanation",

  // Question-like components (embedded in content_elements)
  /** Choice question component */
  QUESTION_MULTIPLE_CHOICE: "question_multiple_choice",
  /** Text question component */
  QUESTION_TEXT: "question_text",
  /** Voice question component */
  QUESTION_AUDIO: "question_audio",
} as const;
export type InteractionContentType =
  (typeof InteractionContentType)[keyof typeof InteractionContentType];

/**
 * AI scoring template
 *
 * The templates available for AI scoring of student answers. No matching PG enum type (used at the config layer).
 */
export const AIScoringTemplate = {
  /** Deterministic exact-match scoring */
  EXACT_MATCH: "exact_match",
  /** Custom template scoring via template_id */
  CUSTOM: "custom",
} as const;
export type AIScoringTemplate = (typeof AIScoringTemplate)[keyof typeof AIScoringTemplate];

/**
 * Prompt template type (PG enum type: prompttemplatetype)
 *
 * Prompt template types matching the interaction question types; each template type is used for AI scoring of
 * a specific question type.
 */
export const PromptTemplateType = {
  /** Template for choice questions */
  MULTIPLE_CHOICE: "multiple_choice",
  /** Template for text answer questions */
  TEXT: "text",
  /** Template for voice answer questions */
  AUDIO: "audio",
  /** Template for LLM explanation generation */
  LLM_EXPLANATION: "llm_explanation",
} as const;
export type PromptTemplateType =
  (typeof PromptTemplateType)[keyof typeof PromptTemplateType];
