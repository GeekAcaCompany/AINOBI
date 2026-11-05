// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type RefObject } from "react";
import {
  isNarrationDecodeWarmed,
  isNarrationPlaybackSrcReady,
  isNarrationSegmentPreloaded,
  waitForNarrationDecodeWarm,
} from "../lib/courseware/narration-preload.ts";
import { narrationAudioUrlsEquivalent } from "../lib/courseware/narration-segments.ts";
import { setNarrationPendingStart } from "../lib/courseware/narration-pending-start.ts";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const PLAYHEAD_SCRUB_MS = 250;

const applyPlaybackRate = (audio: HTMLMediaElement, rate: number): void => {
  try {
    audio.playbackRate = Math.max(0.1, rate);
  } catch {
    /* noop */
  }
};

const SEEK_EPSILON_SEC = 0.04;

/**
 * Narration `<audio>` sync: the gap before a segment hands back to the wall clock; inside a segment before latching the wall clock keeps running, and only waiting on a weak network reports loading;
 * after latching the audio plays naturally and drives the playhead.
 */
export function useSyncedNarrationAudio(params: {
  audioRef: RefObject<HTMLAudioElement | null>;
  activeSrc: string;
  /** Segment identity (OSS URL); distinct from activeSrc (which may be a blob), used for same-source checks and preloading. */
  activeCanonicalSrc?: string;
  activeStartMs: number;
  activeEndMs: number;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  onBufferingChange?: (loading: boolean) => void;
  onSegmentEnded?: () => void;
  onPlayheadDriveMs?: (localMs: number | null) => void;
  volumeMultiplier?: number;
  playheadRef?: RefObject<number>;
  playheadFromRef?: boolean;
}): void {
  const {
    audioRef,
    activeSrc,
    activeCanonicalSrc = "",
    activeStartMs,
    activeEndMs,
    currentTime,
    isPlaying,
    playbackRate,
    onSegmentEnded,
    onPlayheadDriveMs,
    onBufferingChange,
    volumeMultiplier = 1,
    playheadRef,
    playheadFromRef = false,
  } = params;

  const latchedRef = useRef(false);
  const playPendingRef = useRef(false);
  const loadingReportedRef = useRef(false);
  const lastPlayheadMsRef = useRef<number | null>(null);
  const loadedSrcRef = useRef("");
  const loadedCanonicalSrcRef = useRef("");
  const activeCanonicalSrcRef = useRef(activeCanonicalSrc);
  const currentTimePropRef = useRef(currentTime);
  const currentTimeRef = useRef(currentTime);
  const isPlayingRef = useRef(isPlaying);
  const activeStartRef = useRef(activeStartMs);
  const activeEndRef = useRef(activeEndMs);
  const playheadFromRefRef = useRef(playheadFromRef);
  const playheadRefRef = useRef(playheadRef);
  const onSegmentEndedRef = useRef(onSegmentEnded);
  const onPlayheadDriveMsRef = useRef(onPlayheadDriveMs);
  const onBufferingChangeRef = useRef(onBufferingChange);
  const volumeMultiplierRef = useRef(volumeMultiplier);
  const playbackRateRef = useRef(playbackRate);
  const primingRef = useRef(false);
  const primedForStartMsRef = useRef<number | null>(null);
  const handledSegmentEnterStartRef = useRef<number | null>(null);
  const latchClockRef = useRef<{ wallAt: number; localAt: number } | null>(null);
  const segmentFinalizedStartRef = useRef<number | null>(null);
  const gapDriveReleasedForStartRef = useRef<number | null>(null);

  const setPendingStart = (pending: boolean): void => {
    setNarrationPendingStart(pending);
    setLoading(pending);
  };

  /** When the audio currentTime lags the wall-clock prediction by more than this, the wall clock advances the playhead (MP3 decoding gaps). */
  const LATCH_AUDIO_STALL_MS = 45;
  /** Re-anchor when the audio time suddenly jumps ahead. */
  const LATCH_AUDIO_JUMP_MS = 120;

  playheadFromRefRef.current = playheadFromRef;
  playheadRefRef.current = playheadRef;
  currentTimePropRef.current = currentTime;
  isPlayingRef.current = isPlaying;
  activeStartRef.current = activeStartMs;
  activeEndRef.current = activeEndMs;
  volumeMultiplierRef.current = volumeMultiplier;
  playbackRateRef.current = playbackRate;
  activeCanonicalSrcRef.current = activeCanonicalSrc.trim();
  onSegmentEndedRef.current = onSegmentEnded;
  onPlayheadDriveMsRef.current = onPlayheadDriveMs;
  onBufferingChangeRef.current = onBufferingChange;

  const setLoading = (loading: boolean): void => {
    if (loading && latchedRef.current) return;
    if (loadingReportedRef.current === loading) return;
    loadingReportedRef.current = loading;
    onBufferingChangeRef.current?.(loading);
  };

  const resolvePlayheadMs = (): number => {
    let ms: number;
    if (playheadFromRefRef.current && playheadRefRef.current) {
      ms = playheadRefRef.current.current;
    } else {
      ms = currentTimePropRef.current;
    }
    return Math.max(0, ms);
  };

  /** Enough buffer is needed before playing, so play() doesn't get stuck on event-waiting for tens to hundreds of ms. */
  const isReadyToStart = (audio: HTMLMediaElement): boolean => {
    const canonical = loadedCanonicalSrcRef.current || activeCanonicalSrcRef.current;
    if (isNarrationDecodeWarmed(canonical)) {
      return audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    }
    return audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
  };

  currentTimeRef.current = resolvePlayheadMs();

  const syncAudioPlaybackSettings = (audio: HTMLMediaElement, options?: { volume?: number }): void => {
    applyPlaybackRate(audio, playbackRateRef.current);
    const vol = options?.volume ?? volumeMultiplierRef.current;
    audio.volume = clamp(vol, 0, 1);
  };

  const isAudioSrcCurrent = (audio: HTMLMediaElement): boolean => {
    const expected = loadedSrcRef.current.trim();
    if (!expected) return false;
    const cur = (audio.currentSrc || audio.src || "").trim();
    return narrationAudioUrlsEquivalent(expected, cur);
  };

  /** The segment start must strictly reach startMs before playing, so an early wall-clock raf-retry doesn't latch back to the segment start. */
  const isBeforeSegment = (playheadMs: number): boolean =>
    playheadMs < activeStartRef.current;

  const isAtOrPastSegmentStart = (playheadMs: number): boolean =>
    playheadMs >= activeStartRef.current;

  const crossedSegmentStart = (previousMs: number | null, playheadMs: number): boolean =>
    previousMs !== null &&
    previousMs < activeStartRef.current &&
    playheadMs >= activeStartRef.current;

  const isPastActiveSegment = (playheadMs: number): boolean =>
    activeEndRef.current > activeStartRef.current &&
    playheadMs >= activeEndRef.current;

  const timelineOffsetSec = (playheadMs: number): number => {
    const offsetMs = Math.max(0, playheadMs - activeStartRef.current);
    const segSpanMs = Math.max(1, activeEndRef.current - activeStartRef.current);
    if (offsetMs > segSpanMs + 80) return 0;
    return offsetMs / 1000;
  };

  const seekToTimeline = (audio: HTMLMediaElement, playheadMs: number): void => {
    if (!isAudioSrcCurrent(audio)) return;
    const offsetSec = timelineOffsetSec(playheadMs);
    try {
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        if (Math.abs(audio.currentTime - offsetSec) < SEEK_EPSILON_SEC) return;
        audio.currentTime = offsetSec;
      }
    } catch {
      /* noop */
    }
  };

  const releaseDrive = (): void => {
    onPlayheadDriveMsRef.current?.(null);
  };

  const clearSegmentSession = (): void => {
    handledSegmentEnterStartRef.current = null;
    primedForStartMsRef.current = null;
    primingRef.current = false;
    latchClockRef.current = null;
    segmentFinalizedStartRef.current = null;
  };

  const releaseGapDriveIfNeeded = (): void => {
    const startMs = activeStartRef.current;
    if (gapDriveReleasedForStartRef.current === startMs) return;
    gapDriveReleasedForStartRef.current = startMs;
    if (latchedRef.current || playPendingRef.current) {
      latchedRef.current = false;
      playPendingRef.current = false;
      latchClockRef.current = null;
    }
    releaseDrive();
  };

  const finalizeActiveSegment = (audio: HTMLMediaElement): void => {
    const startMs = activeStartRef.current;
    if (segmentFinalizedStartRef.current === startMs) return;
    segmentFinalizedStartRef.current = startMs;
    playPendingRef.current = false;
    setPendingStart(false);
    latchedRef.current = false;
    latchClockRef.current = null;
    try {
      audio.pause();
    } catch {
      /* noop */
    }
    setLoading(false);
    releaseDrive();
    onSegmentEndedRef.current?.();
  };

  const anchorLatchClock = (localMs: number): void => {
    latchClockRef.current = { wallAt: performance.now(), localAt: localMs };
  };

  const resolveLatchedLocalMs = (audio: HTMLMediaElement): number => {
    const audioMs = activeStartRef.current + audio.currentTime * 1000;
    const anchor = latchClockRef.current;
    if (!anchor || audio.paused || audio.ended) return audioMs;

    const predicted =
      anchor.localAt + (performance.now() - anchor.wallAt) * Math.max(0.1, playbackRateRef.current);
    const drift = audioMs - predicted;

    if (drift > LATCH_AUDIO_JUMP_MS) {
      anchorLatchClock(audioMs);
      return audioMs;
    }
    if (drift < -LATCH_AUDIO_STALL_MS) {
      // Audio lags (network drop / start delay): re-anchor to the audio position and freeze the playhead until the audio
      // recovers — no longer using the wall-clock prediction forever (which accumulated a lead and eventually cut off narration audio
      // still playing at the segment end). Visual pausing buys complete narration, consistent with the canvas BGM.
      anchorLatchClock(audioMs);
      return audioMs;
    }
    return audioMs;
  };

  const handleSegmentEnter = (audio: HTMLMediaElement, reason: string): void => {
    const startMs = activeStartRef.current;
    if (handledSegmentEnterStartRef.current === startMs) return;
    handledSegmentEnterStartRef.current = startMs;
    ensureSegmentPlayback(audio, reason);
  };

  const primeAudioIfNeeded = (audio: HTMLMediaElement): void => {
    if (primingRef.current || playPendingRef.current || latchedRef.current) return;
    if (
      !isPlayingRef.current ||
      (!isNarrationPlaybackSrcReady(loadedSrcRef.current) &&
        !isNarrationSegmentPreloaded(loadedCanonicalSrcRef.current))
    )
      return;
    if (!isAudioSrcCurrent(audio)) return;
    const playheadMs = resolvePlayheadMs();
    if (!isBeforeSegment(playheadMs)) return;
    const startMs = activeStartRef.current;
    if (primedForStartMsRef.current === startMs) return;

    primingRef.current = true;
    primedForStartMsRef.current = startMs;
    const targetVolume = clamp(volumeMultiplierRef.current, 0, 1);
    const canonical = loadedCanonicalSrcRef.current || activeCanonicalSrcRef.current;

    const finishPrime = (): void => {
      primingRef.current = false;
      audio.volume = targetVolume;
      if (!isPlayingRef.current || !isBeforeSegment(resolvePlayheadMs())) return;
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        /* noop */
      }
    };

    try {
      audio.currentTime = 0;
      audio.volume = 0;
      const startDecode = (): void => {
        syncAudioPlaybackSettings(audio, { volume: 0 });
        void audio
          .play()
          .then(() => {
            if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
              finishPrime();
              return;
            }
            const onBuffered = (): void => {
              audio.removeEventListener("canplaythrough", onBuffered);
              finishPrime();
            };
            audio.addEventListener("canplaythrough", onBuffered, { once: true });
          })
          .catch(() => {
            primingRef.current = false;
            primedForStartMsRef.current = null;
            audio.volume = targetVolume;
          });
      };

      if (isNarrationDecodeWarmed(canonical)) {
        startDecode();
      } else {
        void waitForNarrationDecodeWarm(canonical).then(startDecode);
      }
    } catch {
      primingRef.current = false;
      primedForStartMsRef.current = null;
      audio.volume = targetVolume;
    }
  };

  const driveFromAudio = (audio: HTMLMediaElement, reason: string): void => {
    if (!isAudioSrcCurrent(audio)) return;
    const audioMs = activeStartRef.current + audio.currentTime * 1000;

    if (!latchedRef.current || audio.paused || audio.ended) {
      onPlayheadDriveMsRef.current?.(audioMs);
      return;
    }

    if (reason !== "raf-tick") {
      anchorLatchClock(audioMs);
      onPlayheadDriveMsRef.current?.(audioMs);
      return;
    }

    let localMs = resolveLatchedLocalMs(audio);
    const endMs = activeEndRef.current;
    if (endMs > activeStartRef.current && localMs >= endMs) {
      if (!audio.ended && !audio.paused) {
        // The playhead reached the segment end but the audio hasn't finished naturally (accumulated start delay / stutter): pin it at the segment end
        // and wait for the audio ended (the ended event finalizes correctly), without pausing early and cutting the narration.
        anchorLatchClock(activeStartRef.current + audio.currentTime * 1000);
        onPlayheadDriveMsRef.current?.(Math.max(activeStartRef.current, endMs - 1));
        return;
      }
      localMs = endMs;
      onPlayheadDriveMsRef.current?.(localMs);
      finalizeActiveSegment(audio);
      return;
    }
    onPlayheadDriveMsRef.current?.(localMs);
  };

  const markLatchedAndPlaying = (audio: HTMLMediaElement, reason: string): void => {
    if (!isAudioSrcCurrent(audio) || audio.paused || audio.ended) return;
    if (latchedRef.current) {
      driveFromAudio(audio, "raf-tick");
      return;
    }
    latchedRef.current = true;
    playPendingRef.current = false;
    setPendingStart(false);
    setLoading(false);
    driveFromAudio(audio, reason);
  };

  const resetPlaybackState = (reason: string): void => {
    latchedRef.current = false;
    playPendingRef.current = false;
    setPendingStart(false);
    latchClockRef.current = null;
    if (reason === "scrub" || reason === "pause-effect" || reason === "src-change" || reason === "ended") {
      clearSegmentSession();
    }
  };

  const tryStartPlayback = (audio: HTMLMediaElement, reason: string): void => {
    if (!isPlayingRef.current || !activeSrc) {
      setPendingStart(false);
      setLoading(false);
      releaseDrive();
      return;
    }

    if (!isAudioSrcCurrent(audio)) {
      setPendingStart(false);
      return;
    }

    const playheadMs = resolvePlayheadMs();
    currentTimeRef.current = playheadMs;

    if (isBeforeSegment(playheadMs)) {
      setPendingStart(false);
      setLoading(false);
      releaseDrive();
      return;
    }

    if (isPastActiveSegment(playheadMs)) {
      setPendingStart(false);
      setLoading(false);
      releaseDrive();
      return;
    }

    if (audio.ended) {
      setPendingStart(false);
      return;
    }

    if (!latchedRef.current) {
      releaseDrive();
    }

    if (!isReadyToStart(audio)) {
      // Cold start wait: the segment audio isn't ready, so tell the scene clock to freeze and wait (instead of catching up frames and skipping the audio's beginning).
      setPendingStart(true);
      return;
    }

    // Reaching the readyState ≠ making sound: while play() is pending (decoding/network stall) the cold start
    // wait stays and the scene clock remains frozen; it is released when latching succeeds (inside markLatchedAndPlaying)
    // or play fails/aborts (the failure branches below).

    if (playPendingRef.current) return;

    if (!audio.paused && !audio.ended) {
      markLatchedAndPlaying(audio, `already-playing:${reason}`);
      return;
    }

    const offsetSec = timelineOffsetSec(playheadMs);
    const primedAtZero =
      primedForStartMsRef.current === activeStartRef.current &&
      audio.paused &&
      audio.currentTime < SEEK_EPSILON_SEC &&
      offsetSec < 0.15;

    if (!primedAtZero) {
      seekToTimeline(audio, playheadMs);
    }

    syncAudioPlaybackSettings(audio);
    playPendingRef.current = true;
    void audio
      .play()
      .then(() => {
        if (!isAudioSrcCurrent(audio)) {
          playPendingRef.current = false;
          setPendingStart(false);
          return;
        }
        if (audio.paused || audio.ended) {
          playPendingRef.current = false;
          setPendingStart(false);
          releaseDrive();
          return;
        }
        markLatchedAndPlaying(audio, `play-ok:${reason}`);
      })
      .catch(() => {
        playPendingRef.current = false;
        latchedRef.current = false;
        setPendingStart(false);
        releaseDrive();
      });
  };

  const ensureSegmentPlayback = (audio: HTMLMediaElement, reason: string): void => {
    if (!isAudioSrcCurrent(audio)) return;
    const playheadMs = resolvePlayheadMs();
    currentTimeRef.current = playheadMs;
    if (!isPlayingRef.current || !loadedSrcRef.current) return;
    if (isBeforeSegment(playheadMs)) {
      releaseDrive();
      return;
    }
    if (isPastActiveSegment(playheadMs) || audio.ended) return;
    if (latchedRef.current) return;
    if (!audio.paused && !audio.ended) {
      markLatchedAndPlaying(audio, `ensure-live:${reason}`);
      return;
    }
    if (playPendingRef.current) return;
    tryStartPlayback(audio, reason);
  };

  const bootstrapPlayback = (reason: string): void => {
    const audio = audioRef.current;
    if (!audio || !loadedSrcRef.current) return;
    ensureSegmentPlayback(audio, reason);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    syncAudioPlaybackSettings(audio);
  }, [audioRef, playbackRate, volumeMultiplier]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let cancelled = false;
    resetPlaybackState("active-src-effect");
    lastPlayheadMsRef.current = null;

    const maybeStartAfterSrcReady = (): void => {
      if (cancelled || !isAudioSrcCurrent(audio) || !isPlayingRef.current) return;
      if (isBeforeSegment(resolvePlayheadMs())) return;
      if (isReadyToStart(audio)) {
        tryStartPlayback(audio, "src-ready");
      }
    };

    const onCanPlay = (): void => {
      if (cancelled || !isAudioSrcCurrent(audio)) return;
      syncAudioPlaybackSettings(audio);
      if (primingRef.current) return;
      if (!isPlayingRef.current) return;
      if (latchedRef.current && !audio.paused) return;
      if (isBeforeSegment(resolvePlayheadMs())) return;
      tryStartPlayback(audio, "can-play");
    };
    const onPlaying = (): void => {
      if (!isPlayingRef.current || cancelled || !isAudioSrcCurrent(audio)) return;
      if (primingRef.current) return;
      if (latchedRef.current) return;
      if (playPendingRef.current) return;
      markLatchedAndPlaying(audio, "playing-event");
    };
    const onWaiting = (): void => {
      if (!isPlayingRef.current || !isAudioSrcCurrent(audio)) return;
      if (isBeforeSegment(resolvePlayheadMs())) return;
      if (isNarrationPlaybackSrcReady(loadedSrcRef.current) || isNarrationSegmentPreloaded(loadedCanonicalSrcRef.current)) {
        if (latchedRef.current && audio.paused) {
          syncAudioPlaybackSettings(audio);
          void audio.play().catch(() => {
            /* noop */
          });
        }
        return;
      }
      if (latchedRef.current) return;
      setLoading(true);
    };
    const onEnded = (): void => {
      if (!isAudioSrcCurrent(audio)) return;
      playPendingRef.current = false;
      setPendingStart(false);
      audio.pause();
      resetPlaybackState("ended");
      setLoading(false);
      segmentFinalizedStartRef.current = activeStartRef.current;
      releaseDrive();
      onSegmentEndedRef.current?.();
    };
    const onError = (): void => {
      if (!isAudioSrcCurrent(audio)) return;
      resetPlaybackState("error");
      setLoading(false);
      releaseDrive();
    };

    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    if (!activeSrc) {
      loadedSrcRef.current = "";
      loadedCanonicalSrcRef.current = "";
      setPendingStart(false);
      setLoading(false);
      releaseDrive();
      audio.pause();
      if (!isPlayingRef.current) {
        audio.removeAttribute("src");
        audio.load();
      }
      return () => {
        cancelled = true;
        audio.removeEventListener("canplay", onCanPlay);
        audio.removeEventListener("waiting", onWaiting);
        audio.removeEventListener("playing", onPlaying);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };
    }

    const canonical = activeCanonicalSrcRef.current;
    const playbackSrc = activeSrc.trim();
    const sameCanonical =
      canonical.length > 0 &&
      loadedCanonicalSrcRef.current.length > 0 &&
      narrationAudioUrlsEquivalent(loadedCanonicalSrcRef.current, canonical);

    const onLoadedMetadata = (): void => {
      if (cancelled || !isAudioSrcCurrent(audio)) return;
      syncAudioPlaybackSettings(audio);
    };

    if (!sameCanonical) {
      resetPlaybackState("src-change");
      clearSegmentSession();
      loadedCanonicalSrcRef.current = canonical;
      loadedSrcRef.current = playbackSrc;
      audio.pause();
      audio.crossOrigin = "anonymous";
      audio.src = playbackSrc;
      syncAudioPlaybackSettings(audio);
      audio.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
      if (!isNarrationPlaybackSrcReady(playbackSrc)) {
        audio.load();
      }
      queueMicrotask(maybeStartAfterSrcReady);
    } else {
      loadedCanonicalSrcRef.current = canonical;
      if (playbackSrc && playbackSrc !== loadedSrcRef.current) {
        loadedSrcRef.current = playbackSrc;
        audio.pause();
        audio.src = playbackSrc;
        syncAudioPlaybackSettings(audio);
        audio.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
        if (!isNarrationPlaybackSrcReady(playbackSrc)) {
          audio.load();
        }
      }
    }

    if (isPlayingRef.current) {
      const playheadMs = resolvePlayheadMs();
      if (isBeforeSegment(playheadMs)) {
        releaseGapDriveIfNeeded();
        queueMicrotask(() => {
          if (!cancelled && isAudioSrcCurrent(audio)) {
            primeAudioIfNeeded(audio);
          }
        });
      } else if (!isPastActiveSegment(playheadMs)) {
        if (sameCanonical && isReadyToStart(audio)) {
          tryStartPlayback(audio, "same-src");
        } else if (
          !sameCanonical &&
          isNarrationPlaybackSrcReady(playbackSrc) &&
          isReadyToStart(audio)
        ) {
          tryStartPlayback(audio, "new-src-preloaded");
        }
      }
    } else {
      seekToTimeline(audio, resolvePlayheadMs());
      setLoading(false);
      releaseDrive();
    }

    return () => {
      cancelled = true;
      setPendingStart(false);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [activeSrc, audioRef, playbackRate, volumeMultiplier]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!isPlaying) {
      resetPlaybackState("pause-effect");
      clearSegmentSession();
      setPendingStart(false);
      setLoading(false);
      releaseDrive();
      audio.pause();
      seekToTimeline(audio, resolvePlayheadMs());
      return;
    }

    if (isBeforeSegment(resolvePlayheadMs())) {
      primeAudioIfNeeded(audio);
    } else {
      bootstrapPlayback("is-playing");
    }
  }, [isPlaying, audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !loadedSrcRef.current) return;

    const playheadMs = resolvePlayheadMs();
    const previousMs = lastPlayheadMsRef.current;
    const jumped =
      previousMs !== null && Math.abs(playheadMs - previousMs) > PLAYHEAD_SCRUB_MS;
    lastPlayheadMsRef.current = playheadMs;
    currentTimeRef.current = playheadMs;

    if (jumped) {
      resetPlaybackState("scrub");
      releaseDrive();
      audio.pause();
      if (isAudioSrcCurrent(audio)) {
        seekToTimeline(audio, playheadMs);
        if (isPlayingRef.current && !isBeforeSegment(playheadMs)) {
          tryStartPlayback(audio, "scrub");
        }
      }
      return;
    }

    if (!isPlayingRef.current) {
      seekToTimeline(audio, playheadMs);
      return;
    }

    if (!isAudioSrcCurrent(audio)) return;

    // At normal speed rAF detects crossings; only non-ref clocks (paused scrub) fill gaps through state.
    if (!playheadFromRefRef.current) {
      // Went back before the segment start: clear the cold start wait (that segment's narration is no longer active),
      // so the editor doesn't freeze at the position before the segment for the whole timeout window.
      if (playheadMs < activeStartRef.current) setPendingStart(false);
      const justEntered = crossedSegmentStart(previousMs, playheadMs);
      if (justEntered) {
        handleSegmentEnter(audio, "segment-enter");
        return;
      }
      if (
        jumped &&
        !latchedRef.current &&
        isAtOrPastSegmentStart(playheadMs) &&
        !isPastActiveSegment(playheadMs) &&
        audio.paused &&
        !playPendingRef.current
      ) {
        ensureSegmentPlayback(audio, "scrub-in-segment");
      }
    }
  }, [currentTime, activeStartMs, activeEndMs, audioRef]);

  useEffect(() => {
    if (!isPlaying) {
      releaseDrive();
      return;
    }

    let raf = 0;
    let lastRafPlayheadMs: number | null = null;
    const tick = (): void => {
      const audio = audioRef.current;
      if (audio && isPlayingRef.current && loadedSrcRef.current && isAudioSrcCurrent(audio)) {
        const playheadMs = resolvePlayheadMs();
        const previousMs = lastRafPlayheadMs;
        lastRafPlayheadMs = playheadMs;
        currentTimeRef.current = playheadMs;

        if (isBeforeSegment(playheadMs)) {
          releaseGapDriveIfNeeded();
          primeAudioIfNeeded(audio);
        } else {
          gapDriveReleasedForStartRef.current = null;
          if (crossedSegmentStart(previousMs, playheadMs)) {
            handleSegmentEnter(audio, "segment-enter");
          } else if (
            !latchedRef.current &&
            isAtOrPastSegmentStart(playheadMs) &&
            !isPastActiveSegment(playheadMs) &&
            !audio.ended &&
            audio.paused &&
            !playPendingRef.current
          ) {
            tryStartPlayback(audio, "raf-retry");
          } else if (!audio.paused && !audio.ended && latchedRef.current) {
            driveFromAudio(audio, "raf-tick");
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [isPlaying, activeSrc, activeStartMs, audioRef]);
}
