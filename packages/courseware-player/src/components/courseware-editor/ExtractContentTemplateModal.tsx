// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, FolderOpen, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import toast from "react-hot-toast";
import type { CoursewareAssetItem } from "../../api/courseware.ts";
import { extractContentTemplate } from "../../api/courseware_content_templates.ts";
import { isCoursewareImageAsset } from "./CoursewareAssetLibraryPicker.tsx";
import { CoursewareExtractableAssetPickerModal } from "./ExtractDesignTemplateModal.tsx";
import { CoursewareLibraryPickerModal } from "./CoursewareLibraryPickerModal.tsx";
import { TemplateExtractLanguageSelect } from "./TemplateExtractLanguageSelect.tsx";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "../../lib/courseware-editor-theme.ts";
import {
  toReferencedContentTemplateItem,
  type ReferencedContentTemplateItem,
} from "../../lib/courseware/ai-content-template-mentions.ts";
import type { ReferencedCoursewareItem } from "../../lib/courseware/ai-courseware-mentions.ts";
import type { TemplateExtractLanguage } from "../../lib/courseware/template-extract-language.ts";

type ExtractSourceKind = "currentCourseware" | "otherCourseware" | "asset";

export type ExtractContentTemplateModalProps = {
  open: boolean;
  themeMode: EditorThemeMode;
  orgId?: string | null;
  coursewareId?: string | null;
  sectionCourseId?: string | null;
  onClose: () => void;
  /** Extraction succeeded: optionally reference it in the input box right away */
  onExtracted?: (item: ReferencedContentTemplateItem) => void;
};

export function ExtractContentTemplateModal({
  open,
  themeMode,
  orgId,
  coursewareId,
  sectionCourseId,
  onClose,
  onExtracted,
}: ExtractContentTemplateModalProps) {
  const { t } = useI18nNew();
  const resolvedOrgId = orgId?.trim() || null;
  const resolvedCoursewareId = coursewareId?.trim() || null;
  const [name, setName] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<TemplateExtractLanguage>("auto");
  const [sourceKind, setSourceKind] = useState<ExtractSourceKind>("currentCourseware");
  const [selectedCourseware, setSelectedCourseware] = useState<ReferencedCoursewareItem | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<CoursewareAssetItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [coursewarePickerOpen, setCoursewarePickerOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setOutputLanguage("auto");
      setSourceKind("currentCourseware");
      setSelectedCourseware(null);
      setSelectedAsset(null);
      setCoursewarePickerOpen(false);
      setAssetPickerOpen(false);
      return;
    }
    if (!resolvedCoursewareId) {
      setSourceKind("otherCourseware");
    }
  }, [open, resolvedCoursewareId]);

  const handleSubmit = useCallback(async () => {
    if (!resolvedOrgId) {
      toast.error(t("coursewareEditor.contentTemplate.noOrg"));
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t("coursewareEditor.contentTemplate.nameRequired"));
      return;
    }

    let extractCoursewareId: string | undefined;
    let extractAssetId: string | undefined;

    if (sourceKind === "currentCourseware") {
      if (!resolvedCoursewareId) {
        toast.error(t("coursewareEditor.contentTemplate.noCurrentCourseware"));
        return;
      }
      extractCoursewareId = resolvedCoursewareId;
    } else if (sourceKind === "otherCourseware") {
      if (!selectedCourseware?.id) {
        toast.error(t("coursewareEditor.contentTemplate.pickCoursewareRequired"));
        return;
      }
      extractCoursewareId = selectedCourseware.id;
    } else {
      if (!selectedAsset?.id) {
        toast.error(t("coursewareEditor.contentTemplate.pickAssetRequired"));
        return;
      }
      extractAssetId = selectedAsset.id;
    }

    setSubmitting(true);
    try {
      const template = await extractContentTemplate({
        orgId: resolvedOrgId,
        name: trimmedName,
        sourceType: sourceKind === "asset" ? "asset" : "courseware",
        coursewareId: extractCoursewareId,
        assetId: extractAssetId,
        language: outputLanguage,
      });
      toast.success(t("coursewareEditor.contentTemplate.extractSuccess"));
      onExtracted?.(
        toReferencedContentTemplateItem({ id: template.id, name: template.name }),
      );
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("coursewareEditor.contentTemplate.extractFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    name,
    onClose,
    onExtracted,
    outputLanguage,
    resolvedCoursewareId,
    resolvedOrgId,
    selectedAsset?.id,
    selectedCourseware?.id,
    sourceKind,
    t,
  ]);

  if (!open || typeof document === "undefined") return null;

  const sourceButtonClass =
    "ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80";

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[12100] flex items-center justify-center bg-black/40 p-4"
        {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
        role="dialog"
        aria-modal="true"
        aria-label={t("coursewareEditor.contentTemplate.extractTitle")}
        onMouseDown={(ev) => {
          if (ev.target === ev.currentTarget) onClose();
        }}
      >
        <div
          className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("coursewareEditor.contentTemplate.extractTitle")}
            </h2>
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={t("coursewareEditor.common.close")}
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="space-y-4 px-4 py-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {t("coursewareEditor.contentTemplate.nameLabel")}
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("coursewareEditor.contentTemplate.namePlaceholder")}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>

            <TemplateExtractLanguageSelect
              value={outputLanguage}
              onChange={setOutputLanguage}
            />

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {t("coursewareEditor.contentTemplate.sourceLabel")}
              </legend>
              {resolvedCoursewareId ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                  <input
                    type="radio"
                    name="extract-source"
                    checked={sourceKind === "currentCourseware"}
                    onChange={() => setSourceKind("currentCourseware")}
                  />
                  {t("coursewareEditor.contentTemplate.sourceCurrent")}
                </label>
              ) : null}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="extract-source"
                  checked={sourceKind === "otherCourseware"}
                  onChange={() => setSourceKind("otherCourseware")}
                />
                {t("coursewareEditor.contentTemplate.sourceOtherCourseware")}
              </label>
              {sourceKind === "otherCourseware" ? (
                <button
                  type="button"
                  className={sourceButtonClass}
                  onClick={() => setCoursewarePickerOpen(true)}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                  <span className="truncate">
                    {selectedCourseware?.title ??
                      t("coursewareEditor.contentTemplate.pickCourseware")}
                  </span>
                </button>
              ) : null}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="extract-source"
                  checked={sourceKind === "asset"}
                  onChange={() => setSourceKind("asset")}
                />
                {t("coursewareEditor.contentTemplate.sourceAsset")}
              </label>
              {sourceKind === "asset" ? (
                <button
                  type="button"
                  className={sourceButtonClass}
                  onClick={() => setAssetPickerOpen(true)}
                >
                  {selectedAsset && isCoursewareImageAsset(selectedAsset) ? (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                  )}
                  <span className="truncate">
                    {selectedAsset?.name ?? t("coursewareEditor.contentTemplate.pickAsset")}
                  </span>
                </button>
              ) : null}
            </fieldset>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={onClose}
              disabled={submitting}
            >
              {t("coursewareEditor.common.cancel")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {t("coursewareEditor.contentTemplate.extracting")}
                </span>
              ) : (
                t("coursewareEditor.contentTemplate.extractAction")
              )}
            </button>
          </div>
        </div>
      </div>
      <CoursewareLibraryPickerModal
        open={coursewarePickerOpen}
        themeMode={themeMode}
        overlayZIndexClass="z-[12150]"
        excludeCoursewareId={resolvedCoursewareId}
        sectionCourseId={sectionCourseId}
        orgId={orgId}
        onClose={() => setCoursewarePickerOpen(false)}
        onPick={(item) => {
          setSelectedCourseware(item);
          setCoursewarePickerOpen(false);
        }}
      />
      <CoursewareExtractableAssetPickerModal
        open={assetPickerOpen}
        themeMode={themeMode}
        coursewareId={resolvedCoursewareId}
        onClose={() => setAssetPickerOpen(false)}
        onPick={(asset) => {
          setSelectedAsset(asset);
          setAssetPickerOpen(false);
        }}
      />
    </>,
    document.body,
  );
}
