// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState, type RefObject } from "react";
import type { AudioElement } from "../../lib/courseware/index.ts";
import { getCanvasAudioPlaybackRate } from "../../lib/courseware/index.ts";
import { usePlaybackPlayheadMs } from "../../hooks/usePlaybackPlayheadMs.ts";
import { useSyncedCanvasAudioElement } from "../../hooks/useSyncedCanvasAudioElement.ts";
import coursewareAssetsApi from "../../api/courseware_assets.ts";

const fallbackPlayheadRef: RefObject<number> = { current: 0 };

export interface GlobalAudioTracksProps {
  /** Scene-level audio_elements list. */
  tracks: AudioElement[];
  /**
   * Courseware context id — required to presign private bucket prefixes such as `raw/`. When missing nothing is signed,
   * and source plays as-is (compatible with old callers and purely public bucket cases).
   */
  coursewareId?: string;
  /** Current scene-relative time in milliseconds (used when `playheadRef` is omitted). */
  sceneCurrentTime: number;
  /** Added to slide-local playhead when using `playheadRef` (previous slides' durations). */
  sceneTimeOffsetMs?: number;
  /** While playing, subscribe to the clock from a ref, avoiding a 60fps setState in the host. */
  playheadRef?: RefObject<number>;
  playheadFromRef?: boolean;
  playheadClockRunning?: boolean;
  /** Slide-local paused time when not reading from ref. */
  pausedSceneTimeMs?: number;
  /** Whether playback is currently active. */
  isPlaying: boolean;
  /**
   * User intends the timeline to run (do not gate on load-mutex / `isPlaybackLoading`).
   * When omitted, defaults to `isPlaying` (legacy behavior).
   */
  playIntent?: boolean;
  /** Fired when a track is waiting on network/decode so the host can pause timeline advance. */
  onTrackBufferingChange?: (elementId: string, buffering: boolean) => void;
  /** Optional playback rate multiplier. Defaults to 1. */
  rate?: number;
  /** Host master volume (0–1), multiplied with each track's `volume`. */
  volumeMultiplier?: number;
}

/**
 * Renders one hidden <audio> element per scene-wide audio track and keeps each
 * one synchronized with the scene-relative playback time, applying linear
 * fade-in / fade-out around each track's [start_at, end_at] window.
 *
 * Designed to be mounted both in the editor (single-slide playback) and the
 * preview player (full-scene playback): all timing math happens in scene time.
 */
export function GlobalAudioTracks({
  tracks,
  coursewareId,
  sceneCurrentTime,
  sceneTimeOffsetMs = 0,
  playheadRef,
  playheadFromRef = false,
  playheadClockRunning = false,
  pausedSceneTimeMs,
  isPlaying,
  playIntent,
  onTrackBufferingChange,
  rate = 1,
  volumeMultiplier = 1,
}: GlobalAudioTracksProps) {
  const useRefClock = playheadRef != null;
  const pausedMs = pausedSceneTimeMs ?? sceneCurrentTime - sceneTimeOffsetMs;
  const refForHook = playheadRef ?? fallbackPlayheadRef;
  const localMs = usePlaybackPlayheadMs(
    useRefClock && playheadFromRef,
    useRefClock && playheadClockRunning,
    pausedMs,
    refForHook,
  );
  const resolvedSceneCurrentTime = useRefClock
    ? sceneTimeOffsetMs + localMs
    : sceneCurrentTime;

  // After the bucket went private, old absolute URLs left in audio sources (OCI compat/aliyun) can't be read anonymously
  // → presign them in bulk and rewrite to signed URLs (the same strategy as CoursewareHtmlStageEmbed).
  // On failure / with presign off they stay as-is (left to the browser's onerror fallback).
  const sourcesSignature = useMemo(
    () => tracks.map((t) => t.source).join("\n"),
    [tracks],
  );
  const [signedByOriginal, setSignedByOriginal] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    const sources = Array.from(new Set(sourcesSignature.split("\n")).values()).filter(
      Boolean,
    );
    if (sources.length === 0) {
      setSignedByOriginal({});
      return;
    }
    let cancelled = false;
    coursewareAssetsApi
      .batchPresignUrls(coursewareId, sources)
      .then((map) => {
        if (!cancelled) setSignedByOriginal(map ?? {});
      })
      .catch(() => {
        if (!cancelled) setSignedByOriginal({});
      });
    return () => {
      cancelled = true;
    };
  }, [sourcesSignature, coursewareId]);

  if (tracks.length === 0) return null;
  return (
    <GlobalAudioTracksList
      tracks={tracks}
      signedByOriginal={signedByOriginal}
      resolvedSceneCurrentTime={resolvedSceneCurrentTime}
      isPlaying={isPlaying}
      playIntent={playIntent}
      onTrackBufferingChange={onTrackBufferingChange}
      rate={rate}
      volumeMultiplier={volumeMultiplier}
    />
  );
}

function GlobalAudioTracksList({
  tracks,
  signedByOriginal,
  resolvedSceneCurrentTime,
  isPlaying,
  playIntent,
  onTrackBufferingChange,
  rate,
  volumeMultiplier,
}: {
  tracks: AudioElement[];
  signedByOriginal: Record<string, string>;
  resolvedSceneCurrentTime: number;
  isPlaying: boolean;
  playIntent?: boolean;
  onTrackBufferingChange?: (elementId: string, buffering: boolean) => void;
  rate: number;
  volumeMultiplier: number;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden">
      {tracks
        .filter((t) => !!t.source)
        .map((track) => (
          <GlobalAudioTrack
            key={track.element_id}
            track={track}
            srcOverride={signedByOriginal[track.source]}
            sceneCurrentTime={resolvedSceneCurrentTime}
            isPlaying={isPlaying}
            playIntent={playIntent}
            onTrackBufferingChange={onTrackBufferingChange}
            rate={rate}
            volumeMultiplier={volumeMultiplier}
          />
        ))}
    </div>
  );
}

interface GlobalAudioTrackProps {
  track: AudioElement;
  /** Signed playback URL after the bulk presign; falls back to track.source when unsigned. */
  srcOverride?: string;
  sceneCurrentTime: number;
  isPlaying: boolean;
  playIntent?: boolean;
  onTrackBufferingChange?: (elementId: string, buffering: boolean) => void;
  rate: number;
  volumeMultiplier: number;
}

function GlobalAudioTrack({
  track,
  srcOverride,
  sceneCurrentTime,
  isPlaying,
  playIntent,
  onTrackBufferingChange,
  rate,
  volumeMultiplier,
}: GlobalAudioTrackProps) {
  const audioRef = useSyncedCanvasAudioElement({
    track,
    sceneCurrentTime,
    isPlaying,
    playIntent,
    onBufferingChange: onTrackBufferingChange
      ? (buffering) => onTrackBufferingChange(track.element_id, buffering)
      : undefined,
    rate: rate * getCanvasAudioPlaybackRate(track),
    volumeMultiplier,
  });
  return (
    <audio
      ref={audioRef}
      src={srcOverride ?? track.source}
      loop={track.loop}
      preload="auto"
      playsInline
    />
  );
}
