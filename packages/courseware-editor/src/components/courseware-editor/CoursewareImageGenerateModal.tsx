// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { ImagePlus, Loader2, Sparkles, WandSparkles, X } from "lucide-react";

import coursewareAssetsApi from "@ainobi/courseware-player/api/courseware_assets";
import type { CoursewareAssetItem } from "@ainobi/courseware-player/api/courseware";
import type { EditorThemeMode } from "@ainobi/courseware-player/lib/courseware-editor-theme";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";

type ImageSizeOption = { value: string; label: string };

export type CoursewareImageGenerateModalProps = {
  coursewareId: string;
  coursewareOrgId?: string | null;
  themeMode: EditorThemeMode;
  /** Insert the generated asset into the canvas (the asset is already stored in the courseware asset library). */
  onInsert: (asset: CoursewareAssetItem) => void;
  onClose: () => void;
};

/**
 * AI image generation dialog: write a prompt → optional "optimize prompt" → generate (gpt-image-2) → preview → insert into the canvas.
 * The courseware service stores the result as a courseware asset; the frontend only triggers and inserts it.
 */
export function CoursewareImageGenerateModal({
  coursewareId,
  coursewareOrgId,
  themeMode,
  onInsert,
  onClose,
}: CoursewareImageGenerateModalProps) {
  const { t, language } = useI18nNew();
  const sizeOptions = useMemo(
    (): ImageSizeOption[] => [
      { value: "auto", label: t("coursewareEditor.imageGenerate.optionAuto") },
      { value: "1024x1024", label: t("coursewareEditor.imageGenerate.sizeSquare") },
      { value: "1536x1024", label: t("coursewareEditor.imageGenerate.sizeLandscape") },
      { value: "1024x1536", label: t("coursewareEditor.imageGenerate.sizePortrait") },
    ],
    [t],
  );
  const qualityOptions = useMemo(
    (): ImageSizeOption[] => [
      { value: "auto", label: t("coursewareEditor.imageGenerate.optionAuto") },
      { value: "low", label: t("coursewareEditor.imageGenerate.qualityLow") },
      { value: "medium", label: t("coursewareEditor.imageGenerate.qualityMedium") },
      { value: "high", label: t("coursewareEditor.imageGenerate.qualityHigh") },
    ],
    [t],
  );
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<string>("auto");
  const [quality, setQuality] = useState<string>("auto");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<CoursewareAssetItem | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isGenerating && !isOptimizing) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isGenerating, isOptimizing, onClose]);

  const busy = isGenerating || isOptimizing;
  const trimmedPrompt = prompt.trim();

  const handleOptimize = async (): Promise<void> => {
    if (!trimmedPrompt || busy) return;
    setIsOptimizing(true);
    setError(null);
    try {
      const result = await coursewareAssetsApi.optimizeImagePrompt({
        prompt: trimmedPrompt,
        coursewareId,
        language,
      });
      setPrompt(result.optimizedPrompt);
      toast.success(t("coursewareEditor.imageGenerate.toastOptimized"), { duration: 2500 });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("coursewareEditor.imageGenerate.optimizeFailed");
      setError(message);
      toast.error(message);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleGenerate = async (): Promise<void> => {
    if (!trimmedPrompt || busy) return;
    setIsGenerating(true);
    setError(null);
    try {
      const result = await coursewareAssetsApi.generateImage({
        coursewareId,
        prompt: trimmedPrompt,
        size,
        quality,
        language,
      });
      setGenerated(result.asset);
      toast.success(t("coursewareEditor.imageGenerate.toastGenerated"), { duration: 3000 });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("coursewareEditor.imageGenerate.generateFailed");
      setError(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleInsert = (): void => {
    if (!generated) return;
    onInsert(generated);
    onClose();
  };

  return createPortal(
    <div
      data-toolbar-image-generate
      data-courseware-editor-theme={themeMode}
      className="fixed inset-0 z-110 flex items-center justify-center bg-slate-900/35 p-4 dark:bg-slate-950/50 sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-[min(96vw,760px)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {t("coursewareEditor.imageGenerate.title")}
          </div>
          <button
            type="button"
            disabled={busy}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={t("coursewareEditor.common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t("coursewareEditor.imageGenerate.promptLabel")}
              </label>
              <button
                type="button"
                disabled={!trimmedPrompt || busy}
                onClick={() => void handleOptimize()}
                className="inline-flex items-center gap-1.5 rounded border border-blue-400/45 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500/50 dark:text-blue-300 dark:hover:bg-blue-500/10"
              >
                {isOptimizing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <WandSparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {t("coursewareEditor.imageGenerate.optimize")}
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={busy}
              rows={4}
              maxLength={4000}
              placeholder={t("coursewareEditor.imageGenerate.promptPlaceholder")}
              className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t("coursewareEditor.imageGenerate.sizeLabel")}
              <select
                value={size}
                onChange={(event) => setSize(event.target.value)}
                disabled={busy}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {sizeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t("coursewareEditor.imageGenerate.qualityLabel")}
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value)}
                disabled={busy}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {qualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error ? (
            <div className="rounded border border-rose-300/60 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          <div className="flex min-h-[220px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/50">
            {isGenerating ? (
              <div className="flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                {t("coursewareEditor.imageGenerate.generating")}
              </div>
            ) : generated ? (
              <img
                src={generated.url}
                alt={generated.name}
                className="max-h-[46vh] w-auto max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 text-center text-xs text-slate-400 dark:text-slate-500">
                <ImagePlus className="h-7 w-7" />
                {t("coursewareEditor.imageGenerate.previewEmpty")}
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t("coursewareEditor.common.cancel")}
          </button>
          <button
            type="button"
            disabled={!trimmedPrompt || busy}
            onClick={() => void handleGenerate()}
            className="inline-flex items-center gap-1.5 rounded border border-blue-400/45 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500/50 dark:text-blue-300 dark:hover:bg-blue-500/10"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            {generated
              ? t("coursewareEditor.imageGenerate.regenerate")
              : t("coursewareEditor.imageGenerate.generate")}
          </button>
          <button
            type="button"
            disabled={!generated || busy}
            onClick={handleInsert}
            className="inline-flex items-center gap-1.5 rounded bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden />
            {t("coursewareEditor.imageGenerate.insert")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export default CoursewareImageGenerateModal;
