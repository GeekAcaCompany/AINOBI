// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from "react";

import type { TranslationKey } from "./index.ts";
import type { Effect, SlideBackgroundImageFit, Transition } from "../courseware/index.ts";

/**
 * Display kinds for quiz templates surfaced in the editor UI. Mirrors the
 * `QuizQuestionType` union. (The legacy `html_form` template was removed by
 * the May 2026 quiz-component refactor — there is no longer an "embed your
 * own HTML quiz" code path in the editor.)
 */
export type QuestionTemplateKind =
  | "single_choice"
  | "multiple_choice"
  | "fill_blank"
  | "essay"
  | "shadowing"
  | "speech";
import { SLIDE_BACKGROUND_IMAGE_FIT_VALUES } from "@ainobi/courseware-core/elements.ts";
import type { ElementNameLabels } from "@ainobi/courseware-core/element-default-names.ts";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";

export type CoursewareTranslateFn = (
  key: TranslationKey,
  variables?: Record<string, string | number>,
) => string;

const TRANSITION_KEYS: Record<Transition, TranslationKey> = {
  none: "coursewareEditor.transitions.none",
  fade: "coursewareEditor.transitions.fade",
  dissolve: "coursewareEditor.transitions.dissolve",
  push_left: "coursewareEditor.transitions.push_left",
  push_right: "coursewareEditor.transitions.push_right",
  push_up: "coursewareEditor.transitions.push_up",
  push_down: "coursewareEditor.transitions.push_down",
  wipe_left: "coursewareEditor.transitions.wipe_left",
  wipe_right: "coursewareEditor.transitions.wipe_right",
  wipe_up: "coursewareEditor.transitions.wipe_up",
  wipe_down: "coursewareEditor.transitions.wipe_down",
  zoom_in: "coursewareEditor.transitions.zoom_in",
  zoom_out: "coursewareEditor.transitions.zoom_out",
  cross_fade: "coursewareEditor.transitions.cross_fade",
};

export function buildTransitionLabels(t: CoursewareTranslateFn): Record<Transition, string> {
  return Object.fromEntries(
    (Object.keys(TRANSITION_KEYS) as Transition[]).map((key) => [key, t(TRANSITION_KEYS[key])]),
  ) as Record<Transition, string>;
}

const QUESTION_TEMPLATE_KEYS: Record<QuestionTemplateKind, TranslationKey> = {
  single_choice: "coursewareEditor.quizTypes.single_choice",
  multiple_choice: "coursewareEditor.quizTypes.multiple_choice",
  fill_blank: "coursewareEditor.quizTypes.fill_blank",
  essay: "coursewareEditor.quizTypes.essay",
  shadowing: "coursewareEditor.quizTypes.shadowing",
  speech: "coursewareEditor.quizTypes.speech",
};

const QUESTION_TEMPLATE_DESC_KEYS: Record<QuestionTemplateKind, TranslationKey> = {
  single_choice: "coursewareEditor.quizTypes.desc.single_choice",
  multiple_choice: "coursewareEditor.quizTypes.desc.multiple_choice",
  fill_blank: "coursewareEditor.quizTypes.desc.fill_blank",
  essay: "coursewareEditor.quizTypes.desc.essay",
  shadowing: "coursewareEditor.quizTypes.desc.shadowing",
  speech: "coursewareEditor.quizTypes.desc.speech",
};

export function buildQuestionTemplateLabels(
  t: CoursewareTranslateFn,
): Record<QuestionTemplateKind, string> {
  return Object.fromEntries(
    (Object.keys(QUESTION_TEMPLATE_KEYS) as QuestionTemplateKind[]).map((kind) => [
      kind,
      t(QUESTION_TEMPLATE_KEYS[kind]),
    ]),
  ) as Record<QuestionTemplateKind, string>;
}

export function buildQuestionTemplateDescriptions(
  t: CoursewareTranslateFn,
): Record<QuestionTemplateKind, string> {
  return Object.fromEntries(
    (Object.keys(QUESTION_TEMPLATE_DESC_KEYS) as QuestionTemplateKind[]).map((kind) => [
      kind,
      t(QUESTION_TEMPLATE_DESC_KEYS[kind]),
    ]),
  ) as Record<QuestionTemplateKind, string>;
}

export function buildTextFontPresets(t: CoursewareTranslateFn) {
  return [
    {
      label: t("coursewareEditor.fonts.systemChineseRecommended"),
      value: `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", Inter, sans-serif`,
    },
    {
      label: t("coursewareEditor.fonts.pingfangMac"),
      value: `"PingFang SC", "Hiragino Sans GB", sans-serif`,
    },
    {
      label: t("coursewareEditor.fonts.microsoftYaheiWindows"),
      value: `"Microsoft YaHei", "Noto Sans CJK SC", sans-serif`,
    },
    {
      label: t("coursewareEditor.fonts.sourceHanSans"),
      value: `"Source Han Sans SC", "Noto Sans CJK SC", sans-serif`,
    },
    { label: t("coursewareEditor.fonts.inter"), value: `Inter, sans-serif` },
    { label: t("coursewareEditor.fonts.arial"), value: `Arial, Helvetica, sans-serif` },
    { label: t("coursewareEditor.fonts.georgia"), value: `Georgia, serif` },
    {
      label: t("coursewareEditor.fonts.monospace"),
      value: `"SFMono-Regular", Consolas, "Liberation Mono", monospace`,
    },
  ] as const;
}

const EFFECT_KEYS: Record<Effect, TranslationKey> = {
  none: "coursewareEditor.effects.none",
  fade_in: "coursewareEditor.effects.fade_in",
  fade_out: "coursewareEditor.effects.fade_out",
  scale_in: "coursewareEditor.effects.scale_in",
  scale_out: "coursewareEditor.effects.scale_out",
  rotate_in: "coursewareEditor.effects.rotate_in",
  rotate_out: "coursewareEditor.effects.rotate_out",
  translate_in: "coursewareEditor.effects.translate_in",
  translate_out: "coursewareEditor.effects.translate_out",
};

export function buildEffectLabels(t: CoursewareTranslateFn): Record<Effect, string> {
  return Object.fromEntries(
    (Object.keys(EFFECT_KEYS) as Effect[]).map((key) => [key, t(EFFECT_KEYS[key])]),
  ) as Record<Effect, string>;
}

const SLIDE_BACKGROUND_IMAGE_FIT_KEYS: Record<SlideBackgroundImageFit, TranslationKey> = {
  cover: "coursewareEditor.slideBackgroundImageFit.cover",
  contain: "coursewareEditor.slideBackgroundImageFit.contain",
  stretch: "coursewareEditor.slideBackgroundImageFit.stretch",
  repeat: "coursewareEditor.slideBackgroundImageFit.repeat",
  repeat_x: "coursewareEditor.slideBackgroundImageFit.repeat_x",
  repeat_y: "coursewareEditor.slideBackgroundImageFit.repeat_y",
  center: "coursewareEditor.slideBackgroundImageFit.center",
};

/** Fill mode of the slide background image (property panel dropdown) */
export function buildSlideBackgroundImageFitLabels(
  t: CoursewareTranslateFn,
): Record<SlideBackgroundImageFit, string> {
  return Object.fromEntries(
    SLIDE_BACKGROUND_IMAGE_FIT_VALUES.map((fit) => [fit, t(SLIDE_BACKGROUND_IMAGE_FIT_KEYS[fit])]),
  ) as Record<SlideBackgroundImageFit, string>;
}

export function buildKeyframeEasingOptions(t: CoursewareTranslateFn) {
  return [
    { value: "linear", label: t("coursewareEditor.keyframes.linear") },
    { value: "ease-in", label: t("coursewareEditor.keyframes.easeIn") },
    { value: "ease-out", label: t("coursewareEditor.keyframes.easeOut") },
    { value: "ease-in-out", label: t("coursewareEditor.keyframes.easeInOut") },
  ] as const;
}

export function buildDefaultQuizGradeLevels(t: CoursewareTranslateFn) {
  return [
    { label: "A", min_score: 90, description: t("coursewareEditor.quizTypes.gradeExcellent") },
    { label: "B", min_score: 75, description: t("coursewareEditor.quizTypes.gradeGood") },
    { label: "C", min_score: 0, description: t("coursewareEditor.quizTypes.gradeKeepTrying") },
  ];
}

export type QuizPostSubmitLabel = "continue" | "nextQuestion";

export function buildQuizPostSubmitPrimaryLabel(
  t: CoursewareTranslateFn,
  mode: "continue" | "seek_next",
): string {
  return mode === "seek_next"
    ? t("coursewarePreview.quiz.nextQuestion")
    : t("coursewarePreview.quiz.continue");
}

/** Default names and factory function labels written into courseware JSON (shared by module-level builders and React). */
export type CoursewareEditorMetaLabels = {
  pageTitle: string;
  defaultSceneName: string;
  defaultSlideName: string;
  defaultHeadingText: string;
  defaultBodyText: string;
  defaultButtonLabel: string;
  defaultAiTeacherName: string;
  quizTitleRole: string;
  htmlMainPlaceholder: string;
  slideName: (index: number) => string;
  questionImageName: (index: number) => string;
  questionAudioName: (index: number) => string;
  elementCopyName: (sourceName: string) => string;
  htmlQuestionTitle: (typeLabel: string) => string;
  narrationElementName: (teacherName: string) => string;
  pptArtifactResolveError: (extension: string) => string;
};

/** Default member names written into scene JSON by canvas question type templates (`buildCanvasQuestionTemplate`). */
export type CanvasQuestionTemplateLabels = {
  kindLabels: Record<QuestionTemplateKind, string>;
  formatNumberLine: (order1Based: number, kind: QuestionTemplateKind) => string;
  stemRole: string;
  stemPlaceholder: string;
  defaultLabel: string;
  optionName: (letter: string) => string;
  submitButton: string;
  submitLabel: string;
  fillAnswer: string;
  fillBlankPlaceholder: string;
  answerArea: string;
  answerPlaceholder: string;
  cardDefault: string;
  questionWrapperName: (kind: QuestionTemplateKind) => string;
  questionImage: string;
  questionAudio: string;
  startRecording: string;
};

export function buildCanvasQuestionTemplateLabels(
  t: CoursewareTranslateFn,
): CanvasQuestionTemplateLabels {
  const kindLabels = buildQuestionTemplateLabels(t);
  return {
    kindLabels,
    formatNumberLine: (order, kind) =>
      t("coursewareEditor.template.numberLine", {
        order,
        kind: kindLabels[kind],
      }),
    stemRole: t("coursewareEditor.meta.quizTitleRole"),
    stemPlaceholder: t("coursewareEditor.template.stemPlaceholder"),
    defaultLabel: t("coursewareEditor.template.defaultLabel"),
    optionName: (letter) => t("coursewareEditor.template.optionName", { letter }),
    submitButton: t("coursewareEditor.template.submitButton"),
    submitLabel: t("coursewareEditor.template.submitLabel"),
    fillAnswer: t("coursewareEditor.template.fillAnswer"),
    fillBlankPlaceholder: t("coursewareEditor.template.fillBlankPlaceholder"),
    answerArea: t("coursewareEditor.template.answerArea"),
    answerPlaceholder: t("coursewareEditor.template.answerPlaceholder"),
    cardDefault: t("coursewareEditor.template.cardDefault"),
    questionWrapperName: (kind) =>
      t("coursewareEditor.template.questionWrapper", { kind: kindLabels[kind] }),
    questionImage: t("coursewareEditor.common.questionImage"),
    questionAudio: t("coursewareEditor.common.questionAudio"),
    startRecording: t("coursewareEditor.stage.startRecording"),
  };
}

export function buildCoursewareEditorMetaLabels(
  t: CoursewareTranslateFn,
): CoursewareEditorMetaLabels {
  return {
    pageTitle: t("coursewareEditor.meta.pageTitle"),
    defaultSceneName: t("coursewareEditor.meta.defaultSceneName"),
    defaultSlideName: t("coursewareEditor.meta.defaultSlideName"),
    defaultHeadingText: t("coursewareEditor.meta.defaultHeadingText"),
    defaultBodyText: t("coursewareEditor.meta.defaultBodyText"),
    defaultButtonLabel: t("coursewareEditor.meta.defaultButtonLabel"),
    defaultAiTeacherName: t("coursewareEditor.meta.defaultAiTeacherName"),
    quizTitleRole: t("coursewareEditor.meta.quizTitleRole"),
    htmlMainPlaceholder: t("coursewareEditor.meta.htmlMainPlaceholder"),
    slideName: (index) =>
      t("coursewareEditor.meta.slideNamePattern", { index: index + 1 }),
    questionImageName: (index) =>
      t("coursewareEditor.meta.questionImageName", { index: index + 1 }),
    questionAudioName: (index) =>
      t("coursewareEditor.meta.questionAudioName", { index: index + 1 }),
    elementCopyName: (sourceName) =>
      t("coursewareEditor.meta.elementCopySuffix", { name: sourceName }),
    htmlQuestionTitle: (typeLabel) =>
      t("coursewareEditor.meta.htmlQuestionTitle", { type: typeLabel }),
    narrationElementName: (teacherName) =>
      t("coursewareEditor.meta.narrationElementName", { name: teacherName }),
    pptArtifactResolveError: (extension) =>
      t("coursewareEditor.errors.pptArtifactResolve", { ext: extension }),
  };
}

/** Localized element default-name labels injected into the synced naming lib. */
export function buildElementTypeDisplayNames(t: CoursewareTranslateFn): ElementNameLabels {
  return {
    displayNames: {
      audio: t("coursewareEditor.elementTypes.audio"),
      button: t("coursewareEditor.elementTypes.button"),
      slide: t("coursewareEditor.elementTypes.slide"),
      ellipse: t("coursewareEditor.elementTypes.ellipse"),
      group: t("coursewareEditor.elementTypes.group"),
      image: t("coursewareEditor.elementTypes.image"),
      input: t("coursewareEditor.elementTypes.input"),
      line: t("coursewareEditor.elementTypes.line"),
      arrow: t("coursewareEditor.elementTypes.arrow"),
      narration: t("coursewareEditor.elementTypes.narration"),
      quiz: t("coursewareEditor.elementTypes.quiz"),
      quiz_score_summary: t("coursewareEditor.elementTypes.quizScoreSummary"),
      rectangle: t("coursewareEditor.elementTypes.rectangle"),
      rich: t("coursewareEditor.elementTypes.rich"),
      text: t("coursewareEditor.elementTypes.text"),
      textarea: t("coursewareEditor.elementTypes.textarea"),
      video: t("coursewareEditor.elementTypes.video"),
      vtuber: t("coursewareEditor.elementTypes.vtuber"),
    },
    formatName: (label, ordinal) =>
      t("coursewareEditor.elementTypes.namePattern", { label, n: ordinal }),
  };
}

/** Label tables reused inside the courseware editor (transitions, question types, preset asset names, etc.). */
export function useCoursewareEditorLabels() {
  const { t } = useI18nNew();
  return useMemo(
    () => ({
      transitions: buildTransitionLabels(t),
      elementNames: buildElementTypeDisplayNames(t),
      effectLabels: buildEffectLabels(t),
      slideBackgroundImageFitLabels: buildSlideBackgroundImageFitLabels(t),
      questionTemplateLabel: buildQuestionTemplateLabels(t),
      questionTemplateDescription: buildQuestionTemplateDescriptions(t),
      keyframeEasingOptions: buildKeyframeEasingOptions(t),
      textFontPresets: buildTextFontPresets(t),
      defaultQuizGradeLevels: buildDefaultQuizGradeLevels(t),
      leaveConfirm: t("coursewareEditor.confirm.leaveEditor"),
      meta: buildCoursewareEditorMetaLabels(t),
      shapePresets: [
        { id: "shape-blue", name: t("coursewareEditor.presets.shape.blue"), color: "#3B82F6" },
        { id: "shape-cyan", name: t("coursewareEditor.presets.shape.cyan"), color: "#06B6D4" },
        { id: "shape-emerald", name: t("coursewareEditor.presets.shape.green"), color: "#10B981" },
        { id: "shape-amber", name: t("coursewareEditor.presets.shape.gold"), color: "#F59E0B" },
        { id: "shape-rose", name: t("coursewareEditor.presets.shape.red"), color: "#F43F5E" },
        { id: "shape-violet", name: t("coursewareEditor.presets.shape.violet"), color: "#8B5CF6" },
      ],
      sampleImages: [
        {
          id: "img-mountain",
          name: t("coursewareEditor.presets.image.mountain"),
          url: "https://picsum.photos/seed/mountain/800/500",
        },
        {
          id: "img-ocean",
          name: t("coursewareEditor.presets.image.ocean"),
          url: "https://picsum.photos/seed/ocean/800/500",
        },
        {
          id: "img-forest",
          name: t("coursewareEditor.presets.image.forest"),
          url: "https://picsum.photos/seed/forest/800/500",
        },
        {
          id: "img-city",
          name: t("coursewareEditor.presets.image.city"),
          url: "https://picsum.photos/seed/city/800/500",
        },
        {
          id: "img-tech",
          name: t("coursewareEditor.presets.image.tech"),
          url: "https://picsum.photos/seed/tech/800/500",
        },
        {
          id: "img-art",
          name: t("coursewareEditor.presets.image.art"),
          url: "https://picsum.photos/seed/art/800/500",
        },
      ],
      t,
    }),
    [t],
  );
}
