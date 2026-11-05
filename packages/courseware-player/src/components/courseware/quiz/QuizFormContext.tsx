// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Quiz runtime state shared by every functional Quiz component below the
 * `QuizRenderer` root.
 *
 * The host (player / preview / editor) owns three things and passes them
 * through `QuizContainer`:
 *   - the canonical `QuizQuestion` from `scene.quiz.questions[]`,
 *   - the lifecycle callbacks (`onSubmit`, `onSkip`, `onAdvance`, `onReset`),
 *   - the per-attempt grading result (score / feedback / advance gating).
 *
 * Everything else (selection state, blank input values, submission progress)
 * is managed inside this context so the AST nodes stay declarative.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { QuizQuestion, QuizQuestionType } from "@ainobi/courseware-core/quiz.ts";

export interface QuizSubmissionPayload {
  question_id: string;
  question_type: QuizQuestionType;
  selected_option_ids: string[];
  input_values: Record<string, string>;
}

export interface QuizRuntimeState {
  /** Whether the user has submitted at least once for this attempt. */
  submitted: boolean;
  /** Whether a submit is in flight. */
  submitting: boolean;
  /** Earned score for the current attempt (null until submit completes). */
  earnedScore: number | null;
  /** Free-form feedback string returned by the host. */
  feedback: string | null;
  /** Whether the host has cleared the "block playback until quiz solved" gate. */
  canAdvance: boolean;
  /** Whether the user opted out (non-required questions). */
  skipped: boolean;
}

export interface QuizFormContextValue extends QuizRuntimeState {
  question: QuizQuestion;
  questionType: QuizQuestionType;
  questionId: string;
  totalScore: number;
  optionIds: readonly string[];
  blankIds: readonly string[];
  required: boolean;
  allowResubmit: boolean;
  showFeedbackScore: boolean;

  /**
   * Layout-editor only: force every interaction-gated component (explanation,
   * score, feedback, continue / resubmit / skip buttons) to render regardless
   * of the live submit/advance state, so authors can style them. Never set in
   * the real player or preview.
   */
  editorReveal?: boolean;

  /** Current selection state for choice questions. */
  selectedOptionIds: readonly string[];
  /** Whether the option is currently selected. */
  isOptionSelected(optionId: string): boolean;
  /** Toggle selection. For single_choice this replaces; for multiple_choice it toggles. */
  toggleOption(optionId: string): void;

  /** Per-named-input value (fill_blank uses blank_id; essay uses "answer"). */
  inputValues: Readonly<Record<string, string>>;
  setInputValue(name: string, value: string): void;
  getInputValue(name: string): string;

  /** Submit pipeline. */
  submit(): void | Promise<void>;
  /** Reset selection/inputs/result so the user can try again (allow_resubmit only). */
  reset(): void;
  /** Mark non-required questions as intentionally skipped. */
  skip(): void;
  /** Advance to the next slide / question. */
  advance(): void;

  /** Inline submission error (e.g. "请先填写所有空"). */
  inlineError: string | null;

  /** Shadowing / speech: host-managed recorder (preview / player). */
  recordingFieldName: string | null;
  recordingElapsedSec: number;
  recordedBlobUrl: string | null;
  recordedDurationSec: number;
  onToggleRecord?: (fieldName: string) => void;
}

const QuizFormContext = createContext<QuizFormContextValue | null>(null);

export interface QuizFormProviderProps {
  value: QuizFormContextValue;
  children: ReactNode;
}

export const QuizFormProvider = ({ value, children }: QuizFormProviderProps) => (
  <QuizFormContext.Provider value={value}>{children}</QuizFormContext.Provider>
);

/**
 * Hook used by every functional `Quiz*` component.
 *
 * Returns `null` when the consumer is rendered outside a `<QuizContainer>` —
 * this lets callers render gracefully in the editor preview where the AST is
 * shown without a live submission pipeline.
 */
export const useQuizFormContext = (): QuizFormContextValue | null =>
  useContext(QuizFormContext);

/** Same as {@link useQuizFormContext} but throws when missing. */
export const useRequiredQuizFormContext = (): QuizFormContextValue => {
  const ctx = useContext(QuizFormContext);
  if (!ctx) {
    throw new Error(
      "Quiz functional components must be rendered inside <QuizContainer> / <QuizRenderer>.",
    );
  }
  return ctx;
};
