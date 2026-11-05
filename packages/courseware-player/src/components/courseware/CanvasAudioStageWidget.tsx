// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AudioElement } from "../../lib/courseware/index.ts";
import { getCanvasAudioPlaybackRate } from "../../lib/courseware/index.ts";
import { Pause, Play, Volume2 } from "lucide-react";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export type CanvasAudioStageWidgetMode = "button" | "player";

const formatTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

/**
 * Click-to-play canvas audio (not timeline-synced). “Hidden” mode uses
 * {@link GlobalAudioTracks}; button/player are excluded from the mixer.
 */
export function CanvasAudioStageWidget({
  track,
  mode,
  volumeMultiplier = 1,
}: {
  track: AudioElement;
  mode: CanvasAudioStageWidgetMode;
  /** Host master volume (0–1), multiplied with `track.volume`. */
  volumeMultiplier?: number;
}): ReactNode {
  const { t } = useI18nNew();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isScrubbingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  const startSec = Math.max(0, (track.source_start_at ?? 0) / 1000);
  const endSec =
    typeof track.source_end_at === "number" && track.source_end_at > (track.source_start_at ?? 0)
      ? track.source_end_at / 1000
      : null;
  const playbackRate = getCanvasAudioPlaybackRate(track);

  const absMaxSec =
    endSec ??
    (Number.isFinite(durationSec) && durationSec > startSec ? durationSec : startSec + 1);

  const clipLenSec = Math.max(0.001, absMaxSec - startSec);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = clamp(track.volume * volumeMultiplier, 0, 1);
  }, [track.volume, volumeMultiplier]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.playbackRate = Math.max(0.1, playbackRate);
    } catch {
      /* noop */
    }
  }, [playbackRate, track.source]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTimeUpdate = (): void => {
      let t = a.currentTime;
      if (endSec != null && t >= endSec - 0.04) {
        if (track.loop) {
          try {
            a.currentTime = startSec;
          } catch {
            /* noop */
          }
          t = startSec;
        } else {
          a.pause();
          try {
            a.currentTime = startSec;
          } catch {
            /* noop */
          }
          if (!isScrubbingRef.current) {
            setCurrentSec(startSec);
          }
          setPlaying(false);
          return;
        }
      }
      if (!isScrubbingRef.current) {
        setCurrentSec(t);
      }
    };
    const onMeta = (): void => {
      const d = a.duration;
      setDurationSec(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    const onEnded = (): void => {
      if (track.loop && endSec == null) return;
      setPlaying(false);
      setCurrentSec(endSec != null ? startSec : 0);
    };
    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTimeUpdate);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [track.source, track.loop, startSec, endSec]);

  useEffect(() => {
    setCurrentSec(startSec);
    setDurationSec(0);
    setPlaying(false);
    isScrubbingRef.current = false;
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
        a.currentTime = startSec;
      } catch {
        /* noop */
      }
    }
  }, [track.source, startSec]);

  /** Ring progress around the button: while playing, currentTime is sampled with rAF, smoother than timeupdate */
  useEffect(() => {
    if (mode !== "button" || !playing) return;
    let id = 0;
    const loop = (): void => {
      const a = audioRef.current;
      if (a && !isScrubbingRef.current) {
        setCurrentSec(a.currentTime);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [mode, playing]);

  const resumePlayback = useCallback(async (): Promise<void> => {
    const a = audioRef.current;
    if (!a || !track.source.trim()) return;
    try {
      if (endSec != null && a.currentTime >= endSec - 0.05) {
        a.currentTime = startSec;
      } else if (a.currentTime < startSec - 0.02) {
        a.currentTime = startSec;
      }
      await a.play();
    } catch {
      /* autoplay / decode */
    }
  }, [track.source, startSec, endSec]);

  const pausePlayback = useCallback((): void => {
    audioRef.current?.pause();
  }, []);

  const togglePlay = useCallback(async (): Promise<void> => {
    const a = audioRef.current;
    if (!a || !track.source.trim()) return;
    if (a.paused) {
      await resumePlayback();
    } else {
      pausePlayback();
    }
  }, [track.source, resumePlayback, pausePlayback]);

  const seekTo = useCallback(
    (absoluteSec: number): void => {
      const a = audioRef.current;
      if (!a) return;
      const maxT = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : absMaxSec;
      const hi = endSec != null ? Math.min(endSec, maxT) : maxT;
      const next = clamp(absoluteSec, startSec, hi);
      try {
        a.currentTime = next;
      } catch {
        /* noop */
      }
      setCurrentSec(next);
    },
    [startSec, endSec, absMaxSec],
  );

  const displaySec = currentSec;
  const progressRatio =
    clipLenSec > 0 ? clamp((displaySec - startSec) / clipLenSec, 0, 1) : 0;

  /** viewBox units; the ring hugs the central round button — don't use a large fixed px (it would misalign with the logical selection) */
  const ringR = 31;
  const ringStroke = 3.5;
  const ringCirc = 2 * Math.PI * ringR;

  const displayDurationLabel =
    endSec != null ? endSec - startSec : Math.max(0, absMaxSec - startSec);

  const stopDragBubble = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation();
  };

  return (
    <div
      className="flex h-full w-full flex-col items-stretch justify-center gap-1 text-slate-200"
      onPointerDown={stopDragBubble}
    >
      <audio
        ref={audioRef}
        src={track.source || undefined}
        loop={track.loop && endSec == null}
        preload="metadata"
        playsInline
        className="hidden"
      />
      {mode === "button" ? (
        <div className="@container-[size] relative h-full w-full">
          {/*
            The inner square's side = min(width, height), centered proportionally; avoids a non-square logical box stretching the ring into an ellipse.
          */}
          <div
            className="absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: "min(100cqw, 100cqh)",
              height: "min(100cqw, 100cqh)",
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0 z-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden
            >
              <circle
                cx="50"
                cy="50"
                r={ringR}
                fill="none"
                stroke="rgb(51 65 85 / 0.9)"
                strokeWidth={ringStroke}
              />
              <circle
                cx="50"
                cy="50"
                r={ringR}
                fill="none"
                stroke="rgb(59 130 246)"
                strokeWidth={ringStroke}
                strokeLinecap="round"
                transform="rotate(-90 50 50)"
                strokeDasharray={ringCirc}
                strokeDashoffset={ringCirc * (1 - progressRatio)}
                className={
                  playing ? "transition-[stroke-dashoffset] duration-150 ease-linear" : ""
                }
              />
            </svg>
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <button
                type="button"
                className="flex aspect-square w-[54%] max-h-[54%] max-w-[54%] shrink-0 items-center justify-center rounded-full border border-slate-500/80 bg-slate-800/95 text-slate-100 shadow-md transition hover:bg-slate-700"
                onClick={(e) => {
                  e.stopPropagation();
                  void togglePlay();
                }}
                title={
                  playing
                    ? t("coursewarePreview.controls.pause")
                    : t("coursewarePreview.controls.play")
                }
              >
                {playing ? (
                  <Pause className="h-[42%] w-[42%] min-h-3 min-w-3 shrink-0" aria-hidden />
                ) : (
                  <Volume2 className="h-[42%] w-[42%] min-h-3 min-w-3 shrink-0" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[56px] w-full flex-col justify-center gap-2 rounded-lg border border-slate-600 bg-slate-900/90 px-2 py-2 shadow-inner">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={playing || !track.source.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-slate-100 shadow transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              title={t("coursewarePreview.controls.play")}
              aria-label={t("coursewarePreview.controls.play")}
              onClick={(e) => {
                e.stopPropagation();
                void resumePlayback();
              }}
            >
              <Play className="ml-0.5 h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              disabled={!playing}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-slate-100 shadow transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              title={t("coursewarePreview.controls.pause")}
              aria-label={t("coursewarePreview.controls.pause")}
              onClick={(e) => {
                e.stopPropagation();
                pausePlayback();
              }}
            >
              <Pause className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-0 flex-1 text-center tabular-nums text-[11px] text-slate-400">
              {formatTime(Math.max(0, displaySec - startSec))} / {formatTime(displayDurationLabel)}
            </span>
          </div>
          <input
            type="range"
            className="h-2 w-full min-w-0 cursor-pointer accent-blue-500"
            min={startSec}
            max={absMaxSec}
            step={0.01}
            value={clamp(displaySec, startSec, absMaxSec)}
            disabled={!track.source.trim()}
            aria-label={t("coursewarePreview.controls.progress")}
            style={{
              background: `linear-gradient(to right, rgb(59 130 246) 0%, rgb(59 130 246) ${progressRatio * 100}%, rgb(51 65 85) ${progressRatio * 100}%, rgb(51 65 85) 100%)`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              isScrubbingRef.current = true;
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              isScrubbingRef.current = false;
            }}
            onPointerCancel={() => {
              isScrubbingRef.current = false;
            }}
            onChange={(e) => {
              seekTo(Number(e.target.value));
            }}
            onInput={(e) => {
              seekTo(Number((e.target as HTMLInputElement).value));
            }}
          />
        </div>
      )}
    </div>
  );
}
