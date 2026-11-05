// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  FileText,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { CoursewareAssetItem } from "../../api/courseware.ts";
import { isCoursewareImageAsset } from "./CoursewareAssetLibraryPicker.tsx";
import {
  AssetRowThumbnail,
  isImageExtension,
  useAssetImageHoverPreview,
} from "./AssetListImagePreview.tsx";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "../../lib/courseware-editor-theme.ts";
import {
  filterMentionRecents,
  type AiMentionRecentEntry,
} from "../../lib/courseware/ai-mention-recents.ts";

type ResourceFilter = "all" | "images" | "docs";

/** Maximum number of "recently used" items shown in the bubble */
const BUBBLE_RECENT_DISPLAY_LIMIT = 3;

/** Uniform color of the decorative icons in the bubble (readable in light and dark) */
const BUBBLE_ICON_COLOR = "text-[#89BFFA]";
const BUBBLE_ICON_MD = `h-4 w-4 shrink-0 ${BUBBLE_ICON_COLOR}`;
const BUBBLE_ICON_SM = `h-3.5 w-3.5 shrink-0 ${BUBBLE_ICON_COLOR}`;
const BUBBLE_ACTION_BTN =
  "flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-3 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
const BUBBLE_ADD_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#89BFFA] text-slate-900 transition hover:bg-[#6aade8]";
const BUBBLE_ROW_ICON_WRAP =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800";

function isDocRecent(entry: AiMentionRecentEntry): boolean {
  if (entry.kind === "courseware") return true;
  const ext = (entry.extension ?? "").toLowerCase();
  return ["pdf", "pptx", "docx", "md", "txt", "html"].includes(ext);
}

export function AiPanelResourceBubble({
  open,
  themeMode,
  position,
  searchQuery,
  onSearchQueryChange,
  recentEntries,
  libraryCandidates,
  libraryAssets = [],
  isUploading = false,
  onClose,
  onPickExistingResources,
  onSelectFile,
  onPickCourseware,
  onPickRecent,
  onPickLibraryAsset,
}: {
  open: boolean;
  themeMode: EditorThemeMode;
  position: { top: number; left: number };
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  recentEntries: readonly AiMentionRecentEntry[];
  libraryCandidates: readonly CoursewareAssetItem[];
  /** Used to resolve image urls of recently used items */
  libraryAssets?: readonly CoursewareAssetItem[];
  isUploading?: boolean;
  onClose: () => void;
  onPickExistingResources: () => void;
  onSelectFile: () => void;
  onPickCourseware: () => void;
  onPickRecent: (entry: AiMentionRecentEntry) => void;
  onPickLibraryAsset: (asset: CoursewareAssetItem) => void;
}) {
  const { t } = useI18nNew();
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const { preview: imageHoverPreview, bindRow: bindImageHover, clearPreview } =
    useAssetImageHoverPreview(themeMode);

  const assetUrlById = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of libraryAssets) {
      if (asset.id && asset.url) map.set(asset.id, asset.url);
    }
    for (const asset of libraryCandidates) {
      if (asset.id && asset.url) map.set(asset.id, asset.url);
    }
    return map;
  }, [libraryAssets, libraryCandidates]);

  useEffect(() => {
    if (!open) {
      setFilter("all");
      clearPreview();
    }
  }, [clearPreview, open]);

  const filteredRecent = useMemo(() => {
    let list = filterMentionRecents(recentEntries, "");
    if (filter === "images") {
      list = list.filter(
        (row) =>
          row.kind === "asset" &&
          ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(
            (row.extension ?? "").toLowerCase(),
          ),
      );
    } else if (filter === "docs") {
      list = list.filter(isDocRecent);
    }
    return list.slice(0, BUBBLE_RECENT_DISPLAY_LIMIT);
  }, [filter, recentEntries]);

  const isSearching = searchQuery.trim().length > 0;
  const searchResultAssets = useMemo(() => {
    if (!isSearching) return [];
    return libraryCandidates.slice(0, 40);
  }, [isSearching, libraryCandidates]);

  const searchResultRecents = useMemo(() => {
    if (!isSearching) return [];
    const assetIds = new Set(searchResultAssets.map((a) => a.id));
    return filterMentionRecents(recentEntries, searchQuery)
      .filter((row) => !(row.kind === "asset" && assetIds.has(row.id)))
      .slice(0, 20);
  }, [isSearching, recentEntries, searchQuery, searchResultAssets]);


  const renderRecentRow = (entry: AiMentionRecentEntry, keyPrefix: string) => {
    const isImage =
      entry.kind === "asset" && isImageExtension(entry.extension);
    const url = entry.kind === "asset" ? assetUrlById.get(entry.id) : undefined;
    const hover = bindImageHover({
      id: `${keyPrefix}:${entry.id}`,
      name: entry.name,
      url,
      isImage,
    });
    return (
      <div
        key={`${keyPrefix}:${entry.kind}:${entry.id}`}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        {...hover}
      >
        {entry.kind === "courseware" ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <BookOpen className={BUBBLE_ICON_SM} aria-hidden />
          </div>
        ) : (
          <AssetRowThumbnail url={url} isImage={isImage} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
            {entry.name}
          </div>
          <div className="truncate text-[10px] uppercase text-slate-400 dark:text-slate-500">
            {entry.kind === "courseware" ? "courseware" : entry.extension ?? "file"}
          </div>
        </div>
        <button
          type="button"
          className={BUBBLE_ADD_BTN}
          aria-label={t("coursewareEditor.aiPanel.resourceBubble.addRecent")}
          onMouseDown={(e) => {
            e.preventDefault();
            onPickRecent(entry);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  };

  const renderAssetRow = (asset: CoursewareAssetItem, keyPrefix: string) => {
    const isImage = isCoursewareImageAsset(asset);
    const hover = bindImageHover({
      id: `${keyPrefix}:${asset.id}`,
      name: asset.name,
      url: asset.url,
      isImage,
    });
    return (
      <div
        key={`${keyPrefix}:${asset.id}`}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        {...hover}
      >
        <AssetRowThumbnail url={asset.url} isImage={isImage} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
            {asset.name}
          </div>
          <div className="truncate text-[10px] uppercase text-slate-400 dark:text-slate-500">
            {asset.extension}
          </div>
        </div>
        <button
          type="button"
          className={BUBBLE_ADD_BTN}
          aria-label={t("coursewareEditor.aiPanel.resourceBubble.addRecent")}
          onMouseDown={(e) => {
            e.preventDefault();
            onPickLibraryAsset(asset);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
      className="fixed z-9999 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      style={{
        top: Math.max(8, position.top - 8),
        left: Math.max(8, Math.min(position.left, window.innerWidth - 376)),
        transform: "translateY(-100%)",
      }}
      role="dialog"
      aria-label={t("coursewareEditor.aiPanel.resourceBubble.title")}
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t("coursewareEditor.aiPanel.resourceBubble.title")}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t("coursewareEditor.aiPanel.resourceBubble.subtitle")}
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          onMouseDown={(e) => {
            e.preventDefault();
            onClose();
          }}
          aria-label={t("coursewareEditor.common.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800/60">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t("coursewareEditor.aiPanel.resourceBubble.searchPlaceholder")}
            className="min-w-0 flex-1 border-0 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      {!isSearching ? (
        <>
          <div className="space-y-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <span>{t("coursewareEditor.aiPanel.resourceBubble.addSection")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={BUBBLE_ACTION_BTN}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPickExistingResources();
                }}
              >
                <FolderOpen className={BUBBLE_ICON_MD} aria-hidden />
                {t("coursewareEditor.aiPanel.resourceBubble.existingResources")}
              </button>
              <button
                type="button"
                className={`${BUBBLE_ACTION_BTN} disabled:cursor-not-allowed disabled:opacity-60`}
                disabled={isUploading}
                aria-busy={isUploading}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (isUploading) return;
                  onSelectFile();
                }}
              >
                {isUploading ? (
                  <Loader2 className={`${BUBBLE_ICON_MD} animate-spin`} aria-hidden />
                ) : (
                  <Upload className={BUBBLE_ICON_MD} aria-hidden />
                )}
                {isUploading
                  ? t("coursewareEditor.aiPanel.resourceBubble.uploading")
                  : t("coursewareEditor.aiPanel.resourceBubble.uploadFile")}
              </button>
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              onMouseDown={(e) => {
                e.preventDefault();
                onPickCourseware();
              }}
            >
              <BookOpen className={BUBBLE_ICON_SM} aria-hidden />
              {t("coursewareEditor.aiPanel.resourceBubble.pickCourseware")}
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto px-2 py-2">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t("coursewareEditor.aiPanel.resourceBubble.recentTitle")}
              </div>
            </div>
            <div className="mb-2 flex flex-wrap gap-1 px-1">
              {(
                [
                  ["all", "filterAll"],
                  ["images", "filterImages"],
                  ["docs", "filterDocs"],
                ] as const
              ).map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                    filter === id
                      ? "bg-[#89BFFA] text-slate-900"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFilter(id);
                  }}
                >
                  {t(`coursewareEditor.aiPanel.resourceBubble.${key}`)}
                </button>
              ))}
            </div>

            {filteredRecent.length === 0 ? (
              <div className="px-2 py-6 text-center text-[11px] text-slate-400 dark:text-slate-500">
                {t("coursewareEditor.aiPanel.resourceBubble.emptyRecent")}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredRecent.map((entry) => renderRecentRow(entry, "recent"))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="max-h-64 overflow-y-auto px-2 py-2">
          {searchResultAssets.length === 0 && searchResultRecents.length === 0 ? (
            <div className="px-2 py-6 text-center text-[11px] text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.aiPanel.mention.noMatch")}
            </div>
          ) : (
            <div className="space-y-0.5">
              {searchResultRecents.map((entry) => renderRecentRow(entry, "search-recent"))}
              {searchResultAssets.map((asset) => renderAssetRow(asset, "search-lib"))}
            </div>
          )}
        </div>
      )}
      {imageHoverPreview}
    </div>,
    document.body,
  );
}

export function AiPanelTemplateLibraryBubble({
  open,
  themeMode,
  anchorRect,
  recentEntries,
  onClose,
  onOpenDesignLibrary,
  onOpenContentLibrary,
  onPickRecent,
}: {
  open: boolean;
  themeMode: EditorThemeMode;
  anchorRect: DOMRect | null;
  recentEntries: readonly AiMentionRecentEntry[];
  onClose: () => void;
  onOpenDesignLibrary: () => void;
  onOpenContentLibrary: () => void;
  onPickRecent: (entry: AiMentionRecentEntry) => void;
}) {
  const { t } = useI18nNew();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = useMemo(
    () => filterMentionRecents(recentEntries, search).slice(0, BUBBLE_RECENT_DISPLAY_LIMIT),
    [recentEntries, search],
  );

  if (!open || !anchorRect || typeof document === "undefined") return null;

  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 376));
  const top = Math.max(8, anchorRect.top - 8);

  return createPortal(
    <div
      {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
      className="fixed z-9999 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      style={{ top, left, transform: "translateY(-100%)" }}
      role="dialog"
      aria-label={t("coursewareEditor.aiPanel.templateBubble.title")}
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t("coursewareEditor.aiPanel.templateBubble.title")}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t("coursewareEditor.aiPanel.templateBubble.subtitle")}
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          onClick={onClose}
          aria-label={t("coursewareEditor.common.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800/60">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("coursewareEditor.aiPanel.templateBubble.searchPlaceholder")}
            className="min-w-0 flex-1 border-0 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <button
          type="button"
          className={BUBBLE_ACTION_BTN}
          onClick={() => {
            onOpenDesignLibrary();
            onClose();
          }}
        >
          <LayoutTemplate className={BUBBLE_ICON_MD} aria-hidden />
          {t("coursewareEditor.aiPanel.templateBubble.design")}
        </button>
        <button
          type="button"
          className={BUBBLE_ACTION_BTN}
          onClick={() => {
            onOpenContentLibrary();
            onClose();
          }}
        >
          <FileText className={BUBBLE_ICON_MD} aria-hidden />
          {t("coursewareEditor.aiPanel.templateBubble.content")}
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto px-2 py-2">
        <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {t("coursewareEditor.aiPanel.templateBubble.recentTitle")}
        </div>
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-slate-400 dark:text-slate-500">
            {t("coursewareEditor.aiPanel.templateBubble.emptyRecent")}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((entry) => (
              <div
                key={`${entry.kind}:${entry.id}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <div className={BUBBLE_ROW_ICON_WRAP}>
                  {entry.kind === "content_template" ? (
                    <FileText className={BUBBLE_ICON_SM} aria-hidden />
                  ) : (
                    <LayoutTemplate className={BUBBLE_ICON_SM} aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                    {entry.name}
                  </div>
                  <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                    {entry.kind === "content_template"
                      ? t("coursewareEditor.aiPanel.templateBubble.content")
                      : t("coursewareEditor.aiPanel.templateBubble.design")}
                  </div>
                </div>
                <button
                  type="button"
                  className={BUBBLE_ADD_BTN}
                  onClick={() => onPickRecent(entry)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
