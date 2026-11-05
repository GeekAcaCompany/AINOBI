// SPDX-License-Identifier: AGPL-3.0-only
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FolderOpen,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import coursewareApi, {
  type CoursewareAssetItem,
} from "@ainobi/courseware-player/api/courseware";
import coursewareAssetsApi from "@ainobi/courseware-player/api/courseware_assets";
import type { AudioElement } from "@ainobi/courseware-player/lib/courseware/index";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";

interface MusicSettingsModalProps {
  coursewareId: string;
  initialTracks: AudioElement[];
  /**
   * Total scene duration in milliseconds (sum of all slide durations).
   * Used to lay out the entry/exit timeline. Always >= 1.
   */
  sceneTotalDurationMs: number;
  onClose: () => void;
  onConfirm: (tracks: AudioElement[]) => void;
}

const DEFAULT_FADE_MS = 300;
const MIN_AUDIO_RANGE_MS = 100;

const genId = (prefix: string): string => {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const formatTimeMs = (ms: number): string => {
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const formatTimeMsPrecise = (ms: number): string => {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const hundredths = Math.floor((clamped % 1000) / 10);
  return `${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}.${hundredths.toString().padStart(2, "0")}`;
};

const cloneTrack = (track: AudioElement): AudioElement => ({
  ...track,
  position: { ...track.position },
  size: { ...track.size },
  timeline: { ...track.timeline },
  style: { ...track.style },
  animations: track.animations.map((a) => ({ ...a })),
  keyframes: track.keyframes.map((kf) => ({
    ...kf,
    position: { ...kf.position },
    size: { ...kf.size },
  })),
  event_bindings: track.event_bindings.map((b) => ({ ...b, metadata: { ...b.metadata } })),
  action_mappings: { ...track.action_mappings },
  event_scripts: { ...track.event_scripts },
  metadata: { ...track.metadata },
});

const buildDefaultTrack = (
  totalDurationMs: number,
  name: string,
): AudioElement => ({
  element_type: "audio",
  element_id: genId("el_audio"),
  name,
  html: "",
  fps: 30,
  position: { x: 0, y: 0 },
  size: { width: 0, height: 0 },
  timeline: {
    start_at: 0,
    end_at: Math.max(MIN_AUDIO_RANGE_MS, totalDurationMs),
  },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  enter_effect: "none",
  exit_effect: "none",
  animations: [],
  keyframes: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
  metadata: {},
  source: "",
  loop: false,
  volume: 1,
  fade_in_ms: DEFAULT_FADE_MS,
  fade_out_ms: DEFAULT_FADE_MS,
  source_start_at: 0,
  source_end_at: null,
});

const isAudioAsset = (asset: CoursewareAssetItem): boolean =>
  ["mp3", "aac", "wav", "ogg", "webm"].includes(asset.extension);

export function MusicSettingsModal({
  coursewareId,
  initialTracks,
  sceneTotalDurationMs,
  onClose,
  onConfirm,
}: MusicSettingsModalProps) {
  const { t } = useI18nNew();
  const globalTrackPrefix = t("coursewareEditor.musicSettings.globalTrackPrefix");
  const totalDuration = Math.max(MIN_AUDIO_RANGE_MS, sceneTotalDurationMs);
  const [tracks, setTracks] = useState<AudioElement[]>(() =>
    initialTracks.length > 0
      ? initialTracks.map(cloneTrack)
      : [
          buildDefaultTrack(
            totalDuration,
            t("coursewareEditor.musicSettings.globalTrackName", { index: 1 }),
          ),
        ],
  );
  const [activeTrackId, setActiveTrackId] = useState<string>(
    () => (initialTracks[0]?.element_id ?? tracks[0]?.element_id ?? ""),
  );
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  const activeTrack = useMemo(
    () => tracks.find((t) => t.element_id === activeTrackId) ?? tracks[0] ?? null,
    [tracks, activeTrackId],
  );

  useEffect(() => {
    if (!activeTrack && tracks[0]) {
      setActiveTrackId(tracks[0].element_id);
    }
  }, [activeTrack, tracks]);

  const updateTrack = useCallback(
    (id: string, updater: (prev: AudioElement) => AudioElement): void => {
      setTracks((prev) => prev.map((t) => (t.element_id === id ? updater(t) : t)));
    },
    [],
  );

  const addTrack = useCallback((): void => {
    setTracks((prev) => {
      const next = buildDefaultTrack(
        totalDuration,
        t("coursewareEditor.musicSettings.globalTrackName", { index: prev.length + 1 }),
      );
      setActiveTrackId(next.element_id);
      return [...prev, next];
    });
  }, [totalDuration, t]);

  const removeTrack = useCallback((id: string): void => {
    setTracks((prev) => {
      const next = prev.filter((t) => t.element_id !== id);
      if (next.length > 0 && !next.find((t) => t.element_id === activeTrackId)) {
        setActiveTrackId(next[0].element_id);
      } else if (next.length === 0) {
        setActiveTrackId("");
      }
      return next;
    });
  }, [activeTrackId]);

  const handleSubmit = useCallback((): void => {
    const sanitized = tracks
      .filter((t) => t.source.trim().length > 0)
      .map((t) => ({
        ...t,
        timeline: {
          start_at: Math.max(0, Math.min(t.timeline.start_at, totalDuration)),
          end_at: Math.max(
            Math.min(t.timeline.start_at, totalDuration) + MIN_AUDIO_RANGE_MS,
            Math.min(t.timeline.end_at, totalDuration),
          ),
        },
        fade_in_ms: Math.max(0, t.fade_in_ms),
        fade_out_ms: Math.max(0, t.fade_out_ms),
        source_start_at: Math.max(0, t.source_start_at),
        source_end_at:
          typeof t.source_end_at === "number" ? Math.max(t.source_start_at, t.source_end_at) : null,
        volume: clamp(t.volume, 0, 1),
      }));
    onConfirm(sanitized);
  }, [tracks, onConfirm, totalDuration]);

  const handleClearAll = useCallback((): void => {
    onConfirm([]);
  }, [onConfirm]);

  // Imperative handle exposed by the active track's preview timeline so the
  // modal-scoped Space shortcut can drive playback even when focus is not on
  // the play button.
  const previewControllerRef = useRef<{ togglePlay: () => void } | null>(null);

  const isEditableInputTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  };

  // The editor host attaches keyboard shortcuts (Space → play/pause, Ctrl+Z
  // → undo, etc.) at the window level. While this modal is open we must
  // shield those shortcuts: stop propagation for every keydown that reaches
  // the modal root so it never bubbles up to window listeners, and handle
  // the relevant shortcuts (Esc, Space) ourselves.
  const handleModalKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if ((e.code === "Space" || e.key === " ") && !isEditableInputTarget(e.target)) {
      e.preventDefault();
      previewControllerRef.current?.togglePlay();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 dark:bg-slate-900/35 dark:bg-slate-950/80 p-6"
      onKeyDownCapture={handleModalKeyDown}
      onKeyUpCapture={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      tabIndex={-1}
    >
      <div className="flex h-full max-h-[88vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Music className="h-5 w-5 text-blue-400" />
            <div>
              <div className="text-sm font-semibold">{t("coursewareEditor.musicSettings.title")}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500">
                {t("coursewareEditor.musicSettings.subtitle")}
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
            {initialTracks.length > 0 ? (
              <button
                type="button"
                className="rounded border border-rose-300/45 dark:border-rose-500/40 px-2 py-1 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 dark:hover:bg-rose-500/10"
                onClick={handleClearAll}
                title={t("coursewareEditor.musicSettings.clearAllTitle")}
              >
                {t("coursewareEditor.musicSettings.clearAll")}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
              onClick={handleSubmit}
            >
              {t("coursewareEditor.musicSettings.save")}
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
          <TrackListPanel
            tracks={tracks}
            activeTrackId={activeTrack?.element_id ?? null}
            onSelect={(id) => setActiveTrackId(id)}
            onAdd={addTrack}
            onRemove={removeTrack}
            globalTrackPrefix={globalTrackPrefix}
          />

          <div className="min-h-0 overflow-y-auto border-l border-slate-200 dark:border-slate-800 px-6 py-5">
            {activeTrack ? (
              <TrackEditor
                coursewareId={coursewareId}
                key={activeTrack.element_id}
                track={activeTrack}
                totalDuration={totalDuration}
                onChange={(updater) => updateTrack(activeTrack.element_id, updater)}
                onPickFromLibrary={() => setShowAssetPicker(true)}
                previewControllerRef={previewControllerRef}
                globalTrackPrefix={globalTrackPrefix}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                {t("coursewareEditor.musicSettings.pickTrackHint")}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAssetPicker && activeTrack ? (
        <AudioAssetPicker
          coursewareId={coursewareId}
          onClose={() => setShowAssetPicker(false)}
          onPick={(asset) => {
            updateTrack(activeTrack.element_id, (prev) => ({
              ...prev,
              source: asset.url,
              name:
                prev.name && !prev.name.startsWith(globalTrackPrefix)
                  ? prev.name
                  : asset.name.replace(/\.[^.]+$/, "") || prev.name,
            }));
            setShowAssetPicker(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track list panel
// ---------------------------------------------------------------------------

interface TrackListPanelProps {
  tracks: AudioElement[];
  activeTrackId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  globalTrackPrefix: string;
}

function TrackListPanel({
  tracks,
  activeTrackId,
  onSelect,
  onAdd,
  onRemove,
}: TrackListPanelProps) {
  const { t } = useI18nNew();
  return (
    <div className="flex min-h-0 flex-col bg-slate-100/85 dark:bg-slate-950/40">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <span>{t("coursewareEditor.musicSettings.tracksList", { count: tracks.length })}</span>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 dark:hover:bg-blue-500/10"
          onClick={onAdd}
        >
          <Plus className="h-3 w-3" /> {t("coursewareEditor.musicSettings.add")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tracks.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-[11px] text-slate-400 dark:text-slate-500">
            {t("coursewareEditor.musicSettings.empty")}
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded border border-blue-400/45 dark:border-blue-500/50 px-2 py-1 text-[11px] text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 dark:hover:bg-blue-500/10"
              onClick={onAdd}
            >
              <Plus className="h-3 w-3" /> {t("coursewareEditor.musicSettings.addOne")}
            </button>
          </div>
        ) : (
          tracks.map((track) => {
            const active = track.element_id === activeTrackId;
            return (
              <div
                key={track.element_id}
                className={`group mb-1.5 flex items-center gap-2 rounded border px-2 py-1.5 text-xs transition ${
                  active
                    ? "border-blue-500/60 bg-blue-500/10 text-blue-100"
                    : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-slate-600"
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onSelect(track.element_id)}
                >
                  <Music className="h-3.5 w-3.5 shrink-0 text-blue-700 dark:text-blue-300" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">
                      {track.name || t("coursewareEditor.musicSettings.unnamed")}
                    </div>
                    <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                      {track.source
                        ? t("coursewareEditor.musicSettings.sourceSet")
                        : t("coursewareEditor.musicSettings.noSource")}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 dark:text-slate-500 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 dark:hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300"
                  onClick={() => onRemove(track.element_id)}
                  title={t("coursewareEditor.musicSettings.deleteTrack")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track editor
// ---------------------------------------------------------------------------

interface TrackEditorProps {
  coursewareId: string;
  track: AudioElement;
  totalDuration: number;
  onChange: (updater: (prev: AudioElement) => AudioElement) => void;
  onPickFromLibrary: () => void;
  previewControllerRef?: React.MutableRefObject<{ togglePlay: () => void } | null>;
  globalTrackPrefix: string;
}

function TrackEditor({
  coursewareId,
  track,
  totalDuration,
  onChange,
  onPickFromLibrary,
  previewControllerRef,
  globalTrackPrefix,
}: TrackEditorProps) {
  const { t, language } = useI18nNew();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setIsUploading(true);
      setUploadError(null);
      try {
        const { asset } = await coursewareAssetsApi.uploadAsset(coursewareId, file, { language });
        const signed = await coursewareAssetsApi.batchPresignUrls(coursewareId, [asset.url]);
        const url = signed[asset.url] ?? asset.url;
        const fallbackName = asset.name.replace(/\.[^.]+$/, "");
        onChange((prev) => ({
          ...prev,
          source: url,
          name:
            prev.name && !prev.name.startsWith(globalTrackPrefix)
              ? prev.name
              : fallbackName || prev.name,
        }));
      } catch (error) {
        setUploadError(
          error instanceof Error ? error.message : t("coursewareEditor.musicSettings.uploadFailed"),
        );
      } finally {
        setIsUploading(false);
      }
    },
    [coursewareId, globalTrackPrefix, onChange, t],
  );

  return (
    <div className="space-y-5">
      <Field label={t("coursewareEditor.musicSettings.name")}>
        <input
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
          value={track.name}
          onChange={(e) =>
            onChange((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder={t("coursewareEditor.musicSettings.namePlaceholder")}
        />
      </Field>

      <Field label={t("coursewareEditor.musicSettings.source")}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPickFromLibrary}
            className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <FolderOpen className="h-3.5 w-3.5" /> {t("coursewareEditor.musicSettings.pickLibrary")}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className={`h-3.5 w-3.5 ${isUploading ? "animate-pulse" : ""}`} />
            {isUploading
              ? `${t("coursewareEditor.background.uploading")}`
              : t("coursewareEditor.musicSettings.uploadMusic")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.aac,.wav,.ogg,.webm"
            className="hidden"
            onChange={handleUpload}
          />
          {track.source ? (
            <button
              type="button"
              className="ml-auto rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-700 dark:hover:text-rose-300"
              title={t("coursewareEditor.musicSettings.clearSource")}
              onClick={() => onChange((prev) => ({ ...prev, source: "" }))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {uploadError ? (
          <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{uploadError}</div>
        ) : null}
        {track.source ? (
          <div className="mt-1 truncate text-[11px] text-slate-400 dark:text-slate-500" title={track.source}>
            {track.source}
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            {t("coursewareEditor.musicSettings.noSourcePreviewHint")}
          </div>
        )}
      </Field>

      <Field label={t("coursewareEditor.musicSettings.enterExit")}>
        <EntryExitTimeline
          totalDuration={totalDuration}
          startAt={track.timeline.start_at}
          endAt={track.timeline.end_at}
          fadeInMs={track.fade_in_ms}
          fadeOutMs={track.fade_out_ms}
          sourceStartAt={track.source_start_at}
          sourceEndAt={track.source_end_at}
          source={track.source}
          volume={track.volume}
          loop={track.loop}
          previewControllerRef={previewControllerRef}
          onChange={(start_at, end_at) =>
            onChange((prev) => ({
              ...prev,
              timeline: { start_at, end_at },
            }))
          }
          onSourceCropChange={(source_start_at, source_end_at) =>
            onChange((prev) => ({ ...prev, source_start_at, source_end_at }))
          }
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t("coursewareEditor.musicSettings.fadeIn")}>
          <input
            type="number"
            min={0}
            step={50}
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            value={track.fade_in_ms}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                fade_in_ms: Math.max(0, Number(e.target.value) || 0),
              }))
            }
          />
        </Field>
        <Field label={t("coursewareEditor.musicSettings.fadeOut")}>
          <input
            type="number"
            min={0}
            step={50}
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            value={track.fade_out_ms}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                fade_out_ms: Math.max(0, Number(e.target.value) || 0),
              }))
            }
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label={t("coursewareEditor.musicSettings.volume", {
            percent: (track.volume * 100).toFixed(0),
          })}
        >
          <div className="flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              className="flex-1 accent-blue-500"
              value={track.volume}
              onChange={(e) =>
                onChange((prev) => ({
                  ...prev,
                  volume: clamp(Number(e.target.value) || 0, 0, 1),
                }))
              }
            />
          </div>
        </Field>
        <Field label={t("coursewareEditor.musicSettings.loop")}>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={track.loop}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, loop: e.target.checked }))
              }
              className="h-3.5 w-3.5 accent-blue-500"
            />
            <Repeat className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
            {t("coursewareEditor.musicSettings.loopDesc")}
          </label>
        </Field>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">{label}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry / exit timeline (dual handles, like the editor timeline)
// ---------------------------------------------------------------------------

interface EntryExitTimelineProps {
  totalDuration: number;
  startAt: number;
  endAt: number;
  fadeInMs: number;
  fadeOutMs: number;
  sourceStartAt: number;
  sourceEndAt: number | null;
  source: string;
  volume: number;
  loop: boolean;
  previewControllerRef?: React.MutableRefObject<{ togglePlay: () => void } | null>;
  onChange: (startAt: number, endAt: number) => void;
  onSourceCropChange: (sourceStartAt: number, sourceEndAt: number | null) => void;
}

function EntryExitTimeline({
  totalDuration,
  startAt,
  endAt,
  fadeInMs,
  fadeOutMs,
  sourceStartAt,
  sourceEndAt,
  source,
  volume,
  loop,
  previewControllerRef,
  onChange,
  onSourceCropChange,
}: EntryExitTimelineProps) {
  const { t } = useI18nNew();
  const cropTrackRef = useRef<HTMLDivElement | null>(null);
  const cropDragRef = useRef<
    | null
    | {
        kind: "left" | "right";
        startX: number;
        startStart: number;
        startEnd: number;
        widthPx: number;
      }
  >(null);

  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [waveformSamples, setWaveformSamples] = useState<number[]>([]);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const [sourceDurationMs, setSourceDurationMs] = useState(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const previewStartRealTimeRef = useRef<number>(0);
  const previewStartSceneTimeRef = useRef<number>(0);
  const previewTimeRef = useRef(0);
  const isPreviewingRef = useRef(false);
  const previewPlayPendingRef = useRef(false);

  const safeStart = clamp(startAt, 0, Math.max(0, totalDuration - 100));
  const safeEnd = clamp(endAt, safeStart + 100, totalDuration);

  const cropDurationMs = Math.max(0, sourceDurationMs);
  const cropStart = clamp(sourceStartAt, 0, Math.max(0, cropDurationMs - 100));
  const cropEnd =
    sourceEndAt === null || sourceEndAt <= 0
      ? cropDurationMs
      : clamp(sourceEndAt, cropStart + 100, cropDurationMs);
  const cropLeftPercent = cropDurationMs > 0 ? (cropStart / cropDurationMs) * 100 : 0;
  const cropWidthPercent =
    cropDurationMs > 0 ? ((cropEnd - cropStart) / cropDurationMs) * 100 : 100;
  const cropLengthMs = Math.max(0, cropEnd - cropStart);
  const currentSourceTime = (() => {
    if (cropDurationMs <= 0) return 0;
    const sceneOffset = Math.max(0, previewTime - safeStart);
    if (loop && cropLengthMs > 0) {
      return cropStart + (sceneOffset % cropLengthMs);
    }
    return clamp(cropStart + sceneOffset, cropStart, cropEnd);
  })();
  const cropPlayheadPercent =
    cropLengthMs > 0 ? clamp(((currentSourceTime - cropStart) / cropLengthMs) * 100, 0, 100) : 0;

  useEffect(() => {
    previewTimeRef.current = previewTime;
  }, [previewTime]);

  useEffect(() => {
    isPreviewingRef.current = isPreviewing;
  }, [isPreviewing]);

  useEffect(() => {
    let cancelled = false;
    setWaveformSamples([]);
    setIsWaveformLoading(false);
    setSourceDurationMs(0);
    if (!source) return;

    const loadWaveform = async (): Promise<void> => {
      setIsWaveformLoading(true);
      try {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const AudioContextCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioContextCtor) return;
        const ctx = new AudioContextCtor();
        try {
          const decoded = await ctx.decodeAudioData(data.slice(0));
          if (!cancelled) setSourceDurationMs(decoded.duration * 1000);
          const channel = decoded.getChannelData(0);
          const barCount = 160;
          const samples: number[] = [];
          const blockSize = Math.max(1, Math.floor(channel.length / barCount));
          for (let i = 0; i < barCount; i += 1) {
            const start = i * blockSize;
            const end = Math.min(channel.length, start + blockSize);
            let sum = 0;
            for (let j = start; j < end; j += 1) {
              sum += channel[j] * channel[j];
            }
            samples.push(Math.sqrt(sum / Math.max(1, end - start)));
          }
          const peak = Math.max(...samples, 0.001);
          if (!cancelled) setWaveformSamples(samples.map((v) => clamp(v / peak, 0.08, 1)));
        } finally {
          void ctx.close().catch(() => {});
        }
      } catch {
        if (!cancelled) setWaveformSamples([]);
      } finally {
        if (!cancelled) setIsWaveformLoading(false);
      }
    };

    void loadWaveform();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const beginCropDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    kind: "left" | "right",
  ): void => {
    event.stopPropagation();
    event.preventDefault();
    const rect = cropTrackRef.current?.getBoundingClientRect();
    if (!rect || cropDurationMs <= 0) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    cropDragRef.current = {
      kind,
      startX: event.clientX,
      startStart: cropStart,
      startEnd: cropEnd,
      widthPx: rect.width,
    };
  };

  const updateCropDrag = (clientX: number): void => {
    const drag = cropDragRef.current;
    if (!drag || drag.widthPx <= 0 || cropDurationMs <= 0) return;
    const dxMs = ((clientX - drag.startX) / drag.widthPx) * cropDurationMs;
    if (drag.kind === "left") {
      const nextStart = clamp(drag.startStart + dxMs, 0, drag.startEnd - 100);
      onSourceCropChange(nextStart, drag.startEnd >= cropDurationMs - 1 ? null : drag.startEnd);
      return;
    }
    const nextEnd = clamp(drag.startEnd + dxMs, drag.startStart + 100, cropDurationMs);
    onSourceCropChange(drag.startStart, nextEnd >= cropDurationMs - 1 ? null : nextEnd);
  };

  const onCropPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!cropDragRef.current) return;
    e.stopPropagation();
    updateCropDrag(e.clientX);
  };

  const onCropPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!cropDragRef.current) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    cropDragRef.current = null;
  };

  // ---- Preview playback inside the entry/exit timeline ----------------
  const cancelPreviewFrame = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const pausePreview = useCallback(
    (resetAudio = false): void => {
      setIsPreviewing(false);
      isPreviewingRef.current = false;
      cancelPreviewFrame();
      const audio = previewAudioRef.current;
      if (!audio) return;
      audio.pause();
      previewPlayPendingRef.current = false;
      audio.volume = clamp(volume, 0, 1);
      if (resetAudio) {
        try {
          audio.currentTime = 0;
        } catch {
          /* noop */
        }
      }
    },
    [cancelPreviewFrame, volume],
  );

  useEffect(() => () => pausePreview(true), [pausePreview]);

  const computeFadedVolume = useCallback(
    (timeMs: number): number => {
      if (timeMs < safeStart || timeMs > safeEnd) return 0;
      const baseVolume = clamp(volume, 0, 1);
      let factor = 1;
      if (fadeInMs > 0 && timeMs - safeStart < fadeInMs) {
        factor = Math.min(factor, (timeMs - safeStart) / fadeInMs);
      }
      if (fadeOutMs > 0 && safeEnd - timeMs < fadeOutMs) {
        factor = Math.min(factor, (safeEnd - timeMs) / fadeOutMs);
      }
      return clamp(baseVolume * Math.max(0, factor), 0, 1);
    },
    [safeStart, safeEnd, fadeInMs, fadeOutMs, volume],
  );

  const syncAudioToSceneTime = useCallback(
    (sceneTime: number, shouldPlay: boolean, forceSeek = false): void => {
      const audio = previewAudioRef.current;
      if (!audio) return;
      audio.loop = loop;
      audio.volume = computeFadedVolume(sceneTime);

      if (sceneTime < safeStart || sceneTime >= safeEnd) {
        audio.pause();
        previewPlayPendingRef.current = false;
        return;
      }

      const sourceStartSeconds = Math.max(0, cropStart / 1000);
      const sourceEndSeconds = cropEnd > cropStart ? cropEnd / 1000 : 0;
      const cropLengthSeconds =
        sourceEndSeconds > sourceStartSeconds ? sourceEndSeconds - sourceStartSeconds : 0;
      const localSeconds = sourceStartSeconds + Math.max(0, (sceneTime - safeStart) / 1000);
      const audioDuration =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      let targetSeconds = localSeconds;
      if (loop && cropLengthSeconds > 0) {
        targetSeconds =
          sourceStartSeconds + ((localSeconds - sourceStartSeconds) % cropLengthSeconds);
      } else if (
        (sourceEndSeconds > sourceStartSeconds && localSeconds >= sourceEndSeconds) ||
        (audioDuration > 0 && localSeconds >= audioDuration)
      ) {
        audio.pause();
        previewPlayPendingRef.current = false;
        try {
          audio.currentTime = sourceEndSeconds > sourceStartSeconds ? sourceEndSeconds : audioDuration;
        } catch {
          /* noop */
        }
        return;
      }

      if (
        forceSeek &&
        audio.readyState >= 1 &&
        Math.abs(audio.currentTime - targetSeconds) > 0.05
      ) {
        try {
          audio.currentTime = targetSeconds;
        } catch {
          /* noop */
        }
      }

      if (shouldPlay && audio.paused) {
        if (!previewPlayPendingRef.current) {
          previewPlayPendingRef.current = true;
          void audio
            .play()
            .then(() => {
              previewPlayPendingRef.current = false;
            })
            .catch(() => {
              previewPlayPendingRef.current = false;
              setIsPreviewing(false);
              isPreviewingRef.current = false;
            });
        }
      } else if (!shouldPlay) {
        audio.pause();
        previewPlayPendingRef.current = false;
      }
    },
    [safeStart, safeEnd, loop, cropStart, cropEnd, computeFadedVolume],
  );

  useEffect(() => {
    if (!source || cropDurationMs <= 0) return;
    // When either crop handle moves, the same scene preview time maps to a
    // different source-audio time. Force one audio seek so the red playhead and
    // the actual sound stay aligned with the newly selected crop window.
    syncAudioToSceneTime(previewTimeRef.current, isPreviewingRef.current, true);
  }, [source, cropStart, cropEnd, cropDurationMs, syncAudioToSceneTime]);

  const playFromSceneTime = useCallback(
    (sceneTime: number): void => {
      if (!source) return;
      const startSceneTime = clamp(sceneTime, safeStart, Math.max(safeStart, safeEnd - 1));
      cancelPreviewFrame();
      previewStartSceneTimeRef.current = startSceneTime;
      previewStartRealTimeRef.current = performance.now();
      previewTimeRef.current = startSceneTime;
      setPreviewTime(startSceneTime);
      setIsPreviewing(true);
      isPreviewingRef.current = true;
      syncAudioToSceneTime(startSceneTime, true, true);

      const tick = (): void => {
        const elapsed = performance.now() - previewStartRealTimeRef.current;
        const sceneTimeNow = previewStartSceneTimeRef.current + elapsed;
        if (sceneTimeNow >= safeEnd) {
          pausePreview(false);
          previewTimeRef.current = safeEnd;
          setPreviewTime(safeEnd);
          return;
        }
        if (!loop && cropLengthMs > 0 && sceneTimeNow >= safeStart + cropLengthMs) {
          pausePreview(false);
          const endSceneTime = safeStart + cropLengthMs;
          previewTimeRef.current = endSceneTime;
          setPreviewTime(endSceneTime);
          return;
        }
        previewTimeRef.current = sceneTimeNow;
        setPreviewTime(sceneTimeNow);
        // Do not keep correcting currentTime during normal playback. The audio
        // element's own clock is smoother than React/RAF state updates; here we
        // only refresh fade volume and keep the visual playhead moving.
        syncAudioToSceneTime(sceneTimeNow, true, false);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [
      source,
      safeStart,
      safeEnd,
      loop,
      cropLengthMs,
      cancelPreviewFrame,
      syncAudioToSceneTime,
      pausePreview,
    ],
  );

  const togglePreview = useCallback((): void => {
    if (!source) return;
    if (isPreviewingRef.current) {
      pausePreview(false);
      return;
    }
    const current = previewTimeRef.current;
    playFromSceneTime(current >= safeStart && current < safeEnd ? current : safeStart);
  }, [source, safeStart, safeEnd, pausePreview, playFromSceneTime]);

  useEffect(() => {
    if (!previewControllerRef) return;
    previewControllerRef.current = { togglePlay: togglePreview };
    return () => {
      if (previewControllerRef.current?.togglePlay === togglePreview) {
        previewControllerRef.current = null;
      }
    };
  }, [previewControllerRef, togglePreview]);

  // ---- Manual seek via clicking on the source waveform ----------------
  const seekSourceFromClientX = useCallback(
    (clientX: number): void => {
      const rect = cropTrackRef.current?.getBoundingClientRect();
      if (!rect || cropDurationMs <= 0) return;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const sourceTime = ratio * cropDurationMs;
      const nextTime = safeStart + clamp(sourceTime, cropStart, cropEnd) - cropStart;
      previewTimeRef.current = nextTime;
      setPreviewTime(nextTime);
      if (isPreviewingRef.current) {
        if (nextTime >= safeStart && nextTime < safeEnd) {
          playFromSceneTime(nextTime);
        } else {
          pausePreview(false);
        }
      } else {
        syncAudioToSceneTime(nextTime, false, true);
      }
    },
    [
      cropDurationMs,
      cropStart,
      cropEnd,
      safeStart,
      safeEnd,
      playFromSceneTime,
      pausePreview,
      syncAudioToSceneTime,
    ],
  );

  const beginSourceSeekDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target.dataset.role === "handle" || !previewActive) return;
    event.preventDefault();
    event.stopPropagation();
    seekSourceFromClientX(event.clientX);

    const onMove = (ev: PointerEvent): void => {
      seekSourceFromClientX(ev.clientX);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const previewActive = !!source && safeEnd > safeStart;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!previewActive}
          onClick={togglePreview}
          className={`flex h-7 items-center gap-1 rounded px-2 text-xs transition ${
            previewActive
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-500"
          }`}
          title={
            previewActive
              ? t("coursewareEditor.musicSettings.previewTimeline")
              : t("coursewareEditor.musicSettings.previewNeedSource")
          }
        >
          {isPreviewing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isPreviewing
            ? t("coursewareEditor.musicSettings.pausePreview")
            : t("coursewareEditor.musicSettings.previewEffect")}
        </button>
        <span className="font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {formatTimeMsPrecise(currentSourceTime)} / {formatTimeMsPrecise(cropDurationMs)}
        </span>
        <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">
          {t("coursewareEditor.musicSettings.enterAt")}{" "}
          <span className="font-mono text-slate-800 dark:text-slate-200">{formatTimeMs(safeStart)}</span>
          {"  "}·{"  "}
          {t("coursewareEditor.musicSettings.exitFromEnd")}{" "}
          <span className="font-mono text-slate-800 dark:text-slate-200">
            {formatTimeMs(Math.max(0, totalDuration - safeEnd))}
          </span>
        </span>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
          <span className="font-medium">{t("coursewareEditor.musicSettings.trimTitle")}</span>
          <span className="font-mono tabular-nums">
            {formatTimeMs(cropStart)} - {formatTimeMs(cropEnd)}
          </span>
        </div>
        <div
          ref={cropTrackRef}
          onPointerDown={beginSourceSeekDrag}
          onPointerMove={onCropPointerMove}
          onPointerUp={onCropPointerUp}
          onPointerCancel={onCropPointerUp}
          className="relative h-14 w-full select-none overflow-hidden rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
          style={{ touchAction: "none", cursor: cropDurationMs > 0 ? "default" : "not-allowed" }}
        >
          <div className="pointer-events-none absolute inset-x-3 inset-y-2 flex items-center gap-px opacity-80">
            {(waveformSamples.length > 0
              ? waveformSamples
              : isWaveformLoading
                ? Array.from({ length: 80 }, (_, i) => 0.15 + ((i % 11) / 11) * 0.35)
                : []
            ).map((sample, index) => (
              <span
                key={index}
                className="relative min-w-px flex-1"
                style={{ height: `${Math.max(8, sample * 92)}%` }}
              >
                <span className="absolute left-0 top-1/2 h-full w-full -translate-y-1/2 rounded-full bg-sky-200/70" />
              </span>
            ))}
          </div>
          <div
            className="absolute inset-y-0 rounded bg-blue-500/10 dark:bg-blue-500/15 ring-1 ring-blue-300/50"
            style={{ left: `${cropLeftPercent}%`, width: `${cropWidthPercent}%` }}
          >
            <div
              data-role="handle"
              onPointerDown={(e) => beginCropDrag(e, "left")}
              className="absolute -left-1.5 top-0 bottom-0 z-10 flex w-3 cursor-ew-resize items-center justify-center rounded-l bg-sky-400 hover:bg-sky-300"
              title={t("coursewareEditor.musicSettings.trimStart")}
            >
              <div className="h-5 w-0.5 bg-sky-50" />
            </div>
            <div
              data-role="handle"
              onPointerDown={(e) => beginCropDrag(e, "right")}
              className="absolute -right-1.5 top-0 bottom-0 z-10 flex w-3 cursor-ew-resize items-center justify-center rounded-r bg-sky-400 hover:bg-sky-300"
              title={t("coursewareEditor.musicSettings.trimEnd")}
            >
              <div className="h-5 w-0.5 bg-sky-50" />
            </div>
            {sourceDurationMs > 0 ? (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-rose-400"
                style={{ left: `${cropPlayheadPercent}%` }}
              >
                <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-rose-400" />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
          {t("coursewareEditor.musicSettings.enterSec")}
          <input
            type="number"
            min={0}
            step={0.1}
            className="w-20 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            value={(safeStart / 1000).toFixed(1)}
            onChange={(e) => {
              const ms = clamp(
                Math.round((Number(e.target.value) || 0) * 1000),
                0,
                safeEnd - 100,
              );
              onChange(ms, safeEnd);
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
          {t("coursewareEditor.musicSettings.exitSec")}
          <input
            type="number"
            min={0}
            step={0.1}
            className="w-20 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
            value={(Math.max(0, totalDuration - safeEnd) / 1000).toFixed(1)}
            onChange={(e) => {
              const offsetMs = Math.max(0, Math.round((Number(e.target.value) || 0) * 1000));
              const newEnd = clamp(totalDuration - offsetMs, safeStart + 100, totalDuration);
              onChange(safeStart, newEnd);
            }}
          />
        </label>
      </div>

      <audio
        ref={previewAudioRef}
        src={source || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const durationSeconds = event.currentTarget.duration;
          if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
            setSourceDurationMs((prev) => (prev > 0 ? prev : durationSeconds * 1000));
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset library picker (only audio files)
// ---------------------------------------------------------------------------

interface AudioAssetPickerProps {
  coursewareId: string;
  onClose: () => void;
  onPick: (asset: CoursewareAssetItem) => void;
}

function AudioAssetPicker({ coursewareId, onClose, onPick }: AudioAssetPickerProps) {
  const { t } = useI18nNew();
  const [assets, setAssets] = useState<CoursewareAssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await coursewareAssetsApi.listAssets({
          courseware_id: coursewareId,
          page_number: 1,
          page_size: 100,
        });
        const audioOnly = response.data.filter(isAudioAsset);
        if (audioOnly.length > 0) {
          const signed = await coursewareAssetsApi.batchPresignUrls(
            coursewareId,
            audioOnly.map((a) => a.url),
          );
          if (!cancelled) {
            setAssets(
              audioOnly.map((a) => ({ ...a, url: signed[a.url] ?? a.url })),
            );
          }
        } else if (!cancelled) {
          setAssets([]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : t("coursewareEditor.assetPicker.loadFailed"),
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [coursewareId, t]);

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center bg-slate-900/35 dark:bg-slate-900/35 dark:bg-slate-950/80 p-6">
      <div className="flex h-full max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderOpen className="h-4 w-4 text-blue-400" />{" "}
            {t("coursewareEditor.assetPicker.pickAudio")}
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
            <div className="text-center text-xs text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.common.loading")}…
            </div>
          ) : error ? (
            <div className="rounded border border-rose-300/40 dark:border-rose-400/40 bg-rose-500/10 dark:bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : assets.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-400 dark:text-slate-500">
              {t("coursewareEditor.musicSettings.emptyAudioLibrary")}
            </div>
          ) : (
            <div className="space-y-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800/40 p-2"
                >
                  <Music className="h-4 w-4 text-blue-700 dark:text-blue-300" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-slate-900 dark:text-slate-100">{asset.name}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">
                      {asset.extension.toUpperCase()}
                    </div>
                  </div>
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
