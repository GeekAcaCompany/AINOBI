// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { LayoutTemplate, Redo2, Undo2, X } from "lucide-react";

import type { QuizSlideElement } from "@ainobi/courseware-core/elements.ts";
import {
  applyQuizLayoutAstMutation,
  canDeleteQuizAstNode,
  resolveQuizAstDeletePath,
  executeQuizAstDrop,
  type QuizAstDropPlan,
  getQuizAstNodeAtPath,
  getQuizAstParentInfo,
  getQuizAstStyleRecord,
  moveQuizAstNodeAtPath,
  quizAstNodeSupportsStyle,
  patchQuizAstContainerAlign,
  patchQuizAstStyleAtPath,
  type QuizAstContainerAlign,
  removeQuizAstNodeAtPath,
  removeQuizAstStyleKeyAtPath,
  setQuizAstTextAtPath,
  type QuizAstPath,
  type QuizInterpEditableField,
} from "@ainobi/courseware-player/lib/courseware/quiz-ast-editor";
import type { QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";
import type { QuizQuestion } from "@ainobi/courseware-core/quiz.ts";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";

import { QuizLayoutInspector } from "./QuizLayoutInspector.tsx";
import { QuizLayoutStage, type QuizLayoutSlideBackdrop } from "./QuizLayoutStage.tsx";
import { useQuizLayoutHistory } from "./useQuizLayoutHistory.ts";

const STAGE_WIDTH = 800;
const STAGE_HEIGHT = 600;

const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

const MARGIN_NUDGE_STEP_PX = 1;
const MARGIN_NUDGE_STEP_SHIFT_PX = 8;

const readMarginPx = (style: Record<string, string | number>, key: string): number => {
  const raw = style[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    if (raw === "auto") return 0;
    const trimmed = raw.trim();
    if (trimmed.endsWith("px")) {
      const n = Number.parseFloat(trimmed);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
};

export interface QuizLayoutEditorModalProps {
  question: QuizQuestion;
  quizElement: QuizSlideElement;
  slideBackdrop: QuizLayoutSlideBackdrop;
  onClose: () => void;
  onConfirm: (nextQuestion: QuizQuestion) => void;
}

export function QuizLayoutEditorModal({
  question,
  quizElement,
  slideBackdrop,
  onClose,
  onConfirm,
}: QuizLayoutEditorModalProps) {
  const { t } = useI18nNew();
  const initialLayout = question.react_layout;
  const { layout, revision, commitLayout, resetLayout, undo, redo, canUndo, canRedo } =
    useQuizLayoutHistory(initialLayout);

  const [selectedPath, setSelectedPath] = useState<QuizAstPath | null>(null);
  const [textEditPreview, setTextEditPreview] = useState<{
    path: QuizAstPath;
    text: string;
  } | null>(null);

  // Question text fields bound to interpolation placeholders ({$title}, …).
  // Editing these here is explicit and clearly labeled — it intentionally
  // updates the field used everywhere that placeholder appears.
  const [fields, setFields] = useState<Record<QuizInterpEditableField, string>>(() => ({
    title: question.title ?? "",
    explanation: question.explanation ?? "",
    reference_text:
      question.type === "speech" || question.type === "shadowing"
        ? (question as { reference_text?: string }).reference_text ?? ""
        : "",
  }));

  const effectiveLayout = useMemo((): QuizAstNode => {
    if (!textEditPreview) return layout;
    const patched = setQuizAstTextAtPath(layout, textEditPreview.path, textEditPreview.text);
    return patched ?? layout;
  }, [layout, textEditPreview]);

  const previewQuestion = useMemo(
    (): QuizQuestion => ({
      ...question,
      title: fields.title,
      explanation: fields.explanation,
      ...(question.type === "speech" || question.type === "shadowing"
        ? { reference_text: fields.reference_text }
        : {}),
      react_layout: effectiveLayout,
    }),
    [effectiveLayout, fields.explanation, fields.reference_text, fields.title, question],
  );

  const viewport = useMemo(
    () => ({
      width: Math.max(320, Math.round(quizElement.size.width)) || STAGE_WIDTH,
      height: Math.max(240, Math.round(quizElement.size.height)) || STAGE_HEIGHT,
    }),
    [quizElement.size.height, quizElement.size.width],
  );

  /** Validate + commit a layout-producing mutation. Returns success. */
  const tryCommit = useCallback(
    (produce: (current: QuizAstNode) => QuizAstNode | null): boolean => {
      const result = applyQuizLayoutAstMutation(layout, previewQuestion, produce);
      if (!result) {
        toast.error(t("coursewareEditor.quizLayout.mutationFailed"));
        return false;
      }
      if (result.issues.length > 0) {
        toast.error(result.issues[0]?.message ?? t("coursewareEditor.quizLayout.validationFailed"));
        return false;
      }
      commitLayout(result.layout);
      return true;
    },
    [commitLayout, layout, previewQuestion, t],
  );

  const handlePreviewTextAtPath = useCallback((path: QuizAstPath, text: string) => {
    setTextEditPreview({ path, text });
  }, []);

  const handleCommitTextAtPath = useCallback(
    (path: QuizAstPath, text: string) => {
      setTextEditPreview((prev) => (prev?.path === path ? null : prev));
      const node = getQuizAstNodeAtPath(layout, path);
      if (node?.kind === "text" && node.text === text) return;
      tryCommit((current) => setQuizAstTextAtPath(current, path, text));
    },
    [layout, tryCommit],
  );

  const handleCommitText = useCallback(
    (text: string) => {
      if (selectedPath === null) return;
      handleCommitTextAtPath(selectedPath, text);
    },
    [handleCommitTextAtPath, selectedPath],
  );

  const handlePreviewTextForSelection = useCallback(
    (text: string) => {
      if (selectedPath === null) return;
      handlePreviewTextAtPath(selectedPath, text);
    },
    [handlePreviewTextAtPath, selectedPath],
  );

  const handleCommitField = useCallback(
    (field: QuizInterpEditableField, value: string) => {
      setFields((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleStyleChange = useCallback(
    (key: string, value: string | number | null) => {
      if (selectedPath === null) return;
      if (value === null || value === "") {
        tryCommit((current) => removeQuizAstStyleKeyAtPath(current, selectedPath, key));
        return;
      }
      tryCommit((current) => patchQuizAstStyleAtPath(current, selectedPath, { [key]: value }));
    },
    [selectedPath, tryCommit],
  );

  const handleMove = useCallback(
    (delta: number) => {
      if (selectedPath === null) return;
      const result = moveQuizAstNodeAtPath(layout, selectedPath, delta);
      if (!result) return;
      if (tryCommit(() => result.layout)) {
        setSelectedPath(result.nextPath);
      }
    },
    [layout, selectedPath, tryCommit],
  );

  const handleResize = useCallback(
    (path: QuizAstPath, width: number, height: number) => {
      tryCommit((current) =>
        patchQuizAstStyleAtPath(current, path, {
          width: Math.round(width),
          height: Math.round(height),
          boxSizing: "border-box",
        }),
      );
    },
    [tryCommit],
  );

  const handleAlignChange = useCallback(
    (align: QuizAstContainerAlign) => {
      if (selectedPath === null) return;
      tryCommit((current) => patchQuizAstContainerAlign(current, selectedPath, align));
    },
    [selectedPath, tryCommit],
  );

  const handleMarginNudge = useCallback(
    (patch: Partial<Record<"marginTop" | "marginRight" | "marginBottom" | "marginLeft", number>>) => {
      if (selectedPath === null) return false;
      const node = getQuizAstNodeAtPath(layout, selectedPath);
      if (!node || !quizAstNodeSupportsStyle(node)) return false;

      const style = getQuizAstStyleRecord(node);
      const merged: Record<string, number> = {};
      for (const [key, delta] of Object.entries(patch)) {
        if (delta === undefined) continue;
        merged[key] = readMarginPx(style, key) + delta;
      }
      if (Object.keys(merged).length === 0) return false;

      return tryCommit((current) => patchQuizAstStyleAtPath(current, selectedPath, merged));
    },
    [layout, selectedPath, tryCommit],
  );

  const handleDrop = useCallback(
    (fromPath: QuizAstPath, plan: QuizAstDropPlan) => {
      const result = executeQuizAstDrop(layout, previewQuestion, fromPath, plan);
      if (!result) {
        toast.error(t("coursewareEditor.quizLayout.cannotDrop"));
        return;
      }
      commitLayout(result.layout);
      setSelectedPath(result.nextPath);
    },
    [commitLayout, layout, previewQuestion, t],
  );

  const handleDeleteAtPath = useCallback(
    (path: QuizAstPath, options?: { confirm?: boolean }) => {
      if (!canDeleteQuizAstNode(layout, path)) {
        toast.error(t("coursewareEditor.quizLayout.cannotDelete"));
        return;
      }
      if (options?.confirm !== false && !window.confirm(t("coursewareEditor.quizLayout.deleteConfirm"))) {
        return;
      }
      const result = removeQuizAstNodeAtPath(layout, path);
      if (!result) return;
      if (tryCommit(() => result.layout)) {
        setSelectedPath(result.nextPath);
      }
    },
    [layout, t, tryCommit],
  );

  const handleDelete = useCallback(() => {
    if (selectedPath === null) return;
    const path = resolveQuizAstDeletePath(layout, selectedPath);
    if (!path) {
      toast.error(t("coursewareEditor.quizLayout.cannotDeleteComponent"));
      return;
    }
    handleDeleteAtPath(path, { confirm: true });
  }, [handleDeleteAtPath, layout, selectedPath, t]);

  const moveMeta = useMemo(() => {
    if (selectedPath === null) return { canMoveUp: false, canMoveDown: false };
    const node = getQuizAstNodeAtPath(layout, selectedPath);
    if (!node || node.kind !== "element") return { canMoveUp: false, canMoveDown: false };
    const info = getQuizAstParentInfo(layout, selectedPath);
    if (!info) return { canMoveUp: false, canMoveDown: false };
    return {
      canMoveUp: info.childIndex > 0,
      canMoveDown: info.childIndex < info.siblingCount - 1,
    };
  }, [layout, selectedPath]);

  const handleConfirm = useCallback(() => {
    let layoutToSave = layout;
    if (textEditPreview) {
      const patched = setQuizAstTextAtPath(
        layout,
        textEditPreview.path,
        textEditPreview.text,
      );
      if (patched) layoutToSave = patched;
    }
    const confirmPreview: QuizQuestion = {
      ...question,
      title: fields.title,
      explanation: fields.explanation,
      ...(question.type === "speech" || question.type === "shadowing"
        ? { reference_text: fields.reference_text }
        : {}),
      react_layout: layoutToSave,
    };
    const result = applyQuizLayoutAstMutation(layoutToSave, confirmPreview, (c) => c);
    if (!result || result.issues.length > 0) {
      toast.error(t("coursewareEditor.quizLayout.validationFailed"));
      return;
    }
    const nextQuestion: QuizQuestion = {
      ...question,
      title: fields.title,
      explanation: fields.explanation,
      ...(question.type === "speech" || question.type === "shadowing"
        ? { reference_text: fields.reference_text }
        : {}),
      react_layout: result.layout,
    } as QuizQuestion;
    onConfirm(nextQuestion);
  }, [fields, layout, onConfirm, question, t, textEditPreview]);

  const handleReset = useCallback(() => {
    if (!window.confirm(t("coursewareEditor.quizLayout.resetConfirm"))) return;
    resetLayout(initialLayout);
    setFields({
      title: question.title ?? "",
      explanation: question.explanation ?? "",
      reference_text:
        question.type === "speech" || question.type === "shadowing"
          ? (question as { reference_text?: string }).reference_text ?? ""
          : "",
    });
    setSelectedPath(null);
  }, [initialLayout, question, resetLayout, t]);

  // Keyboard: Esc closes; Cmd/Ctrl+Z / Shift+Z undo-redo; Delete removes node.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedPath) return;
        e.preventDefault();
        e.stopPropagation();
        const deletePath = resolveQuizAstDeletePath(layout, selectedPath);
        if (!deletePath) {
          toast.error(t("coursewareEditor.quizLayout.cannotDeleteComponent"));
          return;
        }
        handleDeleteAtPath(deletePath, { confirm: true });
        return;
      }

      if (!selectedPath || mod) return;
      const step = e.shiftKey ? MARGIN_NUDGE_STEP_SHIFT_PX : MARGIN_NUDGE_STEP_PX;
      const marginPatch: Partial<
        Record<"marginTop" | "marginRight" | "marginBottom" | "marginLeft", number>
      > = {};
      switch (e.key) {
        case "ArrowUp":
          marginPatch.marginTop = -step;
          break;
        case "ArrowDown":
          marginPatch.marginTop = step;
          break;
        case "ArrowLeft":
          marginPatch.marginLeft = -step;
          break;
        case "ArrowRight":
          marginPatch.marginLeft = step;
          break;
        default:
          return;
      }
      if (handleMarginNudge(marginPatch)) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleDeleteAtPath, handleMarginNudge, layout, onClose, redo, selectedPath, undo]);

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-slate-950/80">
      <div className="flex h-full max-h-[94vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2">
            <LayoutTemplate className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t("coursewareEditor.quizLayout.title")}
              </h2>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {fields.title || question.question_id}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={t("coursewareEditor.toolbar.undo")}
              disabled={!canUndo}
              onClick={undo}
              className="rounded p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t("coursewareEditor.toolbar.redo")}
              disabled={!canRedo}
              onClick={redo}
              className="rounded p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t("coursewareEditor.quizLayout.reset")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={t("coursewareEditor.common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col bg-slate-100/80 dark:bg-slate-950/50">
            <div className="min-h-0 flex-1 overflow-hidden">
              <QuizLayoutStage
                question={previewQuestion}
                layout={effectiveLayout}
                viewportWidth={viewport.width}
                viewportHeight={viewport.height}
                slideBackdrop={slideBackdrop}
                revision={revision}
                selectedPath={selectedPath}
                interpFieldValues={fields}
                onSelectPath={setSelectedPath}
                onPreviewText={handlePreviewTextAtPath}
                onCommitText={handleCommitTextAtPath}
                onCommitField={handleCommitField}
                onDrop={handleDrop}
                onResize={handleResize}
              />
            </div>
          </div>

          <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/80">
            <QuizLayoutInspector
              layout={effectiveLayout}
              selectedPath={selectedPath}
              interpFieldValues={fields}
              onPreviewText={handlePreviewTextForSelection}
              onCommitText={handleCommitText}
              onCommitField={handleCommitField}
              onStyleChange={handleStyleChange}
              onAlignChange={handleAlignChange}
              onDelete={handleDelete}
              canDelete={
                selectedPath !== null && resolveQuizAstDeletePath(layout, selectedPath) !== null
              }
              onMoveUp={() => handleMove(-1)}
              onMoveDown={() => handleMove(1)}
              canMoveUp={moveMeta.canMoveUp}
              canMoveDown={moveMeta.canMoveDown}
            />
          </aside>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t("coursewareEditor.common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {t("coursewareEditor.quizLayout.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
