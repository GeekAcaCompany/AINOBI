// SPDX-License-Identifier: AGPL-3.0-only
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Award,
  CheckCircle2,
  CircleDot,
  Clock,
  Copy,
  FolderOpen,
  ImageIcon,
  ListChecks,
  Loader2,
  Mic,
  Music,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import aiTeacherApi from "@ainobi/courseware-player/host/ai-teacher-api";
import coursewareApi, {
  stripCoursewareAssetSignatureFromUrl,
  type CoursewareAssetItem,
} from "@ainobi/courseware-player/api/courseware";
import coursewareAssetsApi from "@ainobi/courseware-player/api/courseware_assets";
import { CoursewareAssetLibraryPicker } from "@ainobi/courseware-player/components/courseware-editor/CoursewareAssetLibraryPicker";
import type { SupportedLanguage } from "@ainobi/courseware-player/lib/i18n/index";
import {
  QUIZ_QUESTION_TYPE_VALUES,
  applyEvenSplitToQuizConfig,
  cloneQuizQuestionWithFreshIds,
  createDefaultQuestion,
  createDefaultQuestionWithAst,
  newQuizBlank,
  newQuizChoiceOption,
  newQuizGradeLevel,
  validateQuizConfig,
  type QuizAstNode,
  type QuizConfig,
  type QuizFillBlankGrading,
  type QuizMultipleChoiceQuestion,
  type QuizQuestion,
  type QuizQuestionType,
  type QuizSingleChoiceQuestion,
  type QuizFillBlankQuestion,
  type QuizEssayQuestion,
  type QuizShadowingQuestion,
  type QuizSpeechQuestion,
  type QuizGradeLevel,
  type QuizScoreAllocation,
  extractQuizOptionLabelFromAst,
  appendQuizOptionToChoiceAst,
  removeQuizOptionFromChoiceAst,
  setQuizOptionTextInChoiceAst,
  applyFillBlankTitleToQuestion,
  appendFillBlankSlotToTitle,
  countFillBlankSlotsInTitle,
  parseCommaSeparatedAliases,
  removeFillBlankSlotAtIndex,
  titleHasFillBlankUnderscores,
} from "@ainobi/courseware-player/lib/courseware/index";
import { quizValidationMessagesFor } from "../../lib/courseware/quiz-validation-i18n.ts";

/**
 * In the React-AST quiz model the user-visible question content (title, option
 * text, media, etc.) lives inside `question.react_layout`, while `question.title`
 * is still the canonical short-form text written to the AST root and used for
 * TTS narration. The helpers below derive the editor view from the AST without
 * depending on the deleted `getQuizQuestionImageUrls / …Audio… / fillBlankTitle*`
 * helpers — those used to traverse a per-question template tree that no longer
 * exists.
 */

/** Visit every AST node (depth-first) including the root. */
const walkQuizAst = (root: QuizAstNode | null | undefined, visit: (node: QuizAstNode) => void): void => {
  if (!root) return;
  visit(root);
  if (root.kind === "element") {
    for (const child of root.children) walkQuizAst(child, visit);
    return;
  }
  if (root.kind === "stateBranch") {
    for (const child of root.children) walkQuizAst(child, visit);
  }
};

const extractQuizMediaUrls = (
  question: QuizQuestion,
  mediaType: "image" | "audio",
): string[] => {
  const urls: string[] = [];
  walkQuizAst(question.react_layout, (node) => {
    if (node.kind !== "element" || node.tag !== "QuizMedia") return;
    if (node.props.type !== mediaType) return;
    const src = node.props.src;
    if (typeof src === "string" && src.trim().length > 0) urls.push(src);
  });
  return urls;
};

const buildQuizQuestionContentNarrationText = (q: QuizQuestion): string => {
  const parts: string[] = [];
  if (q.title.trim().length > 0) parts.push(q.title.trim());
  if (q.explanation.trim().length > 0) parts.push(q.explanation.trim());
  return parts.join("。");
};

const getQuizQuestionImageUrls = (q: QuizQuestion): string[] => extractQuizMediaUrls(q, "image");
const getQuizQuestionAudioUrls = (q: QuizQuestion): string[] => extractQuizMediaUrls(q, "audio");

const getQuizReferenceAudioUrl = (question: QuizQuestion): string => {
  if (question.type !== "shadowing" && question.type !== "speech") return "";
  let fromAst = "";
  walkQuizAst(question.react_layout, (node) => {
    if (fromAst) return;
    if (node.kind !== "element" || node.tag !== "QuizReferenceAudio") return;
    const src = node.props.src;
    if (typeof src === "string" && src.trim().length > 0) fromAst = src.trim();
  });
  if (fromAst) return fromAst;
  return question.reference_audio_url.trim();
};

const REFERENCE_AUDIO_INSERT_BEFORE_TAGS = new Set<string>([
  "QuizShadowingControl",
  "QuizRecordingTimer",
  "QuizRecordingPlayback",
  "QuizSubmitButton",
]);

const insertReferenceAudioNode = (children: QuizAstNode[], url: string): QuizAstNode[] => {
  const refNode: QuizAstNode = {
    kind: "element",
    tag: "QuizReferenceAudio",
    props: { src: url },
    children: [],
  };
  const anchorIndex = children.findIndex(
    (child) => child.kind === "element" && REFERENCE_AUDIO_INSERT_BEFORE_TAGS.has(child.tag),
  );
  if (anchorIndex >= 0) {
    const next = [...children];
    next.splice(anchorIndex, 0, refNode);
    return next;
  }
  return [...children, refNode];
};

const setQuizReferenceAudioUrlInAst = (
  root: QuizAstNode | null | undefined,
  nextUrl: string,
): QuizAstNode | null | undefined => {
  if (!root) return root;
  const url = nextUrl.trim();
  let updated = false;

  const patchNode = (node: QuizAstNode): QuizAstNode | null => {
    if (node.kind === "text" || node.kind === "interp") return node;
    if (node.kind === "stateBranch") {
      return {
        ...node,
        children: node.children
          .map((child) => patchNode(child))
          .filter((child): child is QuizAstNode => child !== null),
      };
    }
    if (node.tag === "QuizReferenceAudio") {
      if (!url) return null;
      updated = true;
      return {
        ...node,
        props: {
          ...node.props,
          src: url,
        },
      };
    }
    return {
      ...node,
      children: node.children
        .map((child) => patchNode(child))
        .filter((child): child is QuizAstNode => child !== null),
    };
  };

  const patchedRoot = patchNode(root);
  if (!url) return patchedRoot ?? root;
  if (updated) return patchedRoot ?? root;
  if (
    patchedRoot &&
    patchedRoot.kind === "element" &&
    patchedRoot.tag === "QuizContainer"
  ) {
    return {
      ...patchedRoot,
      children: insertReferenceAudioNode(patchedRoot.children, url),
    };
  }
  return patchedRoot ?? root;
};

const applyQuizReferenceAudioUrl = (
  question: QuizQuestion,
  url: string,
): QuizQuestion => {
  if (question.type !== "shadowing" && question.type !== "speech") return question;
  const trimmed = url.trim();
  return {
    ...question,
    reference_audio_url: trimmed,
    react_layout: setQuizReferenceAudioUrlInAst(question.react_layout, trimmed) ?? question.react_layout,
  };
};

const setQuizMediaUrlsInAst = (
  root: QuizAstNode | null | undefined,
  mediaType: "image" | "audio",
  nextUrls: string[],
): QuizAstNode | null | undefined => {
  if (!root) return root;
  const normalizedUrls = nextUrls.map((u) => u.trim()).filter(Boolean);
  let cursor = 0;

  const patchNode = (node: QuizAstNode): QuizAstNode | null => {
    if (node.kind === "text" || node.kind === "interp") return node;
    if (node.kind === "stateBranch") {
      return {
        ...node,
        children: node.children
          .map((child) => patchNode(child))
          .filter((child): child is QuizAstNode => child !== null),
      };
    }
    if (node.tag === "QuizMedia" && node.props.type === mediaType) {
      const nextUrl = normalizedUrls[cursor];
      cursor += 1;
      if (!nextUrl) return null;
      return {
        ...node,
        props: {
          ...node.props,
          src: nextUrl,
        },
      };
    }
    return {
      ...node,
      children: node.children
        .map((child) => patchNode(child))
        .filter((child): child is QuizAstNode => child !== null),
    };
  };

  const patchedRoot = patchNode(root);
  if (!patchedRoot || patchedRoot.kind !== "element" || patchedRoot.tag !== "QuizContainer") {
    return patchedRoot ?? root;
  }
  if (cursor >= normalizedUrls.length) return patchedRoot;

  const appendedMediaNodes: QuizAstNode[] = normalizedUrls.slice(cursor).map((url) => ({
    kind: "element",
    tag: "QuizMedia",
    props: {
      type: mediaType,
      src: url,
    },
    children: [],
  }));
  return {
    ...patchedRoot,
    children: [...patchedRoot.children, ...appendedMediaNodes],
  };
};

/** `optionId` matches `<QuizOption value="…">` (same as `options[].option_id`), not `options[].value`. */
const getQuizOptionText = (q: QuizQuestion, optionId: string): string =>
  extractQuizOptionLabelFromAst(q.react_layout, optionId);

import type { SlideElement } from "@ainobi/courseware-core/elements.ts";
import { generateQuizQuestionContentTts } from "../../lib/courseware/quiz-content-tts.ts";
import { findSlideIndexForQuizQuestion, listVtubersOnSlide } from "@ainobi/courseware-core/slide-stack.ts";
import type { AITeacherInfo } from "@ainobi/courseware-player/schemas/ai_teacher";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import { useCoursewareEditorLabels } from "@ainobi/courseware-player/lib/i18n/coursewareRoutesI18n";
import type { TranslationKey } from "@ainobi/courseware-player/lib/i18n/index";

const QUIZ_SETTINGS_TYPE_DESC_KEYS: Record<QuizQuestionType, TranslationKey> = {
  single_choice: "coursewareEditor.quizSettings.typeDesc.single_choice",
  multiple_choice: "coursewareEditor.quizSettings.typeDesc.multiple_choice",
  fill_blank: "coursewareEditor.quizSettings.typeDesc.fill_blank",
  essay: "coursewareEditor.quizSettings.typeDesc.essay",
  shadowing: "coursewareEditor.quizSettings.typeDesc.shadowing",
  speech: "coursewareEditor.quizSettings.typeDesc.speech",
};

const TYPE_ICON: Record<QuizQuestionType, ReactNode> = {
  single_choice: <CircleDot className="h-4 w-4" />,
  multiple_choice: <ListChecks className="h-4 w-4" />,
  fill_blank: <Pencil className="h-4 w-4" />,
  essay: <Pencil className="h-4 w-4" />,
  shadowing: <Mic className="h-4 w-4" />,
  speech: <AudioLines className="h-4 w-4" />,
};

export type QuizSettingsModalConfirmMeta = {
  /** Questions added through "add question" in this session: on save, canvas templates are inserted from the matching starting slide onward. */
  quizCanvasPlacementHints?: Array<{ questionId: string; startSlideIndex: number }>;
};

interface QuizSettingsModalProps {
  coursewareId: string;
  /**
   * ID of the organization the courseware itself belongs to (not the session's `current_org_id`, but the `orgId` of `GET /courseware`).
   * Always use this when fetching AI teacher details (the prerequisite of the question narration TTS).
   */
  coursewareOrgId: string | null;
  initialConfig: QuizConfig | null;
  coursewareLanguage?: SupportedLanguage;
  /** When set and present in `initialConfig.questions`, the modal opens on this question. */
  initialActiveQuestionId?: string | null;
  /** Index of the slide currently selected in the editor; decides where new questions land on the canvas (looking for an empty slide from that one onward). */
  selectedSlideIndex?: number;
  /** Every slide of the courseware; used to tell whether a question is already on the canvas and whether that slide has an avatar (a prerequisite of generating question narration TTS). */
  slideElements?: SlideElement[];
  onClose: () => void;
  onConfirm: (config: QuizConfig | null, meta?: QuizSettingsModalConfirmMeta) => void;
  /** The question narration preview `<audio>`, letting the editor canvas avatar align lip sync with the audio RMS (optional). */
  contentNarrationAudioRef?: RefObject<HTMLAudioElement | null>;
  /** id of the question being edited (aligning the canvas-side lip sync with the question narration preview). */
  onActiveQuestionIdChange?: (questionId: string | null) => void;
  /** Notifies the parent when the question narration preview URL (after presign) changes, aligning lip sync decoding with the `<audio>` mount. */
  onContentNarrationPreviewUrlChange?: (url: string) => void;
}

export function QuizSettingsModal({
  coursewareId,
  coursewareOrgId,
  initialConfig,
  coursewareLanguage = "en",
  initialActiveQuestionId = null,
  selectedSlideIndex = 0,
  slideElements = [],
  onClose,
  onConfirm,
  contentNarrationAudioRef,
  onActiveQuestionIdChange,
  onContentNarrationPreviewUrlChange,
}: QuizSettingsModalProps) {
  const { t, language } = useI18nNew();
  const editorLabels = useCoursewareEditorLabels();
  const [config, setConfig] = useState<QuizConfig>(() =>
    initialConfig
      ? cloneConfig(initialConfig)
      : {
          enabled: true,
          total_score: 100,
          score_allocation: "even_split",
          time_limit_minutes: null,
          questions: [],
          grade_levels: editorLabels.defaultQuizGradeLevels.map((g) => newQuizGradeLevel(g)),
          score_summary: null,
        },
  );
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(() => {
    const questions = initialConfig?.questions ?? [];
    const preferred =
      initialActiveQuestionId &&
      questions.some((q) => q.question_id === initialActiveQuestionId)
        ? initialActiveQuestionId
        : null;
    return preferred ?? questions[0]?.question_id ?? null;
  });
  const [showAddTypePicker, setShowAddTypePicker] = useState(false);
  const [quizCanvasPlacementHints, setQuizCanvasPlacementHints] = useState<
    Array<{ questionId: string; startSlideIndex: number }>
  >([]);
  const [showSubmitErrors, setShowSubmitErrors] = useState(false);
  const [showClearQuizConfirm, setShowClearQuizConfirm] = useState(false);
  const [clearQuizBubblePos, setClearQuizBubblePos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const clearQuizButtonRef = useRef<HTMLButtonElement>(null);
  const clearQuizBubbleRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => validateQuizConfig(config, quizValidationMessagesFor(language)), [config, language]);
  const scoreSum = useMemo(
    () => config.questions.reduce((acc, q) => acc + (Number.isFinite(q.score) ? q.score : 0), 0),
    [config.questions],
  );
  const scoreSumOk = scoreSum === config.total_score;

  const activeQuestion =
    config.questions.find((q) => q.question_id === activeQuestionId) ?? null;

  useEffect(() => {
    onActiveQuestionIdChange?.(activeQuestionId);
  }, [activeQuestionId, onActiveQuestionIdChange]);

  useEffect(() => {
    if (config.questions.length === 0) {
      setActiveQuestionId(null);
      return;
    }
    if (!activeQuestionId || !config.questions.find((q) => q.question_id === activeQuestionId)) {
      setActiveQuestionId(config.questions[0].question_id);
    }
  }, [config.questions, activeQuestionId]);

  const updateQuestion = useCallback(
    (id: string, updater: (prev: QuizQuestion) => QuizQuestion): void => {
      setConfig((prev) => ({
        ...prev,
        questions: prev.questions.map((q) => (q.question_id === id ? updater(q) : q)),
      }));
    },
    [],
  );

  const addQuestion = useCallback(
    (type: QuizQuestionType): void => {
      const next = createDefaultQuestionWithAst(type, coursewareLanguage);
      setConfig((prev) => {
        let merged = { ...prev, questions: [...prev.questions, next] };
        if (merged.score_allocation !== "custom") {
          merged = applyEvenSplitToQuizConfig(merged);
        }
        return merged;
      });
      setQuizCanvasPlacementHints((h) => [
        ...h,
        { questionId: next.question_id, startSlideIndex: selectedSlideIndex },
      ]);
      setActiveQuestionId(next.question_id);
      setShowAddTypePicker(false);
    },
    [coursewareLanguage, selectedSlideIndex],
  );

  const duplicateQuestion = useCallback((id: string): void => {
    setConfig((prev) => {
      const index = prev.questions.findIndex((q) => q.question_id === id);
      if (index < 0) return prev;
      const original = prev.questions[index];
      const cloned = cloneQuestionWithNewIds(original);
      const questions = [...prev.questions];
      questions.splice(index + 1, 0, cloned);
      let merged = { ...prev, questions };
      if (merged.score_allocation !== "custom") {
        merged = applyEvenSplitToQuizConfig(merged);
      }
      return merged;
    });
  }, []);

  const removeQuestion = useCallback((id: string): void => {
    setConfig((prev) => {
      const questions = prev.questions.filter((q) => q.question_id !== id);
      let merged = { ...prev, questions };
      if (merged.score_allocation !== "custom") {
        merged = applyEvenSplitToQuizConfig(merged);
      }
      return merged;
    });
  }, []);

  const moveQuestion = useCallback((id: string, delta: -1 | 1): void => {
    setConfig((prev) => {
      const index = prev.questions.findIndex((q) => q.question_id === id);
      if (index < 0) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.questions.length) return prev;
      const next = [...prev.questions];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, questions: next };
    });
  }, []);

  const handleSubmit = useCallback((): void => {
    if (issues.length > 0) {
      setShowSubmitErrors(true);
      return;
    }
    const meta: QuizSettingsModalConfirmMeta =
      quizCanvasPlacementHints.length > 0 ? { quizCanvasPlacementHints } : {};
    onConfirm(config, meta);
  }, [config, issues.length, onConfirm, quizCanvasPlacementHints]);

  const handleClearQuizClick = useCallback((): void => {
    setShowClearQuizConfirm((prev) => !prev);
  }, []);

  const confirmClearQuiz = useCallback((): void => {
    setShowClearQuizConfirm(false);
    setQuizCanvasPlacementHints([]);
    onConfirm(null);
  }, [onConfirm]);

  const cancelClearQuiz = useCallback((): void => {
    setShowClearQuizConfirm(false);
  }, []);

  const updateClearQuizBubblePosition = useCallback((): void => {
    const btn = clearQuizButtonRef.current;
    if (!btn) {
      setClearQuizBubblePos(null);
      return;
    }
    const r = btn.getBoundingClientRect();
    const width = 280;
    const margin = 12;
    const left = Math.min(Math.max(margin, r.right - width), window.innerWidth - width - margin);
    setClearQuizBubblePos({ left, top: r.bottom + 8 });
  }, []);

  useLayoutEffect(() => {
    if (!showClearQuizConfirm) {
      setClearQuizBubblePos(null);
      return;
    }
    updateClearQuizBubblePosition();
    window.addEventListener("resize", updateClearQuizBubblePosition);
    window.addEventListener("scroll", updateClearQuizBubblePosition, true);
    return () => {
      window.removeEventListener("resize", updateClearQuizBubblePosition);
      window.removeEventListener("scroll", updateClearQuizBubblePosition, true);
    };
  }, [showClearQuizConfirm, updateClearQuizBubblePosition]);

  useEffect(() => {
    if (!showClearQuizConfirm) return;
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (clearQuizButtonRef.current?.contains(t)) return;
      if (clearQuizBubbleRef.current?.contains(t)) return;
      setShowClearQuizConfirm(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showClearQuizConfirm]);

  useEffect(() => {
    if (!showClearQuizConfirm) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowClearQuizConfirm(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showClearQuizConfirm]);

  const clearQuizBubble =
    showClearQuizConfirm && clearQuizBubblePos
      ? createPortal(
          <div
            ref={clearQuizBubbleRef}
            className="fixed z-200 w-[min(280px,calc(100vw-24px))] rounded-lg border border-rose-300/40 dark:border-rose-500/35 bg-slate-100 dark:bg-slate-800 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/5"
            style={{
              left: clearQuizBubblePos.left,
              top: clearQuizBubblePos.top,
            }}
            role="dialog"
            aria-modal="false"
            aria-labelledby="clear-quiz-bubble-title"
          >
            <div
              className="pointer-events-none absolute -top-1.5 right-6 h-3 w-3 rotate-45 border-l border-t border-rose-300/40 dark:border-rose-500/35 bg-slate-100 dark:bg-slate-800"
              aria-hidden
            />
            <div className="relative flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden />
              <div className="min-w-0">
                <div id="clear-quiz-bubble-title" className="text-xs font-medium text-slate-900 dark:text-slate-100">
                  {t("coursewareEditor.quizSettings.clearConfirmTitle")}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                  {t("coursewareEditor.quizSettings.clearConfirmBody")}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-400 dark:border-slate-600 bg-white/80 dark:bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={cancelClearQuiz}
                  >
                    {t("coursewareEditor.common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="rounded bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
                    onClick={confirmClearQuiz}
                  >
                    {t("coursewareEditor.quizSettings.clearConfirmButton")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 dark:bg-slate-900/35 dark:bg-slate-950/80 p-6">
      <div className="flex h-full max-h-[92vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-blue-400" />
            <div>
              <div className="text-sm font-semibold">{t("coursewareEditor.quizSettings.title")}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500">
                {t("coursewareEditor.quizSettings.subtitle")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={onClose}
            >
              {t("coursewareEditor.common.cancel")}
            </button>
            {initialConfig ? (
              <button
                ref={clearQuizButtonRef}
                type="button"
                className={`rounded border px-2 py-1 text-xs transition ${
                  showClearQuizConfirm
                    ? "border-rose-400 bg-rose-500/15 text-rose-200"
                    : "border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                }`}
                onClick={handleClearQuizClick}
                title={t("coursewareEditor.quizSettings.clearTitle")}
                aria-expanded={showClearQuizConfirm}
                aria-haspopup="dialog"
              >
                {t("coursewareEditor.quizSettings.clearQuiz")}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-200 dark:disabled:bg-slate-700"
              onClick={handleSubmit}
            >
              {t("coursewareEditor.quizSettings.save")}
            </button>
          </div>
        </header>

        {clearQuizBubble}

        {showSubmitErrors && issues.length > 0 ? (
          <div className="border-b border-rose-500/30 bg-rose-500/10 dark:bg-rose-500/10 px-5 py-2 text-[11px] text-rose-700 dark:text-rose-200">
            <div className="mb-1 flex items-center gap-1 font-medium">
              <AlertCircle className="h-3.5 w-3.5" />{" "}
              {t("coursewareEditor.quizSettings.validationFailed", { count: issues.length })}
            </div>
            <ul className="grid list-disc grid-cols-1 gap-x-4 gap-y-0.5 pl-4 md:grid-cols-2">
              {issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px]">
          <QuestionListPanel
            questions={config.questions}
            activeQuestionId={activeQuestionId}
            onSelect={setActiveQuestionId}
            onAdd={() => setShowAddTypePicker(true)}
            onDuplicate={duplicateQuestion}
            onRemove={removeQuestion}
            onMove={moveQuestion}
            scoreSum={scoreSum}
            totalScore={config.total_score}
            scoreSumOk={scoreSumOk}
          />

          <div className="min-h-0 overflow-y-auto border-x border-slate-200 dark:border-slate-800 px-6 py-5">
            {activeQuestion ? (
              <QuestionEditor
                coursewareId={coursewareId}
                coursewareOrgId={coursewareOrgId}
                question={activeQuestion}
                scoreAllocation={config.score_allocation}
                slideElements={slideElements}
                onChange={(updater) => updateQuestion(activeQuestion.question_id, updater)}
                contentNarrationAudioRef={contentNarrationAudioRef}
                onContentNarrationPreviewUrlChange={onContentNarrationPreviewUrlChange}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                {t("coursewareEditor.quizSettings.pickQuestionHint")}
              </div>
            )}
          </div>

          <QuizGlobalPanel
            config={config}
            scoreSum={scoreSum}
            scoreSumOk={scoreSumOk}
            onChangeTotalScore={(total_score) =>
              setConfig((prev) => {
                let next = { ...prev, total_score };
                if (next.score_allocation !== "custom") {
                  next = applyEvenSplitToQuizConfig(next);
                }
                return next;
              })
            }
            onChangeScoreAllocation={(score_allocation: QuizScoreAllocation) =>
              setConfig((prev) => {
                let next = { ...prev, score_allocation };
                if (score_allocation === "even_split") {
                  next = applyEvenSplitToQuizConfig(next);
                }
                return next;
              })
            }
            onChangeTimeLimit={(time_limit_minutes) =>
              setConfig((prev) => ({ ...prev, time_limit_minutes }))
            }
            onChangeGradeLevels={(grade_levels) =>
              setConfig((prev) => ({ ...prev, grade_levels }))
            }
          />
        </div>
      </div>

      {showAddTypePicker ? (
        <AddQuestionTypePicker
          onClose={() => setShowAddTypePicker(false)}
          onPick={(type) => addQuestion(type)}
        />
      ) : null}
    </div>
  );
}

const cloneConfig = (config: QuizConfig): QuizConfig => ({
  ...config,
  score_allocation: config.score_allocation ?? "even_split",
  questions: config.questions.map((q) => ({ ...q })),
  grade_levels: config.grade_levels.map((g) => ({ ...g })),
});

const cloneQuestionWithNewIds = (q: QuizQuestion): QuizQuestion => {
  const merged = cloneQuizQuestionWithFreshIds(q);
  if (merged.type === "fill_blank") return merged;
  return {
    ...merged,
    content_narration_audio_url: "",
    content_narration_duration_ms: 0,
    content_narration_vtuber_element_id: "",
  };
};

interface QuestionListPanelProps {
  questions: QuizQuestion[];
  activeQuestionId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  scoreSum: number;
  totalScore: number;
  scoreSumOk: boolean;
}

function QuestionListPanel({
  questions,
  activeQuestionId,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onMove,
  scoreSum,
  totalScore,
  scoreSumOk,
}: QuestionListPanelProps) {
  const { t } = useI18nNew();
  const { questionTemplateLabel: typeLabels } = useCoursewareEditorLabels();
  return (
    <aside className="flex min-h-0 flex-col bg-white/60 dark:bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {t("coursewareEditor.quizSettings.questionsList", { count: questions.length })}
        </span>
        <button
          type="button"
          className="flex items-center gap-1 rounded bg-blue-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
          onClick={onAdd}
        >
          <Plus className="h-3 w-3" /> {t("coursewareEditor.quizSettings.addQuestion")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {questions.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 dark:border-slate-700 px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            {t("coursewareEditor.quizSettings.emptyQuestions")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {questions.map((q, index) => {
              const isActive = q.question_id === activeQuestionId;
              return (
                <li key={q.question_id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(q.question_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(q.question_id);
                      }
                    }}
                    className={`group flex w-full cursor-pointer flex-col gap-1 rounded border px-2 py-1.5 text-left text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                      isActive
                        ? "border-blue-500/60 bg-blue-500/10"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-1.5 text-slate-800 dark:text-slate-200">
                        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded bg-slate-100 dark:bg-slate-800 px-1 text-[10px] text-slate-600 dark:text-slate-300">
                          {index + 1}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500">{TYPE_ICON[q.type]}</span>
                        <span className="truncate">
                          {q.title.trim() ||
                            t("coursewareEditor.quizSettings.untitledQuestion", {
                              type: typeLabels[q.type],
                            })}
                        </span>
                      </div>
                      <span className="ml-1 shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1.5 text-[10px] text-slate-600 dark:text-slate-300">
                        {t("coursewareEditor.quizSettings.scorePoints", { score: q.score })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
                      <span>
                        {typeLabels[q.type]}
                        {q.required
                          ? t("coursewareEditor.quizSettings.required")
                          : t("coursewareEditor.quizSettings.skippable")}
                      </span>
                      <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <IconAction
                          label={t("coursewareEditor.quizSettings.moveUp")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMove(q.question_id, -1);
                          }}
                          disabled={index === 0}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </IconAction>
                        <IconAction
                          label={t("coursewareEditor.quizSettings.moveDown")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMove(q.question_id, 1);
                          }}
                          disabled={index === questions.length - 1}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </IconAction>
                        <IconAction
                          label={t("coursewareEditor.common.copy")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDuplicate(q.question_id);
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </IconAction>
                        <IconAction
                          label={t("coursewareEditor.common.delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemove(q.question_id);
                          }}
                          danger
                        >
                          <Trash2 className="h-3 w-3" />
                        </IconAction>
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 dark:text-slate-500">
            {t("coursewareEditor.quizSettings.scoreSumLabel")}
          </span>
          <span className={scoreSumOk ? "text-emerald-300" : "text-rose-300"}>
            {scoreSum} / {totalScore}
          </span>
        </div>
        {!scoreSumOk ? (
          <div className="mt-0.5 text-[10px] text-rose-700 dark:text-rose-300">
            {t("coursewareEditor.quizSettings.scoreSumMismatch", {
              diff: totalScore - scoreSum,
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function IconAction({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-5 w-5 items-center justify-center rounded transition ${
        disabled
          ? "cursor-not-allowed text-slate-700"
          : danger
            ? "text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
            : "text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

interface AddQuestionTypePickerProps {
  onClose: () => void;
  onPick: (type: QuizQuestionType) => void;
}

function AddQuestionTypePicker({ onClose, onPick }: AddQuestionTypePickerProps) {
  const { t } = useI18nNew();
  const { questionTemplateLabel: typeLabels } = useCoursewareEditorLabels();
  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/28 dark:bg-slate-950/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("coursewareEditor.quizSettings.pickTypeTitle")}
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={t("coursewareEditor.common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {QUIZ_QUESTION_TYPE_VALUES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onPick(type)}
              className="flex flex-col gap-1 rounded border border-slate-300 dark:border-slate-700 px-3 py-2 text-left transition hover:border-blue-400/50 dark:hover:border-blue-500/60 hover:bg-blue-500/10 dark:hover:bg-blue-500/10"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                <span className="text-blue-700 dark:text-blue-300">{TYPE_ICON[type]}</span>
                {typeLabels[type]}
              </div>
              <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                {t(QUIZ_SETTINGS_TYPE_DESC_KEYS[type])}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface QuestionEditorProps {
  coursewareId: string;
  /** Organization ID of the courseware itself. Always use this when fetching AI teacher details. */
  coursewareOrgId: string | null;
  question: QuizQuestion;
  scoreAllocation: QuizScoreAllocation;
  slideElements: SlideElement[];
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
  contentNarrationAudioRef?: RefObject<HTMLAudioElement | null>;
  onContentNarrationPreviewUrlChange?: (url: string) => void;
}

function QuizQuestionContentNarrationSection({
  coursewareId,
  coursewareOrgId,
  question,
  slideElements,
  onChange,
  audioRef,
  onPreviewUrlChange,
}: {
  coursewareId: string;
  coursewareOrgId: string | null;
  question: QuizQuestion;
  slideElements: SlideElement[];
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
  audioRef?: RefObject<HTMLAudioElement | null>;
  onPreviewUrlChange?: (url: string) => void;
}) {
  const { t } = useI18nNew();
  const slideIndex = useMemo(
    () => findSlideIndexForQuizQuestion(slideElements, question.question_id),
    [slideElements, question.question_id],
  );
  const slide = slideIndex != null ? slideElements[slideIndex] ?? null : null;
  const vtubers = slide ? listVtubersOnSlide(slide) : [];
  const primaryVtuber = vtubers[0];
  const aiTeacherId =
    primaryVtuber && typeof primaryVtuber.metadata?.ai_teacher_id === "string"
      ? (primaryVtuber.metadata.ai_teacher_id as string)
      : null;

  const [aiTeacher, setAiTeacher] = useState<AITeacherInfo | null>(null);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const [loadingTeacher, setLoadingTeacher] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    if (!aiTeacherId) {
      setAiTeacher(null);
      setTeacherError(
        primaryVtuber ? t("coursewareEditor.quizSettings.errors.vtuberNoTeacher") : null,
      );
      return () => {
        cancelled = true;
      };
    }
    if (!coursewareOrgId?.trim()) {
      return () => {
        cancelled = true;
      };
    }
    setLoadingTeacher(true);
    setTeacherError(null);
    // Fetch teacher details with the courseware's own organization (it may differ from the session organization).
    aiTeacherApi
      .getAITeacher(aiTeacherId, undefined, coursewareOrgId)
      .then((info) => {
        if (!cancelled) setAiTeacher(info);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTeacherError(
            err instanceof Error ? err.message : t("coursewareEditor.quizSettings.errors.loadTeacherFailed"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTeacher(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aiTeacherId, primaryVtuber, coursewareOrgId]);

  const narrationUrl = question.content_narration_audio_url.trim();
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (!narrationUrl) {
        setPreviewUrl("");
        onPreviewUrlChange?.("");
        return;
      }
      try {
        const signed = await coursewareAssetsApi.batchPresignUrls(coursewareId, [narrationUrl]);
        const next = !cancelled ? signed[narrationUrl] ?? narrationUrl : "";
        if (!cancelled) {
          setPreviewUrl(next);
          onPreviewUrlChange?.(next);
        }
      } catch {
        if (!cancelled) {
          setPreviewUrl(narrationUrl);
          onPreviewUrlChange?.(narrationUrl);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [coursewareId, narrationUrl, onPreviewUrlChange]);

  const ttsText = useMemo(() => buildQuizQuestionContentNarrationText(question), [question]);

  const canGenerate =
    slideIndex != null &&
    vtubers.length > 0 &&
    !!aiTeacher &&
    !!aiTeacher.ai_teacher_tts_id &&
    ttsText.trim().length > 0 &&
    !generating &&
    !loadingTeacher;

  const gateMessage = (() => {
    if (slideIndex == null) return t("coursewareEditor.quizSettings.errors.insertCanvasFirst");
    if (vtubers.length === 0) return t("coursewareEditor.quizSettings.errors.needVtuberOnSlide");
    if (teacherError) return teacherError;
    if (aiTeacher && !aiTeacher.ai_teacher_tts_id)
      return t("coursewareEditor.quizSettings.errors.noTts");
    if (!ttsText.trim()) return t("coursewareEditor.quizSettings.errors.emptyContent");
    return null;
  })();

  const handleGenerate = async (): Promise<void> => {
    if (!canGenerate || !aiTeacher || !primaryVtuber || !aiTeacher.ai_teacher_tts_id) return;
    setGenerating(true);
    setGenError(null);
    try {
      const out = await generateQuizQuestionContentTts({
        coursewareId,
        text: ttsText,
        ttsId: aiTeacher.ai_teacher_tts_id,
        teacherId: aiTeacher.ai_teacher_id,
        speechRate: aiTeacher.ai_teacher_tts_speed ?? 1,
      });
      const unsigned = stripCoursewareAssetSignatureFromUrl(out.audio_url);
      onChange((prev) => ({
        ...prev,
        content_narration_audio_url: unsigned,
        content_narration_duration_ms: out.duration_ms,
        content_narration_vtuber_element_id: primaryVtuber.element_id,
      }));
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : t("coursewareEditor.quizSettings.errors.genFailed"),
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/85 dark:bg-slate-950/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {t("coursewareEditor.quizSettings.narration.title")}
        </div>
        {loadingTeacher ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 dark:text-slate-500" /> : null}
      </div>
      {gateMessage ? (
        <p className="text-[11px] leading-snug text-amber-200/90">{gateMessage}</p>
      ) : null}
      {genError ? (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{genError}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => void handleGenerate()}
          className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs ${
            canGenerate
              ? "bg-blue-500/25 text-blue-200 hover:bg-blue-500/35"
              : "cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-500"
          }`}
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AudioLines className="h-3.5 w-3.5" />}
          {t("coursewareEditor.quizSettings.narration.generate")}
        </button>
        {narrationUrl ? (
          <>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.quizSettings.narration.durationSec", {
                seconds: (question.content_narration_duration_ms / 1000).toFixed(1),
              })}
            </span>
            <button
              type="button"
              onClick={() =>
                onChange((prev) => ({
                  ...prev,
                  content_narration_audio_url: "",
                  content_narration_duration_ms: 0,
                  content_narration_vtuber_element_id: "",
                }))
              }
              className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-400 dark:text-slate-500 hover:border-rose-500/50 hover:text-rose-700 dark:hover:text-rose-300"
            >
              {t("coursewareEditor.quizSettings.narration.clear")}
            </button>
          </>
        ) : null}
      </div>
      {previewUrl ? (
        <audio
          ref={audioRef}
          src={previewUrl}
          crossOrigin="anonymous"
          controls
          className="h-9 w-full max-w-md"
          preload="metadata"
        />
      ) : null}
    </section>
  );
}

function QuestionEditor({
  coursewareId,
  coursewareOrgId,
  question,
  onChange,
  scoreAllocation,
  slideElements,
  contentNarrationAudioRef,
  onContentNarrationPreviewUrlChange,
}: QuestionEditorProps) {
  const { t } = useI18nNew();
  const { questionTemplateLabel: typeLabels } = useCoursewareEditorLabels();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-slate-800 dark:text-slate-200">
          {typeLabels[question.type]}
        </span>
        <span className="text-[11px]">{t(QUIZ_SETTINGS_TYPE_DESC_KEYS[question.type])}</span>
      </div>

      <Field label={t("coursewareEditor.quizSettings.field.questionContent")} required>
        <textarea
          value={question.title}
          rows={3}
          onChange={(e) => {
            const v = e.target.value;
            onChange((prev) => {
              if (prev.type === "speech") {
                return { ...prev, title: v, reference_text: v };
              }
              if (prev.type === "fill_blank") {
                return applyFillBlankTitleToQuestion({ ...prev, title: v });
              }
              return { ...prev, title: v };
            });
          }}
          placeholder={
            question.type === "fill_blank"
              ? t("coursewareEditor.quizSettings.field.questionContentPlaceholderFillBlank")
              : t("coursewareEditor.quizSettings.field.questionContentPlaceholder")
          }
          className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <MediaUploadListField
          coursewareId={coursewareId}
          label={t("coursewareEditor.quizSettings.field.questionImages")}
          values={getQuizQuestionImageUrls(question)}
          accept="image/*"
          libraryKind="image"
          onChange={(image_urls) =>
            onChange((prev) => ({
              ...prev,
              react_layout: setQuizMediaUrlsInAst(prev.react_layout, "image", image_urls) ?? prev.react_layout,
            }))
          }
          placeholderIcon={<ImageIcon className="h-4 w-4" />}
        />
        <MediaUploadListField
          coursewareId={coursewareId}
          label={t("coursewareEditor.quizSettings.field.questionAudios")}
          values={getQuizQuestionAudioUrls(question)}
          accept="audio/*"
          libraryKind="audio"
          onChange={(audio_urls) =>
            onChange((prev) => ({
              ...prev,
              react_layout: setQuizMediaUrlsInAst(prev.react_layout, "audio", audio_urls) ?? prev.react_layout,
            }))
          }
          placeholderIcon={<Music className="h-4 w-4" />}
        />
      </div>

      {question.type === "single_choice" ? (
        <SingleChoiceFields question={question} onChange={onChange} />
      ) : null}
      {question.type === "multiple_choice" ? (
        <MultipleChoiceFields question={question} onChange={onChange} />
      ) : null}
      {question.type === "fill_blank" ? (
        <FillBlankFields question={question} onChange={onChange} />
      ) : null}
      {question.type === "essay" ? (
        <EssayFields question={question} onChange={onChange} />
      ) : null}
      {question.type === "shadowing" ? (
        <ShadowingFields coursewareId={coursewareId} question={question} onChange={onChange} />
      ) : null}
      {question.type === "speech" ? (
        <SpeechFields coursewareId={coursewareId} question={question} onChange={onChange} />
      ) : null}

      <QuizQuestionContentNarrationSection
        coursewareId={coursewareId}
        coursewareOrgId={coursewareOrgId}
        question={question}
        slideElements={slideElements}
        onChange={onChange}
        audioRef={contentNarrationAudioRef}
        onPreviewUrlChange={onContentNarrationPreviewUrlChange}
      />

      <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-100/85 dark:bg-slate-950/50 p-3">
        <NumberField
          label={t("coursewareEditor.quizSettings.field.questionScore")}
          value={question.score}
          min={0}
          onChange={(score) => onChange((prev) => ({ ...prev, score }))}
          hint={
            scoreAllocation === "even_split"
              ? t("coursewareEditor.quizSettings.field.scoreEvenSplitHint")
              : t("coursewareEditor.quizSettings.field.scoreCustomHint")
          }
          disabled={scoreAllocation === "even_split"}
        />
        <NumberField
          label={t("coursewareEditor.quizSettings.field.passThreshold")}
          value={question.pass_score}
          min={0}
          max={question.score}
          onChange={(pass_score) => onChange((prev) => ({ ...prev, pass_score }))}
          hint={t("coursewareEditor.quizSettings.field.passThresholdHint")}
        />
        <NumberField
          label={t("coursewareEditor.quizSettings.field.gateThreshold")}
          value={question.advance_score}
          min={0}
          max={question.score}
          onChange={(advance_score) => onChange((prev) => ({ ...prev, advance_score }))}
          hint={t("coursewareEditor.quizSettings.field.gateThresholdHint")}
        />
        <NullableMinuteSecondField
          label={
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {t("coursewareEditor.quizSettings.field.timeLimitPerQuestion")}
            </span>
          }
          value={question.time_limit_minutes}
          onChange={(time_limit_minutes) =>
            onChange((prev) => ({ ...prev, time_limit_minutes }))
          }
        />
        <BooleanField
          label={t("coursewareEditor.quizSettings.field.required")}
          checked={question.required}
          onChange={(required) => onChange((prev) => ({ ...prev, required }))}
          description={
            question.required
              ? t("coursewareEditor.quizSettings.field.requiredYes")
              : t("coursewareEditor.quizSettings.field.requiredNo")
          }
        />
        <BooleanField
          label={t("coursewareEditor.quizSettings.field.allowRetry")}
          checked={question.allow_resubmit}
          onChange={(allow_resubmit) => onChange((prev) => ({ ...prev, allow_resubmit }))}
          description={t("coursewareEditor.quizSettings.field.allowRetryDesc")}
        />
        <BooleanField
          label={t("coursewareEditor.quizSettings.field.showScore")}
          checked={question.show_feedback_score}
          onChange={(show_feedback_score) => onChange((prev) => ({ ...prev, show_feedback_score }))}
          description={t("coursewareEditor.quizSettings.field.showScoreOff")}
        />
      </div>

      <Field label={t("coursewareEditor.quizSettings.field.explanation")}>
        <textarea
          value={question.explanation}
          rows={3}
          onChange={(e) =>
            onChange((prev) => ({ ...prev, explanation: e.target.value }))
          }
          placeholder={t("coursewareEditor.quizSettings.field.explanationPlaceholder")}
          className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
      <span className="font-medium">
        {label}
        {required ? <span className="ml-1 text-rose-700 dark:text-rose-300">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</span> : null}
    </div>
  );
}

interface NumberFieldProps {
  label: ReactNode;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  hint?: string;
  disabled?: boolean;
}

function NumberField({ label, value, min, max, onChange, hint, disabled }: NumberFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isFinite(parsed)) return;
          let next = parsed;
          if (typeof min === "number" && next < min) next = min;
          if (typeof max === "number" && next > max) next = max;
          onChange(next);
        }}
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </Field>
  );
}

interface NullableNumberFieldProps {
  label: ReactNode;
  value: number | null;
  min?: number;
  onChange: (value: number | null) => void;
  placeholder?: string;
}

function NullableNumberField({
  label,
  value,
  min,
  onChange,
  placeholder,
}: NullableNumberFieldProps) {
  const { t } = useI18nNew();
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value ?? ""}
          min={min}
          placeholder={placeholder ?? t("coursewareEditor.quizSettings.field.unlimited")}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null);
              return;
            }
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) return;
            let next = parsed;
            if (typeof min === "number" && next < min) next = min;
            onChange(next);
          }}
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
        {value !== null ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("coursewareEditor.quizSettings.field.unlimited")}
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function splitTimeLimitMinutes(value: number | null): { minutes: string; seconds: string } {
  if (value == null) {
    return { minutes: "", seconds: "" };
  }
  const totalSeconds = Math.max(0, Math.floor(value * 60));
  return {
    minutes: String(Math.floor(totalSeconds / 60)),
    seconds: String(totalSeconds % 60),
  };
}

function combineTimeLimitMinutes(minutesRaw: string, secondsRaw: string): number | null {
  const readPart = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.floor(parsed);
  };

  const minutes = readPart(minutesRaw);
  const seconds = readPart(secondsRaw);
  if (minutes == null && (seconds == null || seconds == 0)) {
    return null;
  }
  const normalizedSeconds = Math.min(59, seconds ?? 0);
  return ((minutes ?? 0) * 60 + normalizedSeconds) / 60;
}

function NullableMinuteSecondField({
  label,
  value,
  onChange,
}: {
  label: ReactNode;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { t } = useI18nNew();
  const parts = splitTimeLimitMinutes(value);

  return (
    <Field label={label}>
      <div className="flex items-end gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{t("coursewareEditor.quizSettings.field.timeLimitMinutesPart")}</span>
            <input
              type="number"
              min={0}
              value={parts.minutes}
              placeholder="0"
              onChange={(e) => onChange(combineTimeLimitMinutes(e.target.value, parts.seconds))}
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{t("coursewareEditor.quizSettings.field.timeLimitSecondsPart")}</span>
            <input
              type="number"
              min={0}
              max={59}
              value={parts.seconds}
              placeholder="0"
              onChange={(e) => onChange(combineTimeLimitMinutes(parts.minutes, e.target.value))}
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            />
          </label>
        </div>
        {value !== null ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("coursewareEditor.quizSettings.field.unlimited")}
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function BooleanField({
  label,
  checked,
  onChange,
  description,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
  disabled?: boolean;
}) {
  const { t } = useI18nNew();
  return (
    <Field label={label} hint={description}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
        className={`flex h-9 items-center gap-2 rounded border px-2 text-xs transition ${
          disabled
            ? "cursor-not-allowed opacity-50"
            : checked
              ? "border-blue-500/60 bg-blue-500/10 text-blue-200"
              : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-500"
        }`}
      >
        <span
          className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition ${
            checked ? "bg-blue-500" : "bg-slate-700"
          }`}
        >
          <span
            className={`h-3 w-3 rounded-full bg-white transition ${
              checked ? "translate-x-3" : "translate-x-0"
            }`}
          />
        </span>
        {checked ? t("coursewareEditor.common.yes") : t("coursewareEditor.common.no")}
      </button>
    </Field>
  );
}

interface MediaUploadListFieldProps {
  coursewareId: string;
  label: string;
  values: string[];
  accept: string;
  onChange: (urls: string[]) => void;
  placeholderIcon: ReactNode;
  hint?: string;
  /** When set, show “{t("coursewareEditor.quizSettings.media.pickFromLibrary")}”; picked URLs are stored unsigned (like uploads). */
  libraryKind?: "image" | "audio";
}

function MediaUploadListField({
  coursewareId,
  label,
  values,
  accept,
  onChange,
  placeholderIcon,
  hint,
  libraryKind,
}: MediaUploadListFieldProps) {
  const { t, language } = useI18nNew();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [previewByOriginalUrl, setPreviewByOriginalUrl] = useState<Record<string, string>>({});
  const valuesKey = values.join("\0");

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const raw = values.map((v) => v.trim()).filter(Boolean);
      if (raw.length === 0) {
        if (!cancelled) setPreviewByOriginalUrl({});
        return;
      }
      try {
        const signed = await coursewareAssetsApi.batchPresignUrls(coursewareId, raw);
        if (!cancelled) setPreviewByOriginalUrl(signed);
      } catch {
        if (!cancelled) setPreviewByOriginalUrl({});
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [coursewareId, valuesKey]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setIsUploading(true);
    setError(null);
    try {
      const assets = await Promise.all(
        files.map((file) => coursewareAssetsApi.uploadAsset(coursewareId, file, { language })),
      );
      const unsigned = assets.map(({ asset }) => stripCoursewareAssetSignatureFromUrl(asset.url));
      const next = [...values, ...unsigned].filter((url, index, all) => url.trim() && all.indexOf(url) === index);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("coursewareEditor.quizSettings.media.uploadFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  const appendFromLibrary = (asset: CoursewareAssetItem): void => {
    const unsigned = stripCoursewareAssetSignatureFromUrl(asset.url);
    const next = [...values, unsigned].filter((url, index, all) => url.trim() && all.indexOf(url) === index);
    onChange(next);
    setShowLibrary(false);
  };

  const isImage = accept.includes("image");
  const isAudio = accept.includes("audio");

  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-col gap-2">
        {values.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {values.map((value, index) => (
              <div
                key={`${value}-${index}`}
                className="flex min-w-0 items-center gap-2 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5"
              >
                {isImage ? (
                  <img
                    src={previewByOriginalUrl[value] ?? value}
                    alt={`${label} ${index + 1}`}
                    className="h-12 w-12 rounded object-cover"
                  />
                ) : null}
                {isAudio ? (
                  <audio
                    src={previewByOriginalUrl[value] ?? value}
                    controls
                    className="h-9 max-w-full flex-1"
                  />
                ) : null}
                {isImage ? (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400 dark:text-slate-500">
                    {t("coursewareEditor.quizSettings.media.imageN", { index: index + 1 })}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(values.filter((_, i) => i !== index))}
                  className="ml-auto rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-700 dark:hover:text-rose-300"
                  aria-label={t("coursewareEditor.quizSettings.media.remove", { label, index: index + 1 })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex flex-1 items-center justify-center gap-2 rounded border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-3 text-xs text-slate-400 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white dark:hover:bg-slate-900 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <Upload className="h-4 w-4 animate-pulse" /> {t("coursewareEditor.background.uploading")}
              </>
            ) : (
              <>
                {placeholderIcon}
                {values.length > 0 ? t("coursewareEditor.quizSettings.media.continueUpload", { label }) : t("coursewareEditor.quizSettings.media.upload", { label })}
              </>
            )}
          </button>
          {libraryKind ? (
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              className="flex items-center justify-center gap-2 rounded border border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-950 px-2 py-2 text-xs text-slate-600 dark:text-slate-300 hover:border-blue-400/45 dark:hover:border-blue-500/50 hover:bg-white dark:hover:bg-slate-900"
            >
              <FolderOpen className="h-3.5 w-3.5 text-blue-400" />
              {t("coursewareEditor.quizSettings.media.pickFromLibrary")}
            </button>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={handleFile}
        />
      </div>
      {error ? <span className="text-[10px] text-rose-700 dark:text-rose-300">{error}</span> : null}
      {showLibrary && libraryKind ? (
        <CoursewareAssetLibraryPicker
          coursewareId={coursewareId}
          kind={libraryKind}
          onClose={() => setShowLibrary(false)}
          onPick={appendFromLibrary}
        />
      ) : null}
    </Field>
  );
}

function MediaUploadField({
  coursewareId,
  label,
  value,
  accept,
  onChange,
  placeholderIcon,
  libraryKind,
  hint,
}: {
  coursewareId: string;
  label: string;
  value: string;
  accept: string;
  onChange: (url: string) => void;
  placeholderIcon: ReactNode;
  libraryKind?: "image" | "audio";
  hint?: string;
}) {
  return (
    <MediaUploadListField
      coursewareId={coursewareId}
      label={label}
      hint={hint}
      values={value ? [value] : []}
      accept={accept}
      libraryKind={libraryKind}
      onChange={(urls) => onChange(urls[0] ?? "")}
      placeholderIcon={placeholderIcon}
    />
  );
}

interface SingleChoiceFieldsProps {
  question: QuizSingleChoiceQuestion;
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
}

function SingleChoiceFields({ question, onChange }: SingleChoiceFieldsProps) {
  return (
    <ChoiceOptionsEditor
      mode="single"
      question={question}
      onQuestionChange={(next) =>
        onChange((prev) => (prev.type === "single_choice" ? next : prev))
      }
    />
  );
}

interface MultipleChoiceFieldsProps {
  question: QuizMultipleChoiceQuestion;
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
}

function MultipleChoiceFields({ question, onChange }: MultipleChoiceFieldsProps) {
  const { t } = useI18nNew();
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("coursewareEditor.quizSettings.multiChoice.rule")}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              onChange((prev) => {
                if (prev.type !== "multiple_choice") return prev;
                return { ...prev, grading: "all_or_nothing" };
              })
            }
            className={`rounded border px-2 py-2 text-left text-xs transition ${
              question.grading === "all_or_nothing"
                ? "border-blue-500/60 bg-blue-500/10"
                : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-500"
            }`}
          >
            <div className="font-medium">{t("coursewareEditor.quizSettings.multiChoice.allCorrect")}</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.quizSettings.multiChoice.allCorrectDesc")}
            </div>
          </button>
          <button
            type="button"
            onClick={() =>
              onChange((prev) => {
                if (prev.type !== "multiple_choice") return prev;
                return { ...prev, grading: "partial_credit" };
              })
            }
            className={`rounded border px-2 py-2 text-left text-xs transition ${
              question.grading === "partial_credit"
                ? "border-blue-500/60 bg-blue-500/10"
                : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-500"
            }`}
          >
            <div className="font-medium">{t("coursewareEditor.quizSettings.multiChoice.partial")}</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.quizSettings.multiChoice.partialDesc")}
            </div>
          </button>
        </div>
      </Field>
      <ChoiceOptionsEditor
        mode="multiple"
        question={question}
        onQuestionChange={(next) =>
          onChange((prev) => (prev.type === "multiple_choice" ? next : prev))
        }
      />
    </div>
  );
}

interface ChoiceOptionsEditorProps<Q extends QuizSingleChoiceQuestion | QuizMultipleChoiceQuestion> {
  mode: "single" | "multiple";
  question: Q;
  onQuestionChange: (next: Q) => void;
}

/**
 * Edits both the scoring metadata (`options[]` with `is_correct`) and the
 * user-visible option text in `<QuizOption value="…">` nodes inside `react_layout`.
 */
function ChoiceOptionsEditor<Q extends QuizSingleChoiceQuestion | QuizMultipleChoiceQuestion>({
  mode,
  question,
  onQuestionChange,
}: ChoiceOptionsEditorProps<Q>) {
  const { t } = useI18nNew();
  const options = question.options;
  const correctCount = options.filter((opt) => opt.is_correct).length;

  const updateOptions = (nextOptions: Q["options"], nextLayout = question.react_layout): void => {
    onQuestionChange({ ...question, options: nextOptions, react_layout: nextLayout } as Q);
  };

  const updateOptionText = (optionValue: string, nextText: string): void => {
    onQuestionChange({
      ...question,
      react_layout: setQuizOptionTextInChoiceAst(question.react_layout, optionValue, nextText)!,
    } as Q);
  };

  const addOption = (): void => {
    const newOption = newQuizChoiceOption();
    updateOptions(
      [...options, newOption],
      appendQuizOptionToChoiceAst(question.react_layout, newOption.option_id, "")!,
    );
  };

  const removeOption = (optionId: string): void => {
    updateOptions(
      options.filter((opt) => opt.option_id !== optionId),
      removeQuizOptionFromChoiceAst(question.react_layout, optionId)!,
    );
  };

  return (
    <Field
      label={
        <span className="flex items-center justify-between">
          <span>{t("coursewareEditor.quizSettings.options.config")}</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {mode === "single" ? t("coursewareEditor.quizSettings.options.singleHint") : t("coursewareEditor.quizSettings.options.multiHint")} · {t("coursewareEditor.quizSettings.options.correctCount", { count: correctCount })}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        {options.map((option, index) => (
          <div
            key={option.option_id}
            className="flex items-center gap-2 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5"
          >
            <button
              type="button"
              onClick={() => {
                if (mode === "single") {
                  updateOptions(
                    options.map((opt) => ({
                      ...opt,
                      is_correct: opt.option_id === option.option_id,
                    })),
                  );
                } else {
                  updateOptions(
                    options.map((opt) =>
                      opt.option_id === option.option_id
                        ? { ...opt, is_correct: !opt.is_correct }
                        : opt,
                    ),
                  );
                }
              }}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
                mode === "single" ? "rounded-full" : "rounded"
              } border ${
                option.is_correct
                  ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-300"
                  : "border-slate-400 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:border-slate-400"
              }`}
              title={option.is_correct ? t("coursewareEditor.quizSettings.options.correctOption") : t("coursewareEditor.quizSettings.options.markCorrect")}
              aria-label={option.is_correct ? t("coursewareEditor.quizSettings.options.correctOption") : t("coursewareEditor.quizSettings.options.markCorrect")}
            >
              {option.is_correct ? <CheckCircle2 className="h-4 w-4" /> : null}
            </button>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {String.fromCharCode(65 + index)}.
            </span>
            <input
              value={getQuizOptionText(question, option.option_id)}
              onChange={(e) => updateOptionText(option.option_id, e.target.value)}
              placeholder={t("coursewareEditor.quizSettings.options.placeholder", { index: index + 1 })}
              className="flex-1 bg-transparent px-1 py-0.5 text-sm text-slate-900 dark:text-slate-100 outline-none"
            />
            <button
              type="button"
              onClick={() => removeOption(option.option_id)}
              disabled={options.length <= 2}
              className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-700 dark:hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t("coursewareEditor.quizSettings.options.delete")}
              title={options.length <= 2 ? t("coursewareEditor.quizSettings.options.minTwo") : t("coursewareEditor.common.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="flex items-center justify-center gap-1 rounded border border-dashed border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px] text-slate-400 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5" /> {t("coursewareEditor.quizSettings.options.add")}
        </button>
      </div>
    </Field>
  );
}

interface FillBlankFieldsProps {
  question: QuizFillBlankQuestion;
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
}

/** Comma-separated list: keep the raw text while typing and parse into an array on blur (otherwise a trailing comma couldn't be typed). */
function CommaSeparatedListInput({
  values,
  onCommit,
  placeholder,
  className,
}: {
  values: string[];
  onCommit: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const valuesKey = values.join("\x1f");
  const [draft, setDraft] = useState(() => values.join(", "));

  useEffect(() => {
    setDraft(values.join(", "));
  }, [valuesKey]);

  const commitDraft = (): void => {
    const parsed = parseCommaSeparatedAliases(draft);
    onCommit(parsed);
    setDraft(parsed.join(", "));
  };

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitDraft}
      className={className}
    />
  );
}

function FillBlankFields({ question, onChange }: FillBlankFieldsProps) {
  const { t } = useI18nNew();
  const blankSlotCount = countFillBlankSlotsInTitle(question.title);
  const stemUsesAnswerTags = titleHasFillBlankUnderscores(question.title);
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("coursewareEditor.quizSettings.fillBlank.gradingMode")}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              onChange((prev) => {
                if (prev.type !== "fill_blank") return prev;
                return { ...prev, grading: "exact_match" satisfies QuizFillBlankGrading };
              })
            }
            className={`rounded border px-2 py-2 text-left text-xs transition ${
              question.grading === "exact_match"
                ? "border-blue-500/60 bg-blue-500/10"
                : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-500"
            }`}
          >
            <div className="font-medium">{t("coursewareEditor.quizSettings.fillBlank.exactMatch")}</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.quizSettings.fillBlank.exactMatchDesc")}
            </div>
          </button>
          <button
            type="button"
            onClick={() =>
              onChange((prev) => {
                if (prev.type !== "fill_blank") return prev;
                return { ...prev, grading: "ai" satisfies QuizFillBlankGrading };
              })
            }
            className={`rounded border px-2 py-2 text-left text-xs transition ${
              question.grading === "ai"
                ? "border-blue-500/60 bg-blue-500/10"
                : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-500"
            }`}
          >
            <div className="font-medium">{t("coursewareEditor.quizSettings.fillBlank.ai")}</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.quizSettings.fillBlank.aiDesc")}
            </div>
          </button>
        </div>
      </Field>
      {question.grading === "ai" ? (
        <Field
          label={t("coursewareEditor.quizSettings.fillBlank.gradingCriteria")}
          required
          hint={t("coursewareEditor.quizSettings.fillBlank.gradingCriteriaHint")}
        >
          <textarea
            value={question.grading_criteria}
            rows={4}
            onChange={(e) =>
              onChange((prev) => {
                if (prev.type !== "fill_blank") return prev;
                return { ...prev, grading_criteria: e.target.value };
              })
            }
            placeholder={t("coursewareEditor.quizSettings.fillBlank.gradingCriteriaPlaceholder")}
            className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
          />
        </Field>
      ) : null}
      <BooleanField
        label={t("coursewareEditor.quizSettings.fillBlank.caseSensitive")}
        checked={question.case_sensitive}
        description={
          question.grading === "ai"
            ? t("coursewareEditor.quizSettings.fillBlank.caseSensitiveAiOnly")
            : question.case_sensitive
              ? t("coursewareEditor.quizSettings.fillBlank.caseSensitiveOn")
              : t("coursewareEditor.quizSettings.fillBlank.caseSensitiveOff")
        }
        onChange={(case_sensitive) =>
          onChange((prev) => {
            if (prev.type !== "fill_blank") return prev;
            return { ...prev, case_sensitive };
          })
        }
        disabled={question.grading === "ai"}
      />
      <p
        className={`rounded border px-2 py-1.5 text-[11px] leading-snug ${
          stemUsesAnswerTags
            ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-100/90"
            : "border-amber-900/60 bg-amber-950/40 text-amber-100/90"
        }`}
      >
        {stemUsesAnswerTags
          ? t("coursewareEditor.quizSettings.fillBlank.underscoreHint", {
              count: blankSlotCount,
            })
          : t("coursewareEditor.quizSettings.fillBlank.underscoreRequired")}
      </p>
      <Field label={t("coursewareEditor.quizSettings.fillBlank.blanksConfig")}>
        <div className="flex flex-col gap-2">
          {question.blanks.map((blank, index) => (
            <div
              key={blank.blank_id}
              className="rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2"
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                <span className="min-w-0 flex-1">
                  {t("coursewareEditor.quizSettings.fillBlank.blankN", { index: index + 1 })}
                </span>
                <IconAction
                  label={t("coursewareEditor.quizSettings.fillBlank.deleteBlank")}
                  onClick={() =>
                    onChange((prev) => {
                      if (prev.type !== "fill_blank") return prev;
                      const nextTitle = removeFillBlankSlotAtIndex(prev.title, index);
                      const nextBlanks = prev.blanks.filter((_, i) => i !== index);
                      return applyFillBlankTitleToQuestion({
                        ...prev,
                        title: nextTitle,
                        blanks: nextBlanks,
                      });
                    })
                  }
                  disabled={!stemUsesAnswerTags || question.blanks.length <= 1}
                  danger
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconAction>
              </div>
              <input
                value={blank.answer}
                placeholder={t("coursewareEditor.quizSettings.fillBlank.refAnswer")}
                readOnly={false}
                onChange={(e) =>
                  onChange((prev) => {
                    if (prev.type !== "fill_blank") return prev;
                    return applyFillBlankTitleToQuestion({
                      ...prev,
                      blanks: prev.blanks.map((b) =>
                        b.blank_id === blank.blank_id
                          ? { ...b, answer: e.target.value }
                          : b,
                      ),
                    });
                  })
                }
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500 read-only:cursor-not-allowed read-only:opacity-80"
              />
              <div className="mt-1.5">
                <div className="mb-1 text-[10px] text-slate-400 dark:text-slate-500">
                  {t("coursewareEditor.quizSettings.fillBlank.equivalentAnswers")}
                </div>
                <CommaSeparatedListInput
                  values={blank.aliases}
                  placeholder={t("coursewareEditor.quizSettings.fillBlank.aliasPlaceholder")}
                  onCommit={(aliases) =>
                    onChange((prev) => {
                      if (prev.type !== "fill_blank") return prev;
                      return applyFillBlankTitleToQuestion({
                        ...prev,
                        blanks: prev.blanks.map((b) =>
                          b.blank_id === blank.blank_id ? { ...b, aliases } : b,
                        ),
                      });
                    })
                  }
                  className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange((prev) => {
                if (prev.type !== "fill_blank") return prev;
                const nextTitle = appendFillBlankSlotToTitle(prev.title);
                return applyFillBlankTitleToQuestion({ ...prev, title: nextTitle });
              })
            }
            className="flex items-center justify-center gap-1 rounded border border-dashed border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px] text-slate-400 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" /> {t("coursewareEditor.quizSettings.fillBlank.addBlank")}
          </button>
        </div>
      </Field>
    </div>
  );
}

/** "Scoring keywords" of Q&A questions: split only on commas (full-width included), keeping the raw string while editing so a trailing comma isn't swallowed. */
const parseCommaSeparatedTokens = (raw: string): string[] =>
  raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

interface EssayFieldsProps {
  question: QuizEssayQuestion;
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
}

function EssayFields({ question, onChange }: EssayFieldsProps) {
  const { t } = useI18nNew();
  const [keywordsDraft, setKeywordsDraft] = useState(() => question.keywords.join(", "));
  const keywordsDraftRef = useRef(keywordsDraft);
  keywordsDraftRef.current = keywordsDraft;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setKeywordsDraft(question.keywords.join(", "));
  }, [question.question_id]);

  const commitKeywordsDraft = useCallback(() => {
    const keywords = parseCommaSeparatedTokens(keywordsDraftRef.current);
    onChangeRef.current((prev) => {
      if (prev.type !== "essay") return prev;
      const unchanged =
        prev.keywords.length === keywords.length &&
        prev.keywords.every((word, index) => word === keywords[index]);
      return unchanged ? prev : { ...prev, keywords };
    });
  }, []);

  useEffect(() => {
    const capturedOnChange = onChange;
    const capturedQuestionId = question.question_id;

    return () => {
      const keywords = parseCommaSeparatedTokens(keywordsDraftRef.current);
      capturedOnChange((prev) => {
        if (prev.type !== "essay" || prev.question_id !== capturedQuestionId) return prev;
        const unchanged =
          prev.keywords.length === keywords.length &&
          prev.keywords.every((word, index) => word === keywords[index]);
        return unchanged ? prev : { ...prev, keywords };
      });
    };
  }, [question.question_id]);

  return (
    <div className="flex flex-col gap-3">
      <Field
        label={t("coursewareEditor.quizSettings.essay.gradingCriteria")}
        required
        hint={t("coursewareEditor.quizSettings.essay.gradingCriteriaHint")}
      >
        <textarea
          value={question.grading_criteria}
          rows={4}
          onChange={(e) =>
            onChange((prev) => {
              if (prev.type !== "essay") return prev;
              return { ...prev, grading_criteria: e.target.value };
            })
          }
          placeholder={t("coursewareEditor.quizSettings.essay.gradingCriteriaPlaceholder")}
          className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>
      <Field label={t("coursewareEditor.quizSettings.essay.refAnswer")}>
        <textarea
          value={question.reference_answer}
          rows={4}
          onChange={(e) =>
            onChange((prev) => {
              if (prev.type !== "essay") return prev;
              return { ...prev, reference_answer: e.target.value };
            })
          }
          placeholder={t("coursewareEditor.quizSettings.essay.refAnswerPlaceholder")}
          className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>
      <Field
        label={t("coursewareEditor.quizSettings.essay.keywords")}
        hint={t("coursewareEditor.quizSettings.essay.keywordsHint")}
      >
        <input
          value={keywordsDraft}
          placeholder={t("coursewareEditor.quizSettings.essay.keywordsPlaceholder")}
          onChange={(e) => setKeywordsDraft(e.target.value)}
          onBlur={commitKeywordsDraft}
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>
    </div>
  );
}

interface SpeechFieldsProps {
  coursewareId: string;
  question: QuizSpeechQuestion;
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
}

function SpeechFields({ coursewareId, question, onChange }: SpeechFieldsProps) {
  const { t } = useI18nNew();
  return (
    <div className="flex flex-col gap-3">
      <MediaUploadField
        coursewareId={coursewareId}
        label={t("coursewareEditor.quizSettings.speech.refAudio")}
        hint={t("coursewareEditor.quizSettings.speech.refAudioHint")}
        value={getQuizReferenceAudioUrl(question)}
        accept="audio/*"
        libraryKind="audio"
        onChange={(url) =>
          onChange((prev) => {
            if (prev.type !== "speech") return prev;
            return applyQuizReferenceAudioUrl(prev, url);
          })
        }
        placeholderIcon={<Music className="h-4 w-4" />}
      />
      <Field
        label={t("coursewareEditor.quizSettings.essay.gradingCriteria")}
        required
        hint={t("coursewareEditor.quizSettings.speech.gradingCriteriaHint")}
      >
        <textarea
          value={question.grading_criteria}
          rows={4}
          onChange={(e) =>
            onChange((prev) => {
              if (prev.type !== "speech") return prev;
              return { ...prev, grading_criteria: e.target.value };
            })
          }
          placeholder={t("coursewareEditor.quizSettings.speech.gradingCriteriaPlaceholder")}
          className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>
      <Field
        label={t("coursewareEditor.quizSettings.speech.readingNotes")}
        hint={t("coursewareEditor.quizSettings.speech.readingNotesHint")}
      >
        <textarea
          value={question.prompt}
          rows={2}
          onChange={(e) =>
            onChange((prev) => {
              if (prev.type !== "speech") return prev;
              return { ...prev, prompt: e.target.value };
            })
          }
          placeholder={t("coursewareEditor.quizSettings.speech.readingNotesPlaceholder")}
          className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>
    </div>
  );
}

interface ShadowingFieldsProps {
  coursewareId: string;
  question: QuizShadowingQuestion;
  onChange: (updater: (prev: QuizQuestion) => QuizQuestion) => void;
}

function ShadowingFields({ coursewareId, question, onChange }: ShadowingFieldsProps) {
  const { t } = useI18nNew();
  return (
    <div className="flex flex-col gap-3">
      <Field
        label={t("coursewareEditor.quizSettings.shadowing.refText")}
        hint={t("coursewareEditor.quizSettings.shadowing.refTextHint")}
      >
        <textarea
          value={question.reference_text}
          rows={3}
          onChange={(e) =>
            onChange((prev) => {
              if (prev.type !== "shadowing") return prev;
              return { ...prev, reference_text: e.target.value };
            })
          }
          placeholder={t("coursewareEditor.quizSettings.shadowing.refTextPlaceholder")}
          className="w-full resize-y rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
        />
      </Field>
      <MediaUploadField
        coursewareId={coursewareId}
        label={t("coursewareEditor.quizSettings.shadowing.refAudio")}
        hint={t("coursewareEditor.quizSettings.shadowing.refAudioHint")}
        value={getQuizReferenceAudioUrl(question)}
        accept="audio/*"
        libraryKind="audio"
        onChange={(url) =>
          onChange((prev) => {
            if (prev.type !== "shadowing") return prev;
            return applyQuizReferenceAudioUrl(prev, url);
          })
        }
        placeholderIcon={<Music className="h-4 w-4" />}
      />
    </div>
  );
}

interface QuizGlobalPanelProps {
  config: QuizConfig;
  scoreSum: number;
  scoreSumOk: boolean;
  onChangeTotalScore: (value: number) => void;
  onChangeScoreAllocation: (value: QuizScoreAllocation) => void;
  onChangeTimeLimit: (value: number | null) => void;
  onChangeGradeLevels: (levels: QuizGradeLevel[]) => void;
}

function QuizGlobalPanel({
  config,
  scoreSum,
  scoreSumOk,
  onChangeTotalScore,
  onChangeScoreAllocation,
  onChangeTimeLimit,
  onChangeGradeLevels,
}: QuizGlobalPanelProps) {
  const { t } = useI18nNew();
  const sortedLevels = useMemo(
    () =>
      [...config.grade_levels].sort((a, b) => b.min_score - a.min_score),
    [config.grade_levels],
  );

  const updateLevel = (
    id: string,
    updater: (prev: QuizGradeLevel) => QuizGradeLevel,
  ): void => {
    onChangeGradeLevels(
      config.grade_levels.map((lv) => (lv.level_id === id ? updater(lv) : lv)),
    );
  };

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-white/60 dark:bg-slate-900/60 p-4">
      <h3 className="mb-2 text-xs font-semibold text-slate-800 dark:text-slate-200">{t("coursewareEditor.quizSettings.global.title")}</h3>
      <div className="flex flex-col gap-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-100/85 dark:bg-slate-950/50 p-3">
        <Field
          label={t("coursewareEditor.quizSettings.global.scoreAllocation")}
          hint={
            config.score_allocation === "even_split"
              ? t("coursewareEditor.quizSettings.global.evenSplitHint", { count: config.questions.length })
              : t("coursewareEditor.quizSettings.global.customHint")
          }
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onChangeScoreAllocation("even_split")}
              className={`rounded border px-2 py-2 text-left text-xs transition ${
                config.score_allocation === "even_split"
                  ? "border-blue-500/60 bg-blue-500/10"
                  : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-500"
              }`}
            >
              <div className="font-medium">{t("coursewareEditor.quizSettings.global.evenSplit")}</div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500">{t("coursewareEditor.quizSettings.global.evenSplitDesc")}</div>
            </button>
            <button
              type="button"
              onClick={() => onChangeScoreAllocation("custom")}
              className={`rounded border px-2 py-2 text-left text-xs transition ${
                config.score_allocation === "custom"
                  ? "border-blue-500/60 bg-blue-500/10"
                  : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-500"
              }`}
            >
              <div className="font-medium">{t("coursewareEditor.quizSettings.global.custom")}</div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500">{t("coursewareEditor.quizSettings.global.customDesc")}</div>
            </button>
          </div>
        </Field>
        <NumberField
          label={t("coursewareEditor.quizSettings.global.totalScore")}
          value={config.total_score}
          min={1}
          onChange={onChangeTotalScore}
          hint={
            scoreSumOk
              ? t("coursewareEditor.quizSettings.global.totalScoreOk", { sum: scoreSum })
              : t("coursewareEditor.quizSettings.global.totalScoreBad", { sum: scoreSum })
          }
        />
        <NullableMinuteSecondField
          label={
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {t("coursewareEditor.quizSettings.global.timeLimit")}
            </span>
          }
          value={config.time_limit_minutes}
          onChange={onChangeTimeLimit}
        />
      </div>

      <div className="mt-4 mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          {t("coursewareEditor.quizSettings.global.gradeLevels")}
        </h3>
        <button
          type="button"
          onClick={() =>
            onChangeGradeLevels([
              ...config.grade_levels,
              newQuizGradeLevel({
                label: "",
                min_score: Math.max(0, Math.min(config.total_score, 60)),
                description: "",
              }),
            ])
          }
          className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Plus className="h-3 w-3" /> {t("coursewareEditor.musicSettings.add")}
        </button>
      </div>
      {config.grade_levels.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 dark:border-slate-700 px-2 py-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
          {t("coursewareEditor.quizSettings.global.noGradeLevels")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sortedLevels.map((level) => (
            <div
              key={level.level_id}
              className="rounded border border-slate-200 dark:border-slate-800 bg-slate-100/85 dark:bg-slate-950/60 p-2"
            >
              <div className="flex items-center gap-2">
                <input
                  value={level.label}
                  placeholder={t("coursewareEditor.quizSettings.global.gradeLabelPlaceholder")}
                  onChange={(e) =>
                    updateLevel(level.level_id, (prev) => ({
                      ...prev,
                      label: e.target.value,
                    }))
                  }
                  className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
                />
                <span className="text-[11px] text-slate-400 dark:text-slate-500">≥</span>
                <input
                  type="number"
                  min={0}
                  max={config.total_score}
                  value={level.min_score}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    if (!Number.isFinite(parsed)) return;
                    const next = Math.max(0, Math.min(config.total_score, parsed));
                    updateLevel(level.level_id, (prev) => ({
                      ...prev,
                      min_score: next,
                    }));
                  }}
                  className="w-20 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
                />
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  {t("coursewareEditor.common.pointsUnit")}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChangeGradeLevels(
                      config.grade_levels.filter(
                        (lv) => lv.level_id !== level.level_id,
                      ),
                    )
                  }
                  className="ml-auto rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-700 dark:hover:text-rose-300"
                  aria-label={t("coursewareEditor.quizSettings.global.deleteGrade")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={level.description}
                placeholder={t("coursewareEditor.quizSettings.global.gradeDescPlaceholder")}
                onChange={(e) =>
                  updateLevel(level.level_id, (prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                className="mt-1.5 w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[12px] text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
