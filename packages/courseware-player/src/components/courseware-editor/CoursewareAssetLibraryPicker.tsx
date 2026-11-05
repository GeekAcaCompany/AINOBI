// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Music, Trash2, X } from "lucide-react";
import coursewareApi, { type CoursewareAssetItem } from "../../api/courseware.ts";
import coursewareAssetsApi from "../../api/courseware_assets.ts";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";

const IMAGE_ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "tiff",
]);

export const isCoursewareImageAsset = (asset: CoursewareAssetItem): boolean =>
  IMAGE_ASSET_EXTENSIONS.has(asset.extension);

export const isCoursewareAudioAsset = (asset: CoursewareAssetItem): boolean =>
  ["mp3", "aac", "wav", "ogg", "webm"].includes(asset.extension);

export interface CoursewareAssetLibraryPickerProps {
  coursewareId: string;
  kind: "image" | "audio";
  onClose: () => void;
  onPick: (asset: CoursewareAssetItem) => void;
}

/**
 * Choose images or audio from the course asset library (list + presigned URLs).
 */
export function CoursewareAssetLibraryPicker({
  coursewareId,
  kind,
  onClose,
  onPick,
}: CoursewareAssetLibraryPickerProps) {
  const { t } = useI18nNew();
  const [assets, setAssets] = useState<CoursewareAssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await coursewareAssetsApi.listAssets({
          courseware_id: coursewareId,
          page_number: 1,
          page_size: 100,
        });
        const filtered = response.data.filter((a) =>
          kind === "image" ? isCoursewareImageAsset(a) : isCoursewareAudioAsset(a),
        );
        if (cancelled) return;
        if (filtered.length === 0) {
          setAssets([]);
          return;
        }
        const signed = await coursewareAssetsApi.batchPresignUrls(
          coursewareId,
          filtered.map((a) => a.url),
        );
        if (cancelled) return;
        setAssets(
          filtered.map((a) => ({ ...a, url: signed[a.url] ?? a.url })),
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : t("coursewareEditor.assetPicker.loadFailed"),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coursewareId, kind, t]);

  const handleDelete = async (asset: CoursewareAssetItem): Promise<void> => {
    if (deletingId) return;
    if (!window.confirm(t("coursewareEditor.confirm.deleteAsset", { name: asset.name }))) return;
    setDeletingId(asset.id);
    setError(null);
    try {
      await coursewareAssetsApi.deleteAsset(coursewareId, asset.id);
      setIsLoading(true);
      setError(null);
      try {
        const response = await coursewareAssetsApi.listAssets({
          courseware_id: coursewareId,
          page_number: 1,
          page_size: 100,
        });
        const filtered = response.data.filter((a) =>
          kind === "image" ? isCoursewareImageAsset(a) : isCoursewareAudioAsset(a),
        );
        if (filtered.length === 0) {
          setAssets([]);
        } else {
          const signed = await coursewareAssetsApi.batchPresignUrls(
            coursewareId,
            filtered.map((a) => a.url),
          );
          setAssets(
            filtered.map((a) => ({ ...a, url: signed[a.url] ?? a.url })),
          );
        }
      } finally {
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("coursewareEditor.assetPicker.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const title =
    kind === "image"
      ? t("coursewareEditor.assetPicker.pickImage")
      : t("coursewareEditor.assetPicker.pickAudio");

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/35 dark:bg-slate-900/35 dark:bg-slate-950/80 p-6">
      <div className="flex h-full max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderOpen className="h-4 w-4 text-blue-400" /> {title}
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={t("coursewareEditor.common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 text-center text-xs text-slate-400 dark:text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("coursewareEditor.common.loading")}…
            </div>
          ) : error ? (
            <div className="rounded border border-rose-300/40 dark:border-rose-400/40 bg-rose-500/10 dark:bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : assets.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-400 dark:text-slate-500">
              {kind === "image"
                ? t("coursewareEditor.assetPicker.emptyImages")
                : t("coursewareEditor.assetPicker.emptyAudio")}
            </div>
          ) : (
            <div className="space-y-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800/40 p-2"
                >
                  {kind === "image" ? (
                    <img
                      src={asset.url}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <Music className="h-4 w-4 shrink-0 text-blue-700 dark:text-blue-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-slate-900 dark:text-slate-100">{asset.name}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">{asset.extension.toUpperCase()}</div>
                  </div>
                  <button
                    type="button"
                    title={t("coursewareEditor.common.deleteFromLibrary")}
                    disabled={deletingId === asset.id}
                    onClick={() => void handleDelete(asset)}
                    className="rounded border border-slate-400 dark:border-slate-600 p-1.5 text-slate-400 dark:text-slate-500 hover:border-rose-500/50 hover:bg-rose-500/10 dark:hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300 disabled:cursor-wait disabled:opacity-40"
                    aria-label={`${t("coursewareEditor.common.delete")} ${asset.name}`}
                  >
                    {deletingId === asset.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onPick(asset)}
                    className="rounded border border-blue-400/45 dark:border-blue-500/50 px-2 py-1 text-[11px] text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 dark:hover:bg-blue-500/10"
                  >
                    {t("coursewareEditor.assetPicker.select")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
