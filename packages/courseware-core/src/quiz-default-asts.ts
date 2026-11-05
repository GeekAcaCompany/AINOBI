// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Default starter `react_layout` ASTs for every quiz type.
 *
 * Warm-neutral layout tuned for slide background `#f0f0ec`. Layout metrics
 * live here; interactive colors (blue submit button, option select ring, etc.)
 * are merged at runtime by Quiz* components — see `quiz-button-appearance` /
 * `quiz-option-appearance` in the student view app.
 */

import type { ContentLanguage } from "./content-language.ts";
import type { QuizAstNode, QuizAstPropValue, QuizFunctionalTag, QuizInterpKey, QuizTag } from "./quiz-ast.ts";
import { applyFillBlankTitleToQuestion, buildFillBlankQuizTitleAst } from "./quiz-fill-blank-title.ts";
import { createDefaultQuestion, type DefaultQuestionOptions, type QuizFillBlankQuestion, type QuizMultipleChoiceQuestion, type QuizQuestion, type QuizQuestionType, type QuizSingleChoiceQuestion } from "./quiz.ts";

const t = (text: string): QuizAstNode => ({ kind: "text", text });
const i = (key: QuizInterpKey): QuizAstNode => ({ kind: "interp", key });

const S = (rules: Record<string, string | number>): Record<string, string | number> => rules;

/**
 * Learner-visible copy baked into the default layouts, keyed by the courseware
 * content language (`scene.metadata.language`). zh keeps the historical CLI
 * wording; en / ja mirror the student editor's `coursewarePreview.quiz.*` and
 * `questionCard.textPlaceholder` entries so both authoring surfaces match.
 */
const QUIZ_DEFAULT_COPY: Record<
  ContentLanguage,
  {
    startRecording: string;
    stopRecording: string;
    explanation: string;
    score: string;
    submit: string;
    skip: string;
    retry: string;
    continue: string;
    essayPlaceholder: string;
  }
> = {
  zh: {
    startRecording: "开始录音",
    stopRecording: "暂停录音",
    explanation: "解析",
    score: "得分",
    submit: "提交",
    skip: "跳过",
    retry: "重新作答",
    continue: "继续",
    essayPlaceholder: "写下你的回答…",
  },
  en: {
    startRecording: "Start recording",
    stopRecording: "Stop recording",
    explanation: "Answer explanation",
    score: "Score",
    submit: "Submit",
    skip: "Skip",
    retry: "Try again",
    continue: "Continue",
    essayPlaceholder: "Please enter your answer...",
  },
  ja: {
    startRecording: "録音開始",
    stopRecording: "録音停止",
    explanation: "解答解説",
    score: "得点",
    submit: "送信",
    skip: "スキップ",
    retry: "再回答",
    continue: "続ける",
    essayPlaceholder: "回答を入力してください...",
  },
};

/**
 * Default label for an action button the agent left empty (`<QuizSubmitButton />`),
 * keyed by functional tag. Shares `QUIZ_DEFAULT_COPY` with the default layouts so the
 * JSX interp-fill repair and `buildDefaultQuizAst` bake identical wording.
 */
export const getDefaultQuizActionButtonLabels = (
  language: ContentLanguage,
): Partial<Record<QuizFunctionalTag, string>> => {
  const copy = QUIZ_DEFAULT_COPY[language];
  return {
    QuizSubmitButton: copy.submit,
    QuizSkipButton: copy.skip,
    QuizResubmitButton: copy.retry,
    QuizContinueButton: copy.continue,
  };
};

const e = (
  tag: QuizTag,
  props: Record<string, QuizAstPropValue> = {},
  children: QuizAstNode[] = [],
): QuizAstNode => ({
  kind: "element",
  tag,
  props,
  children,
});

const branch = (
  when: string,
  props: Record<string, QuizAstPropValue> = {},
  children: QuizAstNode[] = [],
): QuizAstNode => ({
  kind: "stateBranch",
  when,
  props,
  children,
});

const RECORDING_MIC_IDLE_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Crect x='9' y='3' width='6' height='11' rx='3' fill='%236b6b65'/%3E%3Cpath d='M6 11a6 6 0 0 0 12 0' stroke='%236b6b65' stroke-width='1.8' fill='none'/%3E%3Cpath d='M12 17v3M8.5 20h7' stroke='%236b6b65' stroke-width='1.8'/%3E%3C/svg%3E";

const RECORDING_MIC_ACTIVE_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Crect x='9' y='3' width='6' height='11' rx='3' fill='%23ffffff'/%3E%3Cpath d='M6 11a6 6 0 0 0 12 0' stroke='%23ffffff' stroke-width='1.8' fill='none'/%3E%3Cpath d='M12 17v3M8.5 20h7' stroke='%23ffffff' stroke-width='1.8'/%3E%3C/svg%3E";

const recordingMicImg = (src: string): QuizAstNode =>
  e("img", { src, alt: "", style: S({ width: 18, height: 18, pointerEvents: "none", flexShrink: 0 }) }, []);

const buildRecordingButtonAst = (language: ContentLanguage): QuizAstNode =>
  e(
    "QuizShadowingControl",
    {
      style: S({
        alignSelf: "flex-start",
        padding: "10px 20px",
        fontSize: 16,
        fontWeight: 500,
        lineHeight: 1.4,
        borderRadius: 8,
        border: "1px solid #d6d6d0",
        background: "#ffffff",
        color: "#4a4a46",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }),
    },
    [
      branch("idle", {}, [recordingMicImg(RECORDING_MIC_IDLE_SRC), t(QUIZ_DEFAULT_COPY[language].startRecording)]),
      branch(
        "recording",
        {
          style: S({
            background: "#e53e3e",
            border: "1px solid #c53030",
            color: "#ffffff",
          }),
        },
        [recordingMicImg(RECORDING_MIC_ACTIVE_SRC), t(QUIZ_DEFAULT_COPY[language].stopRecording)],
      ),
    ],
  );

/** Recorder button + live timer (timer visible only while recording). */
const buildRecordingBlockAst = (language: ContentLanguage, marginTop = 12): QuizAstNode =>
  e(
    "div",
    {
      style: S({
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
        marginTop,
      }),
    },
    [
      buildRecordingButtonAst(language),
      e(
        "QuizRecordingTimer",
        {
          style: S({
            fontSize: 14,
            fontWeight: 500,
            color: "#6b6b65",
            fontVariantNumeric: "tabular-nums",
          }),
        },
        [i("recording_elapsed")],
      ),
    ],
  );

const QUIZ_SHELL_STYLE = S({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  color: "#4a4a46",
  fontFamily: "system-ui, -apple-system, sans-serif",
  backgroundColor: "transparent",
});

const TITLE_STYLE = S({
  fontSize: 30,
  fontWeight: 600,
  lineHeight: 1.35,
  marginBottom: 4,
  color: "#4a4a46",
});

const OPTION_GROUP_STYLE = S({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginTop: 6,
  marginBottom: 6,
});

const OPTION_STYLE = S({
  padding: 14,
  fontSize: 17,
  lineHeight: 1.4,
  borderRadius: 10,
});

/** Submit + skip / retry / continue in one row, so a long explanation doesn't push the action buttons to the bottom of the canvas. */
const ACTION_ROW_STYLE = S({
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 16,
  alignItems: "center",
  marginTop: 10,
});

/** Same height and font size as the secondary action buttons; the submit button overrides primary's larger default padding/font. */
const ACTION_BUTTON_STYLE = S({
  alignSelf: "flex-start",
  padding: "12px 30px",
  fontSize: 16,
  fontWeight: 500,
  borderRadius: 8,
  minWidth: 0,
});

const explanationBlock = (language: ContentLanguage): QuizAstNode =>
  e("QuizExplanation", { style: S({ marginTop: 14, padding: 14, borderRadius: 10, backgroundColor: "#e8e8e2" }) }, [
    e("h4", { style: S({ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "#4a4a46" }) }, [t(QUIZ_DEFAULT_COPY[language].explanation)]),
    e("p", { style: S({ fontSize: 15, lineHeight: 1.5, color: "#5c5c56" }) }, [i("explanation")]),
  ]);

const feedbackBlock = (language: ContentLanguage): QuizAstNode =>
  e("QuizFeedback", {}, [
    e("p", { style: S({ marginBottom: 4, fontSize: 14, color: "#6b6b65" }) }, [t(QUIZ_DEFAULT_COPY[language].score)]),
    e("QuizScore", {}, []),
  ]);

const primaryActionRow = (language: ContentLanguage): QuizAstNode => {
  const copy = QUIZ_DEFAULT_COPY[language];
  return e("div", { style: ACTION_ROW_STYLE }, [
    e("QuizSubmitButton", { style: ACTION_BUTTON_STYLE }, [t(copy.submit)]),
    e("QuizSkipButton", { style: ACTION_BUTTON_STYLE }, [t(copy.skip)]),
    e("QuizResubmitButton", { style: ACTION_BUTTON_STYLE }, [t(copy.retry)]),
    e("QuizContinueButton", { style: ACTION_BUTTON_STYLE }, [t(copy.continue)]),
  ]);
};

const optionList = (options: { option_id: string; label: string }[]): QuizAstNode =>
  e(
    "QuizOptionGroup",
    { style: OPTION_GROUP_STYLE },
    options.map((opt) => e("QuizOption", { value: opt.option_id, style: OPTION_STYLE }, [t(opt.label)])),
  );

const titleBlock = (children: QuizAstNode[] = [i("title")]): QuizAstNode =>
  e("QuizTitle", { style: TITLE_STYLE }, children);

const quizShell = (children: QuizAstNode[], padding = 28, gap = 16): QuizAstNode =>
  e("QuizContainer", { padding, gap, style: QUIZ_SHELL_STYLE }, children);

export const buildDefaultQuizAst = (question: QuizQuestion, language: ContentLanguage): QuizAstNode => {
  switch (question.type) {
    case "single_choice":
    case "multiple_choice":
      return buildChoiceDefaultAst(question, language);
    case "fill_blank":
      return buildFillBlankDefaultAst(question, language);
    case "essay":
      return buildEssayDefaultAst(language);
    case "shadowing":
      return buildShadowingDefaultAst(language);
    case "speech":
      return buildSpeechDefaultAst(language);
  }
};

const choiceOptionDisplayLabel = (opt: { option_id: string; value?: string }, index: number): string => {
  const raw = (opt.value ?? "").trim();
  if (raw && raw !== opt.option_id) return raw;
  return String.fromCharCode(65 + index);
};

const buildChoiceDefaultAst = (
  question: QuizSingleChoiceQuestion | QuizMultipleChoiceQuestion,
  language: ContentLanguage,
): QuizAstNode => {
  const options = question.options.map((opt, idx) => ({
    option_id: opt.option_id,
    label: choiceOptionDisplayLabel(opt, idx),
  }));
  return quizShell([
    titleBlock(),
    optionList(options),
    primaryActionRow(language),
    explanationBlock(language),
    feedbackBlock(language),
  ]);
};

const buildFillBlankDefaultAst = (question: QuizFillBlankQuestion, language: ContentLanguage): QuizAstNode =>
  quizShell([
    buildFillBlankQuizTitleAst(question.title, question.blanks, TITLE_STYLE),
    primaryActionRow(language),
    explanationBlock(language),
    feedbackBlock(language),
  ]);

const buildEssayDefaultAst = (language: ContentLanguage): QuizAstNode =>
  quizShell([
    titleBlock(),
    e(
      "QuizTextarea",
      {
        name: "answer",
        placeholder: QUIZ_DEFAULT_COPY[language].essayPlaceholder,
        rows: 6,
        style: S({
          width: "100%",
          marginTop: 6,
          padding: 12,
          fontSize: 16,
          lineHeight: 1.5,
          borderRadius: 8,
          border: "1px solid #d6d6d0",
          backgroundColor: "#fbfbf9",
          minHeight: 140,
        }),
      },
      [],
    ),
    primaryActionRow(language),
    explanationBlock(language),
    feedbackBlock(language),
  ]);

const buildShadowingDefaultAst = (language: ContentLanguage): QuizAstNode =>
  quizShell([
    titleBlock(),
    buildRecordingBlockAst(language, 12),
    e("QuizRecordingPlayback", { style: S({ marginTop: 8 }) }, []),
    primaryActionRow(language),
    explanationBlock(language),
    feedbackBlock(language),
  ]);

const buildSpeechDefaultAst = (language: ContentLanguage): QuizAstNode =>
  quizShell([
    titleBlock(),
    // Like shadowing questions, the reference audio is only for scoring and stays out of the learner-visible layout
    buildRecordingBlockAst(language, 10),
    e("QuizRecordingPlayback", { style: S({ marginTop: 8 }) }, []),
    primaryActionRow(language),
    explanationBlock(language),
    feedbackBlock(language),
  ]);

export const QUIZ_DEFAULT_AST_BY_TYPE: Record<
  QuizQuestionType,
  (q: QuizQuestion, language: ContentLanguage) => QuizAstNode
> = {
  single_choice: buildDefaultQuizAst,
  multiple_choice: buildDefaultQuizAst,
  fill_blank: buildDefaultQuizAst,
  essay: buildDefaultQuizAst,
  shadowing: buildDefaultQuizAst,
  speech: buildDefaultQuizAst,
};

/**
 * New question with starter `react_layout` (fill_blank includes inline blanks from title).
 * `language` is the courseware content language (`scene.metadata.language`); callers must
 * resolve it from the scene first — there is no default.
 */
export const createDefaultQuestionWithAst = (
  type: QuizQuestionType,
  language: ContentLanguage,
  options: DefaultQuestionOptions = {},
): QuizQuestion => {
  let question = createDefaultQuestion(type, language, options);
  question = { ...question, react_layout: buildDefaultQuizAst(question, language) };
  if (question.type === "fill_blank") {
    question = applyFillBlankTitleToQuestion(question as QuizFillBlankQuestion);
  }
  return question;
};
