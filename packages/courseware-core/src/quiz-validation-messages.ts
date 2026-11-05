// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Quiz validation message catalog. Validation emits a key plus variables;
 * hosts inject a formatter (the editor UI maps keys onto its locale files),
 * and the default renders the agent-facing English with CLI hints.
 */

type Vars<K extends string = never> = Record<K, string | number>;

export interface QuizValidationMessageVars {
  notEnabled: Vars;
  totalScoreInvalid: Vars;
  noQuestions: Vars;
  questionScoreInvalid: Vars<"index">;
  passScoreExceedsScore: Vars<"index">;
  advanceScoreExceedsScore: Vars<"index">;
  titleRequired: Vars<"index">;
  singleChoiceMinOptions: Vars<"index">;
  singleChoiceOneCorrect: Vars<"index">;
  multipleChoiceMinOptions: Vars<"index">;
  multipleChoiceMinCorrect: Vars<"index">;
  fillBlankMinBlanks: Vars<"index">;
  fillBlankAnswerRequired: Vars<"index" | "blank">;
  fillBlankAiCriteriaRequired: Vars<"index">;
  speechCriteriaRequired: Vars<"index">;
  essayCriteriaRequired: Vars<"index">;
  scoreSumMismatch: Vars<"sum" | "total">;
  gradeLevelLabelRequired: Vars<"index">;
  gradeLevelThresholdOutOfRange: Vars<"index">;
  gradeLevelThresholdDuplicate: Vars<"index">;
  gradeLevelZeroRequired: Vars;
  questionNotOnSlide: Vars<"index" | "questionId" | "type">;
  questionSlideBindingMissing: Vars<"index" | "slideIndex">;
}

export type QuizValidationMessageKey = keyof QuizValidationMessageVars;

export type QuizValidationMessages = <K extends QuizValidationMessageKey>(
  key: K,
  variables?: QuizValidationMessageVars[K],
) => string;

const ENGLISH: { [K in QuizValidationMessageKey]: (v: QuizValidationMessageVars[K]) => string } = {
  notEnabled: () =>
    "The quiz has questions but is not enabled; run `ainobi quiz init` (keeps existing questions and enables the quiz) or set `\"enabled\": true` in batch `quiz.init`",
  totalScoreInvalid: () => "Quiz total score must be greater than 0",
  noQuestions: () => "Add at least one question",
  questionScoreInvalid: (v) => `Question ${v.index}: score must be greater than 0`,
  passScoreExceedsScore: (v) => `Question ${v.index}: the scoring threshold cannot exceed the question score`,
  advanceScoreExceedsScore: (v) => `Question ${v.index}: the pass threshold cannot exceed the question score`,
  titleRequired: (v) => `Question ${v.index}: the question content is required`,
  singleChoiceMinOptions: (v) => `Question ${v.index} (single choice): at least 2 options are required`,
  singleChoiceOneCorrect: (v) => `Question ${v.index} (single choice): exactly 1 correct option is required`,
  multipleChoiceMinOptions: (v) => `Question ${v.index} (multiple choice): at least 2 options are required`,
  multipleChoiceMinCorrect: (v) =>
    `Question ${v.index} (multiple choice): at least 2 correct options are required`,
  fillBlankMinBlanks: (v) => `Question ${v.index} (fill in the blank): at least 1 blank is required`,
  fillBlankAnswerRequired: (v) => `Question ${v.index}, blank ${v.blank}: a reference answer is required`,
  fillBlankAiCriteriaRequired: (v) =>
    `Question ${v.index} (fill in the blank): AI grading is selected, so grading criteria are required`,
  speechCriteriaRequired: (v) => `Question ${v.index} (speech): grading criteria are required (used for AI grading)`,
  essayCriteriaRequired: (v) => `Question ${v.index} (essay): grading criteria are required (used for AI grading)`,
  scoreSumMismatch: (v) =>
    `The sum of question scores (${v.sum}) must equal the quiz total score (${v.total})`,
  gradeLevelLabelRequired: (v) => `Grade level ${v.index}: a name is required`,
  gradeLevelThresholdOutOfRange: (v) => `Grade level ${v.index}: the threshold must be between 0 and the total score`,
  gradeLevelThresholdDuplicate: (v) => `Grade level ${v.index}: the threshold duplicates another grade level`,
  gradeLevelZeroRequired: () => "At least 1 grade level with min_score = 0 is required as the fallback",
  questionNotOnSlide: (v) =>
    `Question ${v.index} (${v.questionId}) is not inserted on any slide. ` +
    `Run \`ainobi quiz prune-orphans\` to remove orphaned questions, ` +
    `or run \`ainobi quiz insert <slide_index> --type ${v.type}\` on a slide to create the canvas element and the question together.`,
  questionSlideBindingMissing: (v) =>
    `Question ${v.index}: no element_type:"quiz" element binding found on slide ${v.slideIndex}.`,
};

/** Agent-facing English (the CLI output). */
export const defaultQuizValidationMessages: QuizValidationMessages = (key, variables) =>
  (ENGLISH[key] as (v: typeof variables) => string)(variables ?? ({} as never));
