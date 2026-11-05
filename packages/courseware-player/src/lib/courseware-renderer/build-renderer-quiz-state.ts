// SPDX-License-Identifier: AGPL-3.0-only
import type { QuizConfig, QuizSlideElement, Scene, SlideElement } from "../courseware/index.ts";

/** The minimal runtime shape aligned with QuizQuestionState in courseware-preview (render mode only needs the skipped flag). */
export type RendererQuizQuestionState = {
  selectedOptionIds: Set<string>;
  inputValues: Record<string, string>;
  recordingFieldName: string | null;
  recordingElapsedSec: number;
  recordedBlobUrl: string | null;
  recordedDurationSec: number;
  submitted: boolean;
  skipped?: boolean;
  isSubmitting: boolean;
  score: number | null;
  feedback: string | null;
  feedback_detail?: Record<string, unknown> | null;
  canAdvance: boolean;
};

const createSkippedQuizQuestionState = (): RendererQuizQuestionState => ({
  selectedOptionIds: new Set<string>(),
  inputValues: {},
  recordingFieldName: null,
  recordingElapsedSec: 0,
  recordedBlobUrl: null,
  recordedDurationSec: 0,
  submitted: false,
  skipped: true,
  isSubmitting: false,
  score: null,
  feedback: null,
  feedback_detail: null,
  canAdvance: true,
});

const getQuestionForRenderer = (
  quiz: QuizConfig | null | undefined,
  quizEl: QuizSlideElement,
) => {
  if (!quiz?.enabled) return null;
  return quiz.questions.find((q) => q.question_id === quizEl.quiz_question_id) ?? null;
};

/** Video rendering: skip every quiz automatically, so the playback clock doesn't stop at interaction points. */
export function buildRendererAutoSkippedQuizState(scene: Scene): Record<string, RendererQuizQuestionState> {
  const next: Record<string, RendererQuizQuestionState> = {};
  const quiz = scene.quiz;
  if (!quiz?.enabled) return next;

  const visitSlide = (slide: SlideElement): void => {
    for (const element of slide.children_elements) {
      if (element.element_type !== "quiz") continue;
      const quizEl = element as QuizSlideElement;
      if (!getQuestionForRenderer(quiz, quizEl)) continue;
      next[quizEl.element_id] = createSkippedQuizQuestionState();
    }
  };

  for (const slide of scene.slide_elements) visitSlide(slide);
  return next;
}
