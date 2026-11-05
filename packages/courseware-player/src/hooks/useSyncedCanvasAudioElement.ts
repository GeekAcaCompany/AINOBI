// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type RefObject } from "react";
import type { AudioElement } from "../lib/courseware/index.ts";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** During continuous playback, seek only beyond this interval, avoiding writing `audio.currentTime` every frame. */
const CONTINUOUS_PLAYBACK_MAX_DELTA_MS = 150;

const PLAYHEAD_SCRUB_BACK_MS = 50;
const AUDIO_DRIFT_SEEK_SEC = 0.05;

/**
 * Keeps a single &lt;audio&gt; element in sync with slide/scene timeline (same rules as
 * {@link GlobalAudioTracks}). Used by the global mixer and by on-canvas audio widgets.
 */
export function useSyncedCanvasAudioElement(params: {
  track: AudioElement;
  /** Slide-local or scene-global time in ms, matching `track.timeline` space. */
  sceneCurrentTime: number;
  /**
   * Whether sync should call `play()` / advance volume. Preview/editor pass raw
   * `isPlaying` here; buffering is reported separately via `onBufferingChange`.
   */
  isPlaying: boolean;
  /**
   * User intent to run the timeline (usually `isPlaying && !showEmbeddedPreview`), **without**
   * gating on buffer/load flags — used so buffering tokens are not cleared when
   * {@link isPlaying} becomes false only because another track is holding the timeline.
   */
  playIntent?: boolean;
  /** While data is not yet playable, report true so the editor/preview can pause timeline advance. */
  onBufferingChange?: (buffering: boolean) => void;
  rate?: number;
  /** Host master volume (0–1), multiplied with the track's own `track.volume`. */
  volumeMultiplier?: number;
}): RefObject<HTMLAudioElement | null> {
  const {
    track,
    sceneCurrentTime,
    isPlaying,
    playIntent: _playIntent,
    onBufferingChange,
    rate = 1,
    volumeMultiplier = 1,
  } = params;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playPendingRef = useRef(false);
  const lastSceneTimeRef = useRef<number | null>(null);
  const wasInRangeRef = useRef(false);
  const sceneCurrentTimeRef = useRef(sceneCurrentTime);
  const isPlayingRef = useRef(isPlaying);
  const onBufferingChangeRef = useRef(onBufferingChange);
  sceneCurrentTimeRef.current = sceneCurrentTime;
  isPlayingRef.current = isPlaying;
  onBufferingChangeRef.current = onBufferingChange;

  const startAt = track.timeline.start_at;
  const endAt = track.timeline.end_at;
  const fadeInMs = Math.max(0, track.fade_in_ms);
  const fadeOutMs = Math.max(0, track.fade_out_ms);
  const baseVolume = clamp(track.volume, 0, 1);
  const inRange = sceneCurrentTime >= startAt && sceneCurrentTime <= endAt;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const clearPending = (): void => {
      playPendingRef.current = false;
    };
    audio.addEventListener("play", clearPending);
    audio.addEventListener("playing", clearPending);
    audio.addEventListener("pause", clearPending);
    audio.addEventListener("error", clearPending);
    return () => {
      audio.removeEventListener("play", clearPending);
      audio.removeEventListener("playing", clearPending);
      audio.removeEventListener("pause", clearPending);
      audio.removeEventListener("error", clearPending);
    };
  }, [track.source]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.playbackRate = Math.max(0.1, rate);
    } catch {
      /* noop */
    }
  }, [rate]);

  /** Pause timeline advance until this clip can play (same idea as VTuber narration TTS). */
  useEffect(() => {
    const report = onBufferingChangeRef.current;
    if (!report) return;
    const audio = audioRef.current;
    if (!audio) return;
    // Use only the isPlaying the host passes; don't report buffering through playIntent (it would deadlock with tokens such as the VTuber's).
    if (!inRange || !isPlaying) {
      report(false);
      return;
    }
    if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      report(false);
      return;
    }
    report(true);
    const clear = (): void => {
      onBufferingChangeRef.current?.(false);
    };
    audio.addEventListener("canplay", clear, { once: true });
    audio.addEventListener("canplaythrough", clear, { once: true });
    audio.addEventListener("loadeddata", clear, { once: true });
    audio.addEventListener("error", clear, { once: true });
    if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      clear();
    }
    return () => {
      audio.removeEventListener("canplay", clear);
      audio.removeEventListener("canplaythrough", clear);
      audio.removeEventListener("loadeddata", clear);
      audio.removeEventListener("error", clear);
      onBufferingChangeRef.current?.(false);
    };
  }, [inRange, isPlaying, track.source]);

  useEffect(() => {
    const applyAtTime = (timeMs: number, drivingPlayback: boolean): void => {
      const audio = audioRef.current;
      if (!audio) return;

      const previousSceneTime = lastSceneTimeRef.current;
      const rawSceneDelta =
        previousSceneTime === null ? 0 : timeMs - previousSceneTime;
      const sceneTimeDelta = Math.abs(rawSceneDelta);
      const playheadMovedBack =
        previousSceneTime !== null && rawSceneDelta < -PLAYHEAD_SCRUB_BACK_MS;
      const inRangeNow = timeMs >= startAt && timeMs <= endAt;
      const enteredRange = inRangeNow && !wasInRangeRef.current;
      lastSceneTimeRef.current = timeMs;
      wasInRangeRef.current = inRangeNow;

      if (!inRangeNow) {
        audio.volume = 0;
        audio.pause();
        playPendingRef.current = false;
        try {
          audio.currentTime = 0;
        } catch {
          /* noop */
        }
        return;
      }

      let factor = 1;
      if (fadeInMs > 0 && timeMs - startAt < fadeInMs) {
        factor = Math.min(factor, (timeMs - startAt) / fadeInMs);
      }
      if (fadeOutMs > 0 && endAt - timeMs < fadeOutMs) {
        factor = Math.min(factor, (endAt - timeMs) / fadeOutMs);
      }
      audio.volume = clamp(baseVolume * Math.max(0, factor) * volumeMultiplier, 0, 1);

      const trackElapsedMs = timeMs - startAt;
      const sourceStartSec = Math.max(0, (track.source_start_at ?? 0) / 1000);
      const sourceEndSec =
        typeof track.source_end_at === "number" && track.source_end_at > track.source_start_at
          ? track.source_end_at / 1000
          : 0;
      const cropLengthSec =
        sourceEndSec > sourceStartSec ? sourceEndSec - sourceStartSec : 0;
      const trackElapsedSec = sourceStartSec + Math.max(0, trackElapsedMs / 1000);
      const audioDurationSec =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;

      let target = trackElapsedSec;
      if (track.loop && cropLengthSec > 0) {
        target = sourceStartSec + ((trackElapsedSec - sourceStartSec) % cropLengthSec);
      } else if (
        (sourceEndSec > sourceStartSec && trackElapsedSec >= sourceEndSec) ||
        (audioDurationSec > 0 && trackElapsedSec >= audioDurationSec)
      ) {
        audio.pause();
        try {
          audio.currentTime = sourceEndSec > sourceStartSec ? sourceEndSec : audioDurationSec;
        } catch {
          /* noop */
        }
        return;
      }

      const continuousDeltaCap = CONTINUOUS_PLAYBACK_MAX_DELTA_MS * Math.max(1, rate);
      const isContinuousPlayback =
        drivingPlayback &&
        previousSceneTime !== null &&
        rawSceneDelta >= 0 &&
        sceneTimeDelta < continuousDeltaCap;
      const shouldSyncPosition =
        enteredRange ||
        !drivingPlayback ||
        previousSceneTime === null ||
        sceneTimeDelta > 1000 ||
        !isContinuousPlayback;
      if (shouldSyncPosition && audio.readyState >= 1) {
        const drift = audio.currentTime - target;
        if (Math.abs(drift) > AUDIO_DRIFT_SEEK_SEC) {
          if (!(drivingPlayback && drift > 0 && !playheadMovedBack)) {
            try {
              audio.currentTime = target;
            } catch {
              /* noop */
            }
          }
        }
      }

      if (drivingPlayback) {
        if (audio.paused && !playPendingRef.current) {
          playPendingRef.current = true;
          void audio.play().catch(() => {
            playPendingRef.current = false;
          });
        }
      } else {
        audio.pause();
        playPendingRef.current = false;
      }
    };

    if (isPlaying) {
      let raf = 0;
      const tick = (): void => {
        if (!isPlayingRef.current) return;
        applyAtTime(sceneCurrentTimeRef.current, true);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }

    applyAtTime(sceneCurrentTime, false);
    return undefined;
  }, [
    isPlaying,
    sceneCurrentTime,
    startAt,
    endAt,
    fadeInMs,
    fadeOutMs,
    baseVolume,
    track.loop,
    track.source_start_at,
    track.source_end_at,
    track.source,
    rate,
    volumeMultiplier,
  ]);

  return audioRef;
}
