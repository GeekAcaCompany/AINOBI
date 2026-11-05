// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  deleteDesignTemplate,
  getDesignTemplate,
  listDesignTemplates,
  updateDesignTemplate,
  type DesignTemplateListItem,
} from "../../api/courseware_design_templates.ts";
import MarkdownRenderer from "../MarkdownRenderer.tsx";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "../../lib/courseware-editor-theme.ts";
import {
  toReferencedDesignTemplateItem,
  type ReferencedDesignTemplateItem,
} from "../../lib/courseware/ai-design-template-mentions.ts";
import { removeDesignTemplateMentionRecent } from "../../lib/courseware/ai-mention-recents.ts";

export type DesignTemplatePickerModalProps = {
  open: boolean;
  themeMode: EditorThemeMode;
  orgId?: string | null;
  onClose: () => void;
  onPick: (item: ReferencedDesignTemplateItem) => void;
  /** Open the "extract as design template" dialog */
  onExtractNew?: () => void;
  /** Refresh the list when incremented (e.g. after extraction completes) */
  listRefreshKey?: number;
  /** After refreshing, select and preview this template automatically */
  focusTemplateId?: string | null;
  /** Callback after a successful delete (e.g. refreshing the AI panel's recently used) */
  onDeleted?: () => void;
};

type DetailViewMode = "preview" | "edit";

function filterTemplates(
  items: readonly DesignTemplateListItem[],
  query: string,
): DesignTemplateListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => {
    const name = item.name.toLowerCase();
    const preview = item.contentPreview.toLowerCase();
    return name.includes(q) || preview.includes(q);
  });
}

function buildContentPreview(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

export function DesignTemplatePickerModal({
  open,
  themeMode,
  orgId,
  onClose,
  onPick,
  onExtractNew,
  listRefreshKey = 0,
  focusTemplateId = null,
  onDeleted,
}: DesignTemplatePickerModalProps) {
  const { t } = useI18nNew();
  const resolvedOrgId = orgId?.trim() || null;
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DesignTemplateListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DetailViewMode>("preview");
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => filterTemplates(items, search), [items, search]);
  const isDirty = useMemo(() => {
    if (!selectedId) return false;
    return editName.trim() !== (items.find((row) => row.id === selectedId)?.name ?? "").trim()
      || editContent.trim() !== previewContent.trim();
  }, [editContent, editName, items, previewContent, selectedId]);

  const loadList = useCallback(async () => {
    if (!resolvedOrgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const result = await listDesignTemplates({ orgId: resolvedOrgId, pageSize: 100 });
      setItems(result.items);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("coursewareEditor.designTemplate.loadFailed"),
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [resolvedOrgId, t]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedId(null);
      setPreviewContent("");
      setViewMode("preview");
      setEditName("");
      setEditContent("");
      return;
    }
    void loadList();
  }, [loadList, open]);

  useEffect(() => {
    if (!open || listRefreshKey <= 0) return;
    void (async () => {
      await loadList();
      if (focusTemplateId) {
        setSelectedId(focusTemplateId);
        setViewMode("preview");
      }
    })();
  }, [focusTemplateId, listRefreshKey, loadList, open]);

  useEffect(() => {
    if (!open || !selectedId || !resolvedOrgId) {
      setPreviewContent("");
      setEditName("");
      setEditContent("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setViewMode("preview");
    void (async () => {
      try {
        const detail = await getDesignTemplate({ orgId: resolvedOrgId, id: selectedId });
        if (!cancelled) {
          const content = detail?.content ?? "";
          setPreviewContent(content);
          setEditName(detail?.name ?? "");
          setEditContent(content);
        }
      } catch {
        if (!cancelled) {
          setPreviewContent("");
          setEditName("");
          setEditContent("");
          toast.error(t("coursewareEditor.designTemplate.previewFailed"));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resolvedOrgId, selectedId, t]);

  const handleDelete = useCallback(
    async (item: DesignTemplateListItem) => {
      if (!resolvedOrgId) return;
      if (!window.confirm(t("coursewareEditor.designTemplate.deleteConfirm", { name: item.name }))) {
        return;
      }
      setDeletingId(item.id);
      try {
        await deleteDesignTemplate({ orgId: resolvedOrgId, id: item.id });
        removeDesignTemplateMentionRecent(resolvedOrgId, item.id);
        onDeleted?.();
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        if (selectedId === item.id) {
          setSelectedId(null);
          setPreviewContent("");
          setEditName("");
          setEditContent("");
        }
        toast.success(t("coursewareEditor.designTemplate.deleted"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("coursewareEditor.designTemplate.deleteFailed"),
        );
      } finally {
        setDeletingId(null);
      }
    },
    [onDeleted, resolvedOrgId, selectedId, t],
  );

  const handleSave = useCallback(async () => {
    if (!resolvedOrgId || !selectedId) return;
    const trimmedName = editName.trim();
    const trimmedContent = editContent.trim();
    if (!trimmedName) {
      toast.error(t("coursewareEditor.designTemplate.nameRequired"));
      return;
    }
    if (!trimmedContent) {
      toast.error(t("coursewareEditor.designTemplate.contentRequired"));
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDesignTemplate({
        orgId: resolvedOrgId,
        id: selectedId,
        name: trimmedName,
        content: trimmedContent,
      });
      setPreviewContent(updated.content);
      setEditName(updated.name);
      setEditContent(updated.content);
      setItems((prev) =>
        prev.map((row) =>
          row.id === selectedId
            ? {
                ...row,
                name: updated.name,
                contentPreview: buildContentPreview(updated.content),
                updatedAt: updated.updatedAt,
              }
            : row,
        ),
      );
      setViewMode("preview");
      toast.success(t("coursewareEditor.designTemplate.saveSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("coursewareEditor.designTemplate.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }, [editContent, editName, resolvedOrgId, selectedId, t]);

  const handleClose = useCallback(() => {
    if (isDirty && viewMode === "edit") {
      if (!window.confirm(t("coursewareEditor.designTemplate.discardEditsConfirm"))) {
        return;
      }
    }
    onClose();
  }, [isDirty, onClose, t, viewMode]);

  const handleExtractNew = useCallback(() => {
    if (!onExtractNew) return;
    if (isDirty && viewMode === "edit") {
      if (!window.confirm(t("coursewareEditor.designTemplate.discardEditsConfirm"))) {
        return;
      }
    }
    onExtractNew();
  }, [isDirty, onExtractNew, t, viewMode]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/40 p-4"
      {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
      role="dialog"
      aria-modal="true"
      aria-label={t("coursewareEditor.designTemplate.modalTitle")}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) handleClose();
      }}
    >
      <div className="flex h-[min(720px,90vh)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("coursewareEditor.designTemplate.modalTitle")}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("coursewareEditor.designTemplate.modalSubtitle")}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={t("coursewareEditor.common.close")}
            onClick={handleClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("coursewareEditor.designTemplate.searchPlaceholder")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-h-0 overflow-y-auto border-b border-slate-200 p-2 md:border-b-0 md:border-r dark:border-slate-700">
            {!resolvedOrgId ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                {t("coursewareEditor.designTemplate.noOrg")}
              </p>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("coursewareEditor.designTemplate.loading")}
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                {t("coursewareEditor.designTemplate.empty")}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((item) => {
                  const active = selectedId === item.id;
                  return (
                    <li key={item.id}>
                      <div
                        className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                          active
                            ? "bg-violet-500/10 ring-1 ring-violet-400/40"
                            : "hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setSelectedId(item.id)}
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                            <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                              {item.name}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                            {item.contentPreview}
                          </p>
                        </button>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                          aria-label={t("coursewareEditor.designTemplate.delete")}
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item)}
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex min-h-0 flex-col">
            {selectedId ? (
              <div className="flex items-center gap-1 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-[11px] ${
                    viewMode === "preview"
                      ? "bg-violet-500/15 font-medium text-violet-700 dark:text-violet-200"
                      : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                  onClick={() => setViewMode("preview")}
                >
                  {t("coursewareEditor.designTemplate.previewTab")}
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] ${
                    viewMode === "edit"
                      ? "bg-violet-500/15 font-medium text-violet-700 dark:text-violet-200"
                      : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                  onClick={() => setViewMode("edit")}
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                  {t("coursewareEditor.designTemplate.editTab")}
                </button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!selectedId ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  {t("coursewareEditor.designTemplate.selectToPreview")}
                </p>
              ) : previewLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("coursewareEditor.designTemplate.previewLoading")}
                </div>
              ) : viewMode === "edit" ? (
                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("coursewareEditor.designTemplate.nameLabel")}
                    </span>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("coursewareEditor.designTemplate.contentLabel")}
                    </span>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={18}
                      className="min-h-[280px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-800 outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </label>
                </div>
              ) : previewContent ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <MarkdownRenderer content={previewContent} />
                </div>
              ) : (
                <p className="py-8 text-center text-xs text-slate-500">
                  {t("coursewareEditor.designTemplate.previewEmpty")}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          {onExtractNew ? (
            <button
              type="button"
              className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-100 dark:border-violet-400/60 dark:bg-violet-500/20 dark:text-violet-100 dark:hover:border-violet-300 dark:hover:bg-violet-500/30"
              onClick={handleExtractNew}
            >
              {t("coursewareEditor.designTemplate.extractNewAction")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={handleClose}
          >
            {t("coursewareEditor.common.cancel")}
          </button>
          {selectedId && viewMode === "edit" ? (
            <button
              type="button"
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              disabled={!isDirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {t("coursewareEditor.designTemplate.saving")}
                </span>
              ) : (
                t("coursewareEditor.designTemplate.save")
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            disabled={!selectedId}
            onClick={() => {
              const item = items.find((row) => row.id === selectedId);
              if (!item) return;
              onPick(toReferencedDesignTemplateItem({ id: item.id, name: item.name }));
              onClose();
            }}
          >
            {t("coursewareEditor.designTemplate.useTemplate")}
          </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
