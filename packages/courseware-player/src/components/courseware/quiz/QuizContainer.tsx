// SPDX-License-Identifier: AGPL-3.0-only
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18nNew } from "../../../hooks/useI18nNew.tsx";

import type {
  QuizFillBlankQuestion,
  QuizMultipleChoiceQuestion,
  QuizQuestion,
  QuizSingleChoiceQuestion,
} from "@ainobi/courseware-core/quiz.ts";

import {
  QuizFormProvider,
  type QuizFormContextValue,
  type QuizRuntimeState,
  type QuizSubmissionPayload,
} from "./QuizFormContext.tsx";

export interface QuizContainerHostHooks {
  /**
   * Submit the current attempt. Resolve the returned promise to mark the
   * submission complete; throw to surface an error.
   */
  onSubmit?: (
    payload: QuizSubmissionPayload,
  ) => Promise<QuizRuntimeState> | QuizRuntimeState | void;
  /** Triggered when the user picks "skip" on a non-required question. */
  onSkip?: () => void;
  /** Triggered when the user picks "continue" (advance gate already opened). */
  onAdvance?: () => void;
  /** Triggered when allow_resubmit is true and the user picks "重新作答". */
  onReset?: () => void;
  /** Shadowing / speech: start or stop recording for `fieldName`. */
  onToggleRecord?: (fieldName: string) => void;
  /** Mirror fill/essay inputs to the host (preview player state). */
  onInputChange?: (fieldName: string, value: string) => void;
}

export interface QuizContainerRecordingState {
  recordingFieldName?: string | null;
  recordingElapsedSec?: number;
  recordedBlobUrl?: string | null;
  recordedDurationSec?: number;
}

/** Host-owned choice / blank values when the preview player mirrors attempt state. */
export interface QuizContainerSelectionState {
  selectedOptionIds: readonly string[];
  inputValues: Readonly<Record<string, string>>;
}

export interface QuizContainerProps extends QuizContainerHostHooks {
  question: QuizQuestion;
  /**
   * Host-managed quiz runtime state. When provided, `QuizContainer` becomes a
   * controlled component (the host owns submitted / score / feedback / advance
   * gating). When omitted, the container manages its own attempt-local state.
   */
  state?: QuizRuntimeState;
  /**
   * Host-owned selection / input values. When provided together with `state`,
   * the container renders from the host so reloaded attempts show prior answers.
   */
  selection?: QuizContainerSelectionState;
  /** Choice toggle callback used with `selection` (host updates selection state). */
  onToggleOption?: (optionId: string) => void;
  /** Host recorder state for shadowing / speech (paired with `onToggleRecord`). */
  recording?: QuizContainerRecordingState;
  /** padding / gap forwarded as inline style for the AST `<QuizContainer>` slot. */
  padding?: number | string;
  gap?: number | string;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
  /** Layout-editor: reveal interaction-gated components (see context field). */
  editorReveal?: boolean;
}

const DEFAULT_STATE: QuizRuntimeState = {
  submitted: false,
  submitting: false,
  earnedScore: null,
  feedback: null,
  canAdvance: false,
  skipped: false,
};

/**
 * Root for every quiz tree. Wraps the AST children in a `<form>` and provides
 * {@link QuizFormContext} so descendant `Quiz*` components can drive
 * selection, input state, and submission.
 */
export const QuizContainer = ({
  question,
  state: controlledState,
  selection: controlledSelection,
  onSubmit,
  onSkip,
  onAdvance,
  onReset,
  onToggleRecord,
  onInputChange,
  onToggleOption,
  recording,
  padding,
  gap,
  className,
  style,
  id,
  children,
  editorReveal,
}: QuizContainerProps) => {
  const { t } = useI18nNew();
  const [internalState, setInternalState] = useState<QuizRuntimeState>(DEFAULT_STATE);
  const state = controlledState ?? internalState;

  const isSelectionControlled = controlledSelection != null;
  const [internalSelectedOptionIds, setInternalSelectedOptionIds] = useState<string[]>([]);
  const [internalInputValues, setInternalInputValues] = useState<Record<string, string>>({});
  const selectedOptionIds = isSelectionControlled
    ? [...controlledSelection.selectedOptionIds]
    : internalSelectedOptionIds;
  const inputValues = isSelectionControlled
    ? { ...controlledSelection.inputValues }
    : internalInputValues;
  const [inlineError, setInlineError] = useState<string | null>(null);

  const optionIds = useMemo(() => {
    if (question.type === "single_choice" || question.type === "multiple_choice") {
      return (
        question as QuizSingleChoiceQuestion | QuizMultipleChoiceQuestion
      ).options.map((opt) => opt.option_id);
    }
    return [] as string[];
  }, [question]);

  const blankIds = useMemo(() => {
    if (question.type === "fill_blank") {
      return (question as QuizFillBlankQuestion).blanks.map((b) => b.blank_id);
    }
    return [] as string[];
  }, [question]);

  const toggleOption = useCallback(
    (optionId: string) => {
      setInlineError(null);
      if (isSelectionControlled) {
        onToggleOption?.(optionId);
        return;
      }
      if (question.type === "single_choice") {
        setInternalSelectedOptionIds((cur) => (cur[0] === optionId ? cur : [optionId]));
        return;
      }
      if (question.type === "multiple_choice") {
        setInternalSelectedOptionIds((cur) =>
          cur.includes(optionId) ? cur.filter((id) => id !== optionId) : [...cur, optionId],
        );
      }
    },
    [isSelectionControlled, onToggleOption, question.type],
  );

  const setInputValue = useCallback(
    (name: string, value: string) => {
      setInlineError(null);
      if (isSelectionControlled) {
        onInputChange?.(name, value);
        return;
      }
      setInternalInputValues((prev) => (prev[name] === value ? prev : { ...prev, [name]: value }));
      onInputChange?.(name, value);
    },
    [isSelectionControlled, onInputChange],
  );

  const getInputValue = useCallback(
    (name: string) => inputValues[name] ?? "",
    [inputValues],
  );

  const isOptionSelected = useCallback(
    (optionId: string) => selectedOptionIds.includes(optionId),
    [selectedOptionIds],
  );

  const reset = useCallback(() => {
    if (!isSelectionControlled) {
      setInternalSelectedOptionIds([]);
      setInternalInputValues({});
    }
    setInlineError(null);
    if (!controlledState) setInternalState(DEFAULT_STATE);
    onReset?.();
  }, [controlledState, isSelectionControlled, onReset]);

  const skip = useCallback(() => {
    if (!controlledState) {
      setInternalState((prev) => ({ ...prev, skipped: true, canAdvance: true }));
    }
    onSkip?.();
  }, [controlledState, onSkip]);

  const advance = useCallback(() => {
    onAdvance?.();
  }, [onAdvance]);

  const submit = useCallback(async () => {
    if (state.submitting || state.submitted) return;
    setInlineError(null);
    if (
      (question.type === "shadowing" || question.type === "speech") &&
      (!recording?.recordedBlobUrl || (recording.recordedDurationSec ?? 0) <= 0)
    ) {
      setInlineError(t("coursewarePreview.errors.recordingRequired"));
      return;
    }
    if (!controlledState) {
      setInternalState((prev) => ({ ...prev, submitting: true }));
    }
    try {
      const payload: QuizSubmissionPayload = {
        question_id: question.question_id,
        question_type: question.type,
        selected_option_ids: selectedOptionIds,
        input_values: inputValues,
      };
      const result = await Promise.resolve(onSubmit?.(payload));
      if (!controlledState) {
        setInternalState((prev) => ({
          ...prev,
          submitting: false,
          submitted: true,
          earnedScore: result?.earnedScore ?? prev.earnedScore ?? 0,
          feedback: result?.feedback ?? prev.feedback ?? null,
          canAdvance: result?.canAdvance ?? prev.canAdvance ?? true,
          skipped: false,
        }));
      }
    } catch (error) {
      setInlineError(
        error instanceof Error ? error.message : t("coursewarePreview.errors.submitFailed"),
      );
      if (!controlledState) {
        setInternalState((prev) => ({ ...prev, submitting: false }));
      }
    }
  }, [
    controlledState,
    inputValues,
    onSubmit,
    question,
    recording?.recordedBlobUrl,
    recording?.recordedDurationSec,
    selectedOptionIds,
    state.submitted,
    state.submitting,
    t,
  ]);

  const contextValue = useMemo<QuizFormContextValue>(
    () => ({
      ...state,
      question,
      questionType: question.type,
      questionId: question.question_id,
      totalScore: question.score,
      optionIds,
      blankIds,
      required: question.required,
      allowResubmit: question.allow_resubmit,
      showFeedbackScore: question.show_feedback_score,
      editorReveal,
      selectedOptionIds,
      isOptionSelected,
      toggleOption,
      inputValues,
      setInputValue,
      getInputValue,
      submit,
      reset,
      skip,
      advance,
      inlineError,
      recordingFieldName: recording?.recordingFieldName ?? null,
      recordingElapsedSec: recording?.recordingElapsedSec ?? 0,
      recordedBlobUrl: recording?.recordedBlobUrl ?? null,
      recordedDurationSec: recording?.recordedDurationSec ?? 0,
      onToggleRecord,
    }),
    [
      advance,
      blankIds,
      editorReveal,
      getInputValue,
      inlineError,
      inputValues,
      isOptionSelected,
      onToggleRecord,
      optionIds,
      question,
      recording?.recordedBlobUrl,
      recording?.recordedDurationSec,
      recording?.recordingElapsedSec,
      recording?.recordingFieldName,
      reset,
      selectedOptionIds,
      setInputValue,
      skip,
      state,
      submit,
      toggleOption,
    ],
  );

  const mergedStyle: CSSProperties = {
    ...style,
    padding: padding ?? style?.padding,
    gap: gap ?? style?.gap,
  };
  const hasBoundedHeight =
    mergedStyle.height != null || mergedStyle.maxHeight != null;
  if (hasBoundedHeight) {
    mergedStyle.minHeight = mergedStyle.minHeight ?? 0;
    // The question canvas is a positioning box, not a clipping viewport: overflow should stay visible on the stage/preview
    mergedStyle.overflow = "visible";
    mergedStyle.overflowX = "visible";
    mergedStyle.overflowY = "visible";
  }

  return (
    <QuizFormProvider value={contextValue}>
      <form
        id={id}
        className={className}
        style={mergedStyle}
        data-quiz-container={question.question_id}
        data-quiz-type={question.type}
        data-quiz-submitted={state.submitted ? "true" : "false"}
        {...(editorReveal ? { "data-quiz-layout-editor": "" } : {})}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {children}
        {inlineError ? (
          <div role="alert" data-quiz-slot="inline-error">
            {inlineError}
          </div>
        ) : null}
        {!inlineError && controlledState?.feedback && !controlledState.submitted ? (
          <div role="alert" data-quiz-slot="submit-error">
            {controlledState.feedback}
          </div>
        ) : null}
      </form>
    </QuizFormProvider>
  );
};
