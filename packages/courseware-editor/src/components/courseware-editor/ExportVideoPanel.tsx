// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  Clock,
  Download,
  Film,
  Loader2,
  Play,
  RotateCw,
  Square,
  Trash2,
  Video,
  X,
  XCircle,
} from "lucide-react";

import {
  cancelRenderTask,
  createRenderTask,
  deleteRenderTask,
  isRenderTaskActive,
  isRenderTaskDeletable,
  isRenderTaskRetryable,
  listRenderTasks,
  retryRenderTask,
  type RenderTaskDto,
  type RenderTaskStatus,
} from "../../api/courseware_render.ts";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import type { NewTranslationKey } from "@ainobi/courseware-player/hooks/useI18nNew";
import type { EditorThemeMode } from "@ainobi/courseware-player/lib/courseware-editor-theme";
import {
  resolveRenderTaskElapsedLabel,
  resolveRenderTaskErrorLabel,
  resolveRenderTaskProcessLabel,
  resolveRenderTaskVideoDurationLabel,
} from "../../lib/courseware/render-task-display.ts";
import {
  buildDefaultExportVideoTitle,
  downloadExportVideoFile,
  resolveRenderTaskTitle,
  sanitizeExportVideoFilename,
} from "../../lib/courseware/export-video-title.ts";

/** Mirrors `AINOBI_VIDEO_RENDER_TASK_MAX_RETRIES` default in ainobi-video-render-service. */
const RENDER_TASK_MAX_RETRIES_HINT = 3;

type ResolutionPreset = { label: string; width: number; height: number };

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: "1080p", width: 1920, height: 1080 },
  { label: "720p", width: 1280, height: 720 },
  { label: "4K", width: 3840, height: 2160 },
];

const FPS_PRESETS = [30, 60] as const;

const STATUS_STYLES: Record<
  RenderTaskStatus,
  { badge: string; border: string; icon: "clock" | "spin" | "alert" | "cancel" | "none" }
> = {
  queued: {
    badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    border: "border-l-slate-300 dark:border-l-slate-600",
    icon: "clock",
  },
  running: {
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    border: "border-l-blue-500",
    icon: "spin",
  },
  completed: {
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    border: "border-l-emerald-500",
    icon: "none",
  },
  failed: {
    badge: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    border: "border-l-red-500",
    icon: "alert",
  },
  interrupted: {
    badge: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    border: "border-l-amber-500",
    icon: "alert",
  },
  cancelled: {
    badge: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    border: "border-l-slate-400 dark:border-l-slate-600",
    icon: "cancel",
  },
};

const STATUS_LABEL_KEYS: Record<RenderTaskStatus, NewTranslationKey> = {
  queued: "coursewareEditor.exportVideo.statusQueued",
  running: "coursewareEditor.exportVideo.statusRunning",
  completed: "coursewareEditor.exportVideo.statusCompleted",
  failed: "coursewareEditor.exportVideo.statusFailed",
  interrupted: "coursewareEditor.exportVideo.statusInterrupted",
  cancelled: "coursewareEditor.exportVideo.statusCancelled",
};

function formatTaskTimestamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatResolution(task: RenderTaskDto): string {
  const w = task.request.width;
  const h = task.request.height;
  const fps = task.request.fps;
  const parts: string[] = [];
  if (w && h) parts.push(`${w}×${h}`);
  if (fps) parts.push(`${fps}fps`);
  return parts.join(" · ");
}

export type ExportVideoPanelProps = {
  coursewareId: string;
  coursewareName: string;
  themeMode: EditorThemeMode;
  onClose: () => void;
};

export function ExportVideoPanel({
  coursewareId,
  coursewareName,
  themeMode,
  onClose,
}: ExportVideoPanelProps) {
  const { t } = useI18nNew();
  const queryClient = useQueryClient();
  const [resolutionIndex, setResolutionIndex] = useState(0);
  const [fpsIndex, setFpsIndex] = useState(0);
  const [exportTitle, setExportTitle] = useState(() => buildDefaultExportVideoTitle(coursewareName));
  const [isCreating, setIsCreating] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const handlePreviewClose = useCallback((): void => {
    setPreviewVideoUrl(null);
  }, []);

  const queryKey = ["courseware-render-tasks", coursewareId] as const;

  const tasksQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<RenderTaskDto[]> => {
      const result = await listRenderTasks(coursewareId, { limit: 20 });
      if (!result.ok) throw new Error(result.error);
      return result.tasks;
    },
    refetchInterval: (query) => {
      const tasks = query.state.data;
      return tasks?.some(isRenderTaskActive) ? 3000 : false;
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (previewVideoUrl) {
        setPreviewVideoUrl(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, previewVideoUrl]);

  const handleCreate = async (): Promise<void> => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const preset = RESOLUTION_PRESETS[resolutionIndex] ?? RESOLUTION_PRESETS[0]!;
      const fps = FPS_PRESETS[fpsIndex] ?? FPS_PRESETS[0];
      const result = await createRenderTask(coursewareId, {
        width: preset.width,
        height: preset.height,
        fps,
        title: exportTitle.trim() || buildDefaultExportVideoTitle(coursewareName),
      });
      if (!result.ok) {
        toast.error(t("coursewareEditor.exportVideo.createFailed", { error: result.error }));
        return;
      }
      await queryClient.invalidateQueries({ queryKey });
      toast.success(t("coursewareEditor.exportVideo.createSuccess"));
      setExportTitle(buildDefaultExportVideoTitle(coursewareName));
    } finally {
      setIsCreating(false);
    }
  };

  const handleRetry = async (taskId: string): Promise<void> => {
    if (busyTaskId) return;
    setBusyTaskId(taskId);
    try {
      const result = await retryRenderTask(taskId);
      if (!result.ok) {
        toast.error(t("coursewareEditor.exportVideo.retryFailed", { error: result.error }));
        return;
      }
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleCancel = async (taskId: string): Promise<void> => {
    if (busyTaskId) return;
    setBusyTaskId(taskId);
    try {
      const result = await cancelRenderTask(taskId);
      if (!result.ok) {
        toast.error(t("coursewareEditor.exportVideo.cancelFailed", { error: result.error }));
        return;
      }
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDelete = async (taskId: string): Promise<void> => {
    if (busyTaskId) return;
    if (!window.confirm(t("coursewareEditor.exportVideo.deleteConfirm"))) {
      return;
    }
    setBusyTaskId(taskId);
    try {
      const result = await deleteRenderTask(taskId);
      if (!result.ok) {
        toast.error(t("coursewareEditor.exportVideo.deleteFailed", { error: result.error }));
        return;
      }
      toast.success(t("coursewareEditor.exportVideo.deleteSuccess"));
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setBusyTaskId(null);
    }
  };

  const tasks = tasksQuery.data ?? [];
  const activeCount = tasks.filter(isRenderTaskActive).length;
  const selectedPreset = RESOLUTION_PRESETS[resolutionIndex] ?? RESOLUTION_PRESETS[0]!;
  const selectedFps = FPS_PRESETS[fpsIndex] ?? FPS_PRESETS[0];

  return createPortal(
    <div
      data-courseware-editor-theme={themeMode}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px] dark:bg-slate-950/70 sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-[min(96vw,880px)] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-5 py-4 dark:border-slate-800 dark:from-slate-900 dark:to-slate-900/80">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                <Video className="h-4 w-4" />
              </span>
              {t("coursewareEditor.exportVideo.panelTitle")}
            </div>
            <p className="mt-1 pl-10 text-xs text-slate-500 dark:text-slate-400">
              {t("coursewareEditor.exportVideo.panelSubtitle")}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={t("coursewareEditor.common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t("coursewareEditor.exportVideo.taskListTitle")}
              </h3>
              {activeCount > 0 ? (
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                  {t("coursewareEditor.exportVideo.activeCount", { count: activeCount })}
                </span>
              ) : null}
            </div>

            {tasksQuery.isLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">{t("coursewareEditor.exportVideo.loadingTasks")}</span>
              </div>
            ) : tasksQuery.isError ? (
              <p className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {t("coursewareEditor.exportVideo.loadFailed", {
                  error:
                    tasksQuery.error instanceof Error
                      ? tasksQuery.error.message
                      : String(tasksQuery.error),
                })}
              </p>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
                <Film className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="text-xs text-slate-400">{t("coursewareEditor.exportVideo.emptyList")}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {tasks.map((task) => (
                  <RenderTaskRow
                    key={task.id}
                    task={task}
                    busy={busyTaskId === task.id}
                    onRetry={() => void handleRetry(task.id)}
                    onCancel={() => void handleCancel(task.id)}
                    onDelete={() => void handleDelete(task.id)}
                    onPlay={(url) => setPreviewVideoUrl(url)}
                    t={t}
                  />
                ))}
              </ul>
            )}
          </div>

          <aside className="flex w-full shrink-0 flex-col border-t border-slate-200/80 px-5 py-4 sm:w-[280px] sm:border-l sm:border-t-0 dark:border-slate-800">
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("coursewareEditor.exportVideo.titleLabel")}
            </label>
            <input
              type="text"
              value={exportTitle}
              onChange={(event) => setExportTitle(event.target.value)}
              disabled={isCreating}
              maxLength={200}
              placeholder={t("coursewareEditor.exportVideo.titlePlaceholder")}
              className="mb-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-500"
            />
            <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("coursewareEditor.exportVideo.resolutionLabel")}
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {RESOLUTION_PRESETS.map((preset, index) => {
                const selected = index === resolutionIndex;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={isCreating}
                    onClick={() => setResolutionIndex(index)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      selected
                        ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    {preset.label}
                    <span className={`ml-1 ${selected ? "text-blue-100" : "text-slate-400"}`}>
                      {preset.width}×{preset.height}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("coursewareEditor.exportVideo.fpsLabel")}
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              {FPS_PRESETS.map((fps, index) => {
                const selected = index === fpsIndex;
                return (
                  <button
                    key={fps}
                    type="button"
                    disabled={isCreating}
                    onClick={() => setFpsIndex(index)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      selected
                        ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    {fps} fps
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
              onClick={() => void handleCreate()}
              disabled={isCreating}
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Film className="h-4 w-4" />
              )}
              {isCreating
                ? t("coursewareEditor.exportVideo.creating")
                : t("coursewareEditor.exportVideo.createButton")}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              {t("coursewareEditor.exportVideo.exportHint", {
                resolution: `${selectedPreset.width}×${selectedPreset.height}`,
                fps: selectedFps,
              })}
            </p>
          </aside>
        </div>
      </div>

      {previewVideoUrl ? (
        <ExportVideoPreviewModal
          videoUrl={previewVideoUrl}
          onClose={handlePreviewClose}
          t={t}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function StatusIcon({ kind }: { kind: (typeof STATUS_STYLES)[RenderTaskStatus]["icon"] }) {
  if (kind === "spin") return <Loader2 className="h-3 w-3 animate-spin" />;
  if (kind === "clock") return <Clock className="h-3 w-3" />;
  if (kind === "alert") return <CircleAlert className="h-3 w-3" />;
  if (kind === "cancel") return <XCircle className="h-3 w-3" />;
  return null;
}

function TaskThumbnail({
  task,
  videoUrl,
  onPlay,
  playLabel,
}: {
  task: RenderTaskDto;
  videoUrl: string | null;
  onPlay?: (url: string) => void;
  playLabel: string;
}) {
  const coverUrl = task.result?.cover?.url ?? null;
  const canPlay = task.status === "completed" && Boolean(videoUrl);
  const progress =
    task.status === "queued" ? 0 : Math.min(100, Math.max(0, task.progress));

  let inner: ReactNode;

  if (task.status === "completed" && coverUrl) {
    inner = (
      <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
    );
  } else if (task.status === "completed") {
    inner = <Film className="h-5 w-5 text-slate-400 dark:text-slate-500" />;
  } else {
    inner = (
      <>
        <div
          className="absolute inset-x-0 bottom-0 bg-blue-500/40 transition-[height] duration-500 ease-out"
          style={{ height: `${progress}%` }}
          aria-hidden
        />
        <span className="relative text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-200">
          {progress}%
        </span>
      </>
    );
  }

  const frameClass =
    "relative flex h-[4.5rem] w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/60 bg-slate-200 dark:border-slate-700 dark:bg-slate-800";

  if (canPlay && videoUrl) {
    return (
      <button
        type="button"
        className={`group ${frameClass} cursor-pointer p-0 transition hover:border-slate-300 dark:hover:border-slate-600`}
        onClick={() => onPlay?.(videoUrl)}
        aria-label={playLabel}
      >
        {inner}
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition group-hover:bg-black/35">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-md ring-1 ring-black/10 transition group-hover:scale-105">
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </span>
        </span>
      </button>
    );
  }

  if (task.status === "completed") {
    return <div className={frameClass}>{inner}</div>;
  }

  return <div className={frameClass}>{inner}</div>;
}

function ExportVideoPreviewModal({
  videoUrl,
  onClose,
  t,
}: {
  videoUrl: string;
  onClose: () => void;
  t: (key: NewTranslationKey) => string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const releaseVideo = (): void => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  const handleClose = (): void => {
    releaseVideo();
    onCloseRef.current();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
        return;
      }
      // Keep Space (and other editor hotkeys) from reaching the courseware editor
      // while this overlay is open; do not preventDefault so <video controls> can use Space.
      if (event.code === "Space" || event.key === " ") {
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      releaseVideo();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm lg:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-medium text-slate-100">
            {t("coursewareEditor.exportVideo.previewTitle")}
          </span>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={handleClose}
            aria-label={t("coursewareEditor.common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="bg-black p-1">
          <video
            ref={videoRef}
            key={videoUrl}
            src={videoUrl}
            controls
            autoPlay
            playsInline
            className="max-h-[min(70vh,540px)] w-full rounded-lg bg-black lg:max-h-[min(80vh,720px)] xl:max-h-[min(85vh,900px)]"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RenderTaskRow({
  task,
  busy,
  onRetry,
  onCancel,
  onDelete,
  onPlay,
  t,
}: {
  task: RenderTaskDto;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onPlay: (url: string) => void;
  t: (key: NewTranslationKey, variables?: Record<string, string | number>) => string;
}) {
  const canRetry = isRenderTaskRetryable(task, RENDER_TASK_MAX_RETRIES_HINT);
  const canCancelQueued = task.status === "queued";
  const canStopRunning = task.status === "running";
  const canDelete = isRenderTaskDeletable(task);
  const downloadUrl = task.result?.oss?.url ?? null;
  const styles = STATUS_STYLES[task.status];
  const errorLabel = resolveRenderTaskErrorLabel(task.errorMessage, t);
  const resolution = formatResolution(task);
  const taskTitle = resolveRenderTaskTitle(task);
  const downloadFilename = `${sanitizeExportVideoFilename(taskTitle || formatResolution(task) || "export")}.mp4`;
  const [isDownloading, setIsDownloading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (task.status !== "queued" && task.status !== "running") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task.status]);

  const elapsedLabel = resolveRenderTaskElapsedLabel(task, t, nowMs);
  const videoDurationLabel = resolveRenderTaskVideoDurationLabel(task, t);

  const handleDownload = async (): Promise<void> => {
    if (!downloadUrl || isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadExportVideoFile(downloadUrl, downloadFilename);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("coursewareEditor.toast.downloadFailed"),
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const processLabel = resolveRenderTaskProcessLabel(task, t);

  const hasActions =
    (task.status === "completed" && downloadUrl) ||
    canRetry ||
    canCancelQueued ||
    canStopRunning ||
    canDelete;

  return (
    <li
      className={`flex gap-3 rounded-xl border border-slate-200/80 border-l-[3px] bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/50 ${styles.border}`}
    >
      <TaskThumbnail
        task={task}
        videoUrl={downloadUrl}
        onPlay={onPlay}
        playLabel={t("coursewareEditor.exportVideo.playVideo")}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <p
            className="min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100"
            title={taskTitle || undefined}
          >
            {taskTitle || "\u00a0"}
          </p>
          <time
            dateTime={task.createdAt}
            className="shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-400"
          >
            {formatTaskTimestamp(task.createdAt)}
          </time>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${styles.badge}`}
          >
            <StatusIcon kind={styles.icon} />
            {t(STATUS_LABEL_KEYS[task.status])}
          </span>
          {resolution ? (
            <span className="text-[11px] text-slate-400">{resolution}</span>
          ) : null}
          {elapsedLabel ? (
            <span className="text-[11px] tabular-nums text-slate-400">{elapsedLabel}</span>
          ) : null}
          {videoDurationLabel ? (
            <span className="text-[11px] tabular-nums text-slate-400">{videoDurationLabel}</span>
          ) : null}
        </div>

        {hasActions || processLabel ? (
          <div className="mt-auto flex items-center gap-2 pt-0.5">
            {processLabel ? (
              <p className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {processLabel}
              </p>
            ) : (
              <span className="flex-1" aria-hidden />
            )}
            {hasActions ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {task.status === "completed" && downloadUrl ? (
              <button
                type="button"
                disabled={isDownloading}
                onClick={() => void handleDownload()}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-emerald-600 disabled:opacity-60"
              >
                {isDownloading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {t("coursewareEditor.exportVideo.download")}
              </button>
            ) : null}
            {canRetry ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCw className="h-3 w-3" />
                )}
                {t("coursewareEditor.exportVideo.retry")}
              </button>
            ) : null}
            {canCancelQueued ? (
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                {t("coursewareEditor.exportVideo.cancelQueued")}
              </button>
            ) : null}
            {canStopRunning ? (
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Square className="h-3 w-3 fill-current" />
                )}
                {busy
                  ? t("coursewareEditor.exportVideo.stopping")
                  : t("coursewareEditor.exportVideo.stopRunning")}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-400"
                aria-label={t("coursewareEditor.exportVideo.deleteRecord")}
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </button>
            ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {errorLabel &&
        (task.status === "failed" ||
          task.status === "interrupted" ||
          task.status === "cancelled") ? (
          <p
            className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
            title={task.errorMessage ?? undefined}
          >
            {errorLabel}
          </p>
        ) : null}
      </div>
    </li>
  );
}
