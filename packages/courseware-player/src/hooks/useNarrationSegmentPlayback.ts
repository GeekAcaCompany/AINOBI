// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { NarrationElement } from "@ainobi/courseware-core/elements.ts";
import { readHtmlMediaDurationMs, measureNarrationAudioDurationMs } from "../lib/courseware/narration-audio-duration.ts";
import {
  preloadNarrationSegmentUrls,
  resolveNarrationSegmentPlaybackUrl,
} from "../lib/courseware/narration-preload.ts";
import {
  resolveNarrationSegments,
  resolveNarrationSegmentsForHyperframes,
  findNarrationSegmentIndexAtTime,
  resolveActiveNarrationSegmentIndex,
  syncCommittedIndexFromTime,
  type ResolvedNarrationSegment,
} from "../lib/courseware/narration-segments.ts";
import { setNarrationPendingStart } from "../lib/courseware/narration-pending-start.ts";
import { useSyncedNarrationAudio } from "./useSyncedNarrationAudio.ts";

const SCRUB_MS = 250;

export interface UseNarrationSegmentPlaybackParams {
  element: NarrationElement;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  volumeMultiplier?: number;
  playheadRef?: RefObject<number>;
  playheadFromRef?: boolean;
  onPlaybackLoadingChange?: (isLoading: boolean) => void;
  onSlideAdvanceGateChange?: (elementId: string, blocking: boolean) => void;
  /** In-segment audio drives the playhead (slide-local ms); null hands it back to the wall clock. */
  onPlayheadDriveChange?: (localMs: number | null) => void;
  /** Headless rendering: the narration duration table shared with the Hyperframes declaration. */
  externalMeasuredDurationByUrl?: Readonly<Record<string, number>>;
  /** Headless rendering: a timeline with segments end to end, without gaps between segments. */
  useHyperframesNarrationLayout?: boolean;
}

export interface UseNarrationSegmentPlaybackResult {
  audioRef: RefObject<HTMLAudioElement | null>;
  resolved: ResolvedNarrationSegment[];
  activeSegment: ResolvedNarrationSegment | null;
  /** For subtitle display: the segment at the current timeline position first, falling back to the committed segment inside gaps. */
  displaySegment: ResolvedNarrationSegment | null;
  activeIndex: number;
}

/**
 * Narration segment playback: timeline-synced segment index + audio-driven timeline + full preloading.
 */
export function useNarrationSegmentPlayback(
  params: UseNarrationSegmentPlaybackParams,
): UseNarrationSegmentPlaybackResult {
  const {
    element,
    currentTime,
    isPlaying,
    playbackRate,
    volumeMultiplier = 1,
    playheadRef,
    playheadFromRef = false,
    onPlaybackLoadingChange,
    onSlideAdvanceGateChange,
    onPlayheadDriveChange,
    externalMeasuredDurationByUrl = {},
    useHyperframesNarrationLayout = false,
  } = params;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const lastTimeRef = useRef(currentTime);
  const slideAdvanceGateRef = useRef(false);
  const segmentEndGuardStartRef = useRef<number | null>(null);
  const prevTimelineMsRef = useRef(currentTime);
  const [measuredDurationByUrl, setMeasuredDurationByUrl] = useState<Record<string, number>>({});

  isPlayingRef.current = isPlaying;

  const resolved = useMemo(() => {
    const mergedMeasured = { ...measuredDurationByUrl, ...externalMeasuredDurationByUrl };
    return useHyperframesNarrationLayout
      ? resolveNarrationSegmentsForHyperframes(element, mergedMeasured)
      : resolveNarrationSegments(element, mergedMeasured);
  }, [element, externalMeasuredDurationByUrl, measuredDurationByUrl, useHyperframesNarrationLayout]);

  const resolveTimelineMs = useCallback((): number => {
    let ms: number;
    if (playheadFromRef && playheadRef?.current != null) {
      ms = playheadRef.current;
    } else {
      ms = currentTime;
    }
    return Math.max(0, ms);
  }, [currentTime, playheadFromRef, playheadRef]);

  const timelineMs = resolveTimelineMs();

  // Derived synchronously from the playhead every frame, so after a scrub the effect isn't still stuck on the old segment a frame late (e.g. committed=3 at 0s).
  const committedIndex = syncCommittedIndexFromTime(resolved, timelineMs);
  const activeIndex = resolveActiveNarrationSegmentIndex(
    resolved,
    timelineMs,
    isPlaying,
    committedIndex,
  );

  const activeSegment = activeIndex >= 0 ? (resolved[activeIndex] ?? null) : null;
  const displaySegment = useMemo(() => {
    const at = findNarrationSegmentIndexAtTime(resolved, timelineMs);
    if (at >= 0) return resolved[at] ?? null;
    if (activeSegment) return activeSegment;
    if (committedIndex >= 0 && committedIndex < resolved.length) {
      return resolved[committedIndex] ?? null;
    }
    return null;
  }, [activeSegment, committedIndex, resolved, timelineMs]);
  const activeStart = activeSegment?.startMs ?? 0;
  const activeEnd = activeSegment?.endMs ?? activeStart;
  const activePlaybackSrc = activeSegment?.audio_url
    ? useHyperframesNarrationLayout
      ? activeSegment.audio_url.trim()
      : resolveNarrationSegmentPlaybackUrl(activeSegment.audio_url)
    : "";

  useEffect(() => {
    if (useHyperframesNarrationLayout) return;
    preloadNarrationSegmentUrls(resolved.map((seg) => seg.audio_url));
  }, [resolved, useHyperframesNarrationLayout]);

  useEffect(() => {
    lastTimeRef.current = 0;
    segmentEndGuardStartRef.current = null;
    setMeasuredDurationByUrl({});
  }, [element.element_id]);

  useEffect(() => {
    const delta = Math.abs(timelineMs - lastTimeRef.current);
    if (delta > SCRUB_MS) {
      segmentEndGuardStartRef.current = null;
    }
    lastTimeRef.current = timelineMs;
  }, [timelineMs]);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      for (const seg of element.segments) {
        const url = seg.audio_url.trim();
        if (!url) continue;
        const ms = await measureNarrationAudioDurationMs(url);
        if (cancelled || ms <= 0) continue;
        setMeasuredDurationByUrl((prev) => {
          const prevMs = prev[url] ?? 0;
          if (ms <= prevMs) return prev;
          return { ...prev, [url]: ms };
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [element.element_id, element.segments]);

  const recordMeasuredDuration = useCallback((audioUrl: string, durationMs: number): void => {
    const key = audioUrl.trim();
    if (!key || durationMs <= 0) return;
    setMeasuredDurationByUrl((prev) => {
      const prevMs = prev[key] ?? 0;
      if (durationMs <= prevMs) return prev;
      return { ...prev, [key]: durationMs };
    });
  }, []);

  const publishSlideAdvanceGate = useCallback(
    (blocking: boolean): void => {
      if (!onSlideAdvanceGateChange || blocking === slideAdvanceGateRef.current) return;
      slideAdvanceGateRef.current = blocking;
      onSlideAdvanceGateChange(element.element_id, blocking);
    },
    [element.element_id, onSlideAdvanceGateChange],
  );

  const handleSegmentEnded = useCallback((): void => {
    const startMs = activeStart;
    if (segmentEndGuardStartRef.current === startMs) return;
    segmentEndGuardStartRef.current = startMs;
    publishSlideAdvanceGate(false);
    onPlayheadDriveChange?.(null);
  }, [activeStart, onPlayheadDriveChange, publishSlideAdvanceGate]);

  /** When wall-clock interpolation passes the segment end, the audio ended may not have fired yet, so the drive must be released actively. */
  useEffect(() => {
    const prev = prevTimelineMsRef.current;
    prevTimelineMsRef.current = timelineMs;
    if (!isPlaying || prev === timelineMs) return;

    for (let i = 0; i < resolved.length; i++) {
      const seg = resolved[i];
      if (prev < seg.endMs && timelineMs >= seg.endMs) {
        if (segmentEndGuardStartRef.current === seg.startMs) continue;
        segmentEndGuardStartRef.current = seg.startMs;
        publishSlideAdvanceGate(false);
        onPlayheadDriveChange?.(null);
      }
    }
  }, [isPlaying, onPlayheadDriveChange, publishSlideAdvanceGate, resolved, timelineMs]);

  const handlePlayheadDrive = useCallback(
    (localMs: number | null): void => {
      const blocking =
        localMs !== null && localMs >= activeStart && localMs < activeEnd;
      publishSlideAdvanceGate(blocking);
      onPlayheadDriveChange?.(localMs);
    },
    [activeEnd, activeStart, onPlayheadDriveChange, publishSlideAdvanceGate],
  );

  const handleBuffering = useCallback(
    (loading: boolean) => {
      onPlaybackLoadingChange?.(loading);
    },
    [onPlaybackLoadingChange],
  );

  useSyncedNarrationAudio({
    audioRef,
    activeSrc: activePlaybackSrc,
    activeCanonicalSrc: activeSegment?.audio_url ?? "",
    activeStartMs: activeStart,
    activeEndMs: activeEnd,
    currentTime,
    isPlaying,
    playbackRate,
    volumeMultiplier,
    playheadRef,
    playheadFromRef,
    onBufferingChange: handleBuffering,
    onSegmentEnded: handleSegmentEnded,
    onPlayheadDriveMs: handlePlayheadDrive,
  });

  useEffect(() => {
    const audio = audioRef.current;
    const src = activeSegment?.audio_url ?? "";
    if (!audio || !src) return;

    const onMeta = (): void => {
      const ms = readHtmlMediaDurationMs(audio);
      if (ms > 0) recordMeasuredDuration(src, ms);
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) onMeta();
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
    };
  }, [activeSegment?.audio_url, recordMeasuredDuration]);

  useEffect(() => {
    if (!isPlaying) {
      publishSlideAdvanceGate(false);
    }
  }, [isPlaying, publishSlideAdvanceGate]);

  useEffect(() => {
    return () => {
      if (slideAdvanceGateRef.current) {
        slideAdvanceGateRef.current = false;
        onSlideAdvanceGateChange?.(element.element_id, false);
      }
      onPlayheadDriveChange?.(null);
    };
  }, [element.element_id, onPlayheadDriveChange, onSlideAdvanceGateChange]);

  return {
    audioRef,
    resolved,
    activeSegment,
    displaySegment,
    activeIndex,
  };
}
