// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  deleteContentTemplate,
  getContentTemplate,
  listContentTemplates,
  updateContentTemplate,
  type ContentTemplateListItem,
} from "../../api/courseware_content_templates.ts";
import MarkdownRenderer from "../MarkdownRenderer.tsx";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "../../lib/courseware-editor-theme.ts";
import {
  toReferencedContentTemplateItem,
  type ReferencedContentTemplateItem,
} from "../../lib/courseware/ai-content-template-mentions.ts";
import { removeContentTemplateMentionRecent } from "../../lib/courseware/ai-mention-recents.ts";

export type ContentTemplatePickerModalProps = {
  open: boolean;
  themeMode: EditorThemeMode;
  orgId?: string | null;
  onClose: () => void;
  onPick: (item: ReferencedContentTemplateItem) => void;
  /** Open the "extract as content template" dialog */
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
  items: readonly ContentTemplateListItem[],
  query: string,
): ContentTemplateListItem[] {
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

export function ContentTemplatePickerModal({
  open,
  themeMode,
  orgId,
  onClose,
  onPick,
  onExtractNew,
  listRefreshKey = 0,
  focusTemplateId = null,
  onDeleted,
}: ContentTemplatePickerModalProps) {
  const { t } = useI18nNew();
  const resolvedOrgId = orgId?.trim() || null;
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ContentTemplateListItem[]>([]);
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
      const result = await listContentTemplates({ orgId: resolvedOrgId, pageSize: 100 });
      setItems(result.items);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("coursewareEditor.contentTemplate.loadFailed"),
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
        const detail = await getContentTemplate({ orgId: resolvedOrgId, id: selectedId });
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
          toast.error(t("coursewareEditor.contentTemplate.previewFailed"));
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
    async (item: ContentTemplateListItem) => {
      if (!resolvedOrgId) return;
      if (item.isBuiltIn && !item.isOrgOverride) {
        toast.error(t("coursewareEditor.contentTemplate.builtinCannotDelete"));
        return;
      }
      const confirmKey = item.isBuiltIn
        ? "coursewareEditor.contentTemplate.resetBuiltinConfirm"
        : "coursewareEditor.contentTemplate.deleteConfirm";
      if (!window.confirm(t(confirmKey, { name: item.name }))) {
        return;
      }
      setDeletingId(item.id);
      try {
        const result = await deleteContentTemplate({ orgId: resolvedOrgId, id: item.id });
        if (result.resetBuiltIn || item.isBuiltIn) {
          await loadList();
          if (selectedId === item.id) {
            setViewMode("preview");
            try {
              const detail = await getContentTemplate({
                orgId: resolvedOrgId,
                id: item.id,
              });
              const content = detail?.content ?? "";
              setPreviewContent(content);
              setEditName(detail?.name ?? item.name);
              setEditContent(content);
            } catch {
              /* list already refreshed; preview effect may catch up on next select */
            }
          }
          toast.success(t("coursewareEditor.contentTemplate.resetBuiltinSuccess"));
        } else {
          removeContentTemplateMentionRecent(resolvedOrgId, item.id);
          onDeleted?.();
          setItems((prev) => prev.filter((row) => row.id !== item.id));
          if (selectedId === item.id) {
            setSelectedId(null);
            setPreviewContent("");
            setEditName("");
            setEditContent("");
          }
          toast.success(t("coursewareEditor.contentTemplate.deleted"));
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("coursewareEditor.contentTemplate.deleteFailed"),
        );
      } finally {
        setDeletingId(null);
      }
    },
    [loadList, onDeleted, resolvedOrgId, selectedId, t],
  );

  const handleSave = useCallback(async () => {
    if (!resolvedOrgId || !selectedId) return;
    const trimmedName = editName.trim();
    const trimmedContent = editContent.trim();
    if (!trimmedName) {
      toast.error(t("coursewareEditor.contentTemplate.nameRequired"));
      return;
    }
    if (!trimmedContent) {
      toast.error(t("coursewareEditor.contentTemplate.contentRequired"));
      return;
    }
    setSaving(true);
    try {
      const updated = await updateContentTemplate({
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
                isBuiltIn: updated.isBuiltIn ?? row.isBuiltIn,
                isOrgOverride: updated.isOrgOverride ?? (row.isBuiltIn ? true : row.isOrgOverride),
                description: updated.description ?? row.description,
              }
            : row,
        ),
      );
      setViewMode("preview");
      toast.success(t("coursewareEditor.contentTemplate.saveSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("coursewareEditor.contentTemplate.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }, [editContent, editName, resolvedOrgId, selectedId, t]);

  const handleClose = useCallback(() => {
    if (isDirty && viewMode === "edit") {
      if (!window.confirm(t("coursewareEditor.contentTemplate.discardEditsConfirm"))) {
        return;
      }
    }
    onClose();
  }, [isDirty, onClose, t, viewMode]);

  const handleExtractNew = useCallback(() => {
    if (!onExtractNew) return;
    if (isDirty && viewMode === "edit") {
      if (!window.confirm(t("coursewareEditor.contentTemplate.discardEditsConfirm"))) {
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
      aria-label={t("coursewareEditor.contentTemplate.modalTitle")}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) handleClose();
      }}
    >
      <div className="flex h-[min(720px,90vh)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("coursewareEditor.contentTemplate.modalTitle")}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("coursewareEditor.contentTemplate.modalSubtitle")}
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
              placeholder={t("coursewareEditor.contentTemplate.searchPlaceholder")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-h-0 overflow-y-auto border-b border-slate-200 p-2 md:border-b-0 md:border-r dark:border-slate-700">
            {!resolvedOrgId ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                {t("coursewareEditor.contentTemplate.noOrg")}
              </p>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("coursewareEditor.contentTemplate.loading")}
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                {t("coursewareEditor.contentTemplate.empty")}
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
                            {item.isBuiltIn ? (
                              <span className="shrink-0 rounded bg-slate-200/80 px-1 py-px text-[9px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                {item.isOrgOverride
                                  ? t("coursewareEditor.contentTemplate.builtinOverrideBadge")
                                  : t("coursewareEditor.contentTemplate.builtinBadge")}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                            {item.contentPreview}
                          </p>
                        </button>
                        {item.isBuiltIn && !item.isOrgOverride ? null : (
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                          aria-label={
                            item.isBuiltIn
                              ? t("coursewareEditor.contentTemplate.resetBuiltin")
                              : t("coursewareEditor.contentTemplate.delete")
                          }
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item)}
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                        )}
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
                  {t("coursewareEditor.contentTemplate.previewTab")}
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
                  {t("coursewareEditor.contentTemplate.editTab")}
                </button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!selectedId ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  {t("coursewareEditor.contentTemplate.selectToPreview")}
                </p>
              ) : previewLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("coursewareEditor.contentTemplate.previewLoading")}
                </div>
              ) : viewMode === "edit" ? (
                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("coursewareEditor.contentTemplate.nameLabel")}
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
                      {t("coursewareEditor.contentTemplate.contentLabel")}
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
                  {t("coursewareEditor.contentTemplate.previewEmpty")}
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
              {t("coursewareEditor.contentTemplate.extractNewAction")}
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
                  {t("coursewareEditor.contentTemplate.saving")}
                </span>
              ) : (
                t("coursewareEditor.contentTemplate.save")
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
              onPick(toReferencedContentTemplateItem({ id: item.id, name: item.name }));
              onClose();
            }}
          >
            {t("coursewareEditor.contentTemplate.useTemplate")}
          </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
