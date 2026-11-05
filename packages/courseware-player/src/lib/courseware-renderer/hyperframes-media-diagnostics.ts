// SPDX-License-Identifier: AGPL-3.0-only
/** Structured Hyperframes media diagnostics — surfaced in headless browser logs for render triage. */

import type { Scene } from "../courseware/index.ts";
import { probeUrlFetchableWithRetry } from "../courseware/oss-internal-reachability-probe.ts";
import type { HyperframesAudioDeclaration } from "./hyperframes-media-declarations.ts";
import {
  getHyperframesSceneSlideOffsetMs,
  getHyperframesSceneTotalDurationMs,
  getHyperframesSlidePlaybackDurationMs,
  getSlideNarrationEndMs,
  getSlidePlaybackDurationMs,
} from "./playback-timing.ts";

export type HyperframesMediaSkipReason =
  | "missing_src"
  | "invalid_timeline"
  | "duplicate_id"
  | "narration_no_audio_url"
  | "narration_zero_duration"
  | "narration_invalid_timeline";

export interface HyperframesMediaSkipEvent {
  kind: "audio" | "video_audio" | "narration";
  reason: HyperframesMediaSkipReason;
  id?: string;
  slideId?: string;
  slideIndex?: number;
  narrationId?: string;
  segmentIndex?: number;
  detail?: string;
  /** When reason is duplicate_id: the track already registered under this id. */
  collidedWithId?: string;
  srcTail?: string;
  startSec?: number;
  endSec?: number;
}

export interface HyperframesNarrationSegmentDiag {
  segmentIndex: number;
  startMs: number;
  endMs: number;
  storedDurationMs: number;
  measuredDurationMs: number;
  effectiveDurationMs: number;
  srcTail: string;
  declaredId: string;
  declared: boolean;
}

export interface HyperframesNarrationDiag {
  slideIndex: number;
  slideId: string;
  narrationId: string;
  rawSegmentCount: number;
  resolvedSegmentCount: number;
  segments: HyperframesNarrationSegmentDiag[];
}

export interface HyperframesMediaDiagnostics {
  declaredAudioCount: number;
  declaredVideoAudioCount: number;
  skippedCount: number;
  narrationDeclaredCount: number;
  narrationRawSegmentCount: number;
  narrationResolvedSegmentCount: number;
  skipped: HyperframesMediaSkipEvent[];
  narrations: HyperframesNarrationDiag[];
}

export interface HyperframesNarrationMeasureDiag {
  urlTail: string;
  durationMs: number;
  ok: boolean;
}

export interface HyperframesNarrationFetchDiag {
  url: string;
  urlTail: string;
  ok: boolean;
  status?: number;
  error?: string;
  attemptsUsed?: number;
  /** Matching Hyperframes `<audio id>` when known. */
  declaredIds?: string[];
}

export interface HyperframesTimelineSlideDiag {
  slideIndex: number;
  slideId: string;
  timelineDurationMs: number;
  narrationEndMs: number;
  playbackDurationMs: number;
  sceneOffsetMs: number;
  overflowMs: number;
}

export interface HyperframesDomAudioDiag {
  id: string;
  dataStart: number | null;
  dataEnd: number | null;
  expectedStart: number;
  expectedEnd: number;
  startDeltaMs: number | null;
  endDeltaMs: number | null;
  missing: boolean;
  srcTail: string;
}

const HF_MEDIA_LOG_PREFIX = "[hf-media]";

export const tailUrlForDiag = (url: string, maxLen = 72): string => {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLen) return trimmed;
  return `…${trimmed.slice(-maxLen)}`;
};

export const emptyHyperframesMediaDiagnostics = (): HyperframesMediaDiagnostics => ({
  declaredAudioCount: 0,
  declaredVideoAudioCount: 0,
  skippedCount: 0,
  narrationDeclaredCount: 0,
  narrationRawSegmentCount: 0,
  narrationResolvedSegmentCount: 0,
  skipped: [],
  narrations: [],
});

const logJson = (tag: string, payload: unknown): void => {
  if (typeof console === "undefined") return;
  try {
    console.info(`${HF_MEDIA_LOG_PREFIX}${tag}`, JSON.stringify(payload));
  } catch {
    console.info(`${HF_MEDIA_LOG_PREFIX}${tag}`, payload);
  }
};

export const logHyperframesNarrationMeasurement = (
  results: readonly HyperframesNarrationMeasureDiag[],
): void => {
  const failed = results.filter((r) => !r.ok);
  logJson(":measure", {
    total: results.length,
    measured: results.filter((r) => r.ok).length,
    failed: failed.length,
    failedUrls: failed.map((r) => ({ urlTail: r.urlTail, durationMs: r.durationMs })),
    durations: results.map((r) => ({ urlTail: r.urlTail, durationMs: r.durationMs, ok: r.ok })),
  });
};

/**
 * GET every narration URL (same as the Hyperframes producer's `downloadToTemp`), to tell apart
 * silent segments in the output caused by "metadata measurable but the FFmpeg fetch failed".
 * Retries by default, to cover occasional OSS ERR_CONNECTION_CLOSED.
 */
export async function verifyNarrationUrlsForMux(
  urls: readonly string[],
  probe: (
    url: string,
  ) => Promise<boolean | { ok: boolean; attemptsUsed?: number }> = (url) =>
    probeUrlFetchableWithRetry(url),
): Promise<HyperframesNarrationFetchDiag[]> {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  return Promise.all(
    unique.map(async (url) => {
      const urlTail = tailUrlForDiag(url);
      try {
        const result = await probe(url);
        if (typeof result === "boolean") {
          return { url, urlTail, ok: result, attemptsUsed: 1 };
        }
        return {
          url,
          urlTail,
          ok: result.ok,
          attemptsUsed: result.attemptsUsed ?? 1,
        };
      } catch (error) {
        return {
          url,
          urlTail,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export const logHyperframesNarrationFetchVerification = (
  results: readonly HyperframesNarrationFetchDiag[],
  audios?: readonly HyperframesAudioDeclaration[],
): void => {
  const enriched = results.map((row) => {
    const declaredIds = audios
      ?.filter((track) => track.src.trim() === row.url)
      .map((track) => track.id);
    return declaredIds?.length ? { ...row, declaredIds } : row;
  });

  const failed = enriched.filter((r) => !r.ok);
  logJson(":fetch", {
    total: enriched.length,
    ok: enriched.filter((r) => r.ok).length,
    failed: failed.length,
    failedTracks: failed,
    tracks: enriched,
  });
  if (failed.length > 0) {
    console.warn(
      `${HF_MEDIA_LOG_PREFIX}:warn`,
      `${failed.length} narration URL(s) failed producer-style GET — FFmpeg mux may drop those tracks (silent TTS).`,
      failed.map((r) => r.declaredIds?.join(", ") ?? r.urlTail).join("; "),
    );
  }
};

export const logHyperframesMediaDiagnostics = (diagnostics: HyperframesMediaDiagnostics): void => {
  const duplicateSkips = diagnostics.skipped.filter((s) => s.reason === "duplicate_id");
  const narrationUndeclared = diagnostics.narrations.flatMap((n) =>
    n.segments.filter((s) => !s.declared),
  );

  logJson(":summary", {
    declaredAudioCount: diagnostics.declaredAudioCount,
    declaredVideoAudioCount: diagnostics.declaredVideoAudioCount,
    narrationDeclaredCount: diagnostics.narrationDeclaredCount,
    narrationRawSegmentCount: diagnostics.narrationRawSegmentCount,
    narrationResolvedSegmentCount: diagnostics.narrationResolvedSegmentCount,
    skippedCount: diagnostics.skippedCount,
    duplicateIdSkips: duplicateSkips.length,
    undeclaredNarrationSegments: narrationUndeclared.length,
  });

  if (diagnostics.skipped.length > 0) {
    logJson(":skipped", diagnostics.skipped);
  }

  if (diagnostics.narrations.length > 0) {
    logJson(":narrations", diagnostics.narrations);
  }

  if (duplicateSkips.length > 0 || narrationUndeclared.length > 0) {
    console.warn(
      `${HF_MEDIA_LOG_PREFIX}:warn`,
      duplicateSkips.length > 0
        ? `${duplicateSkips.length} audio track(s) dropped due to duplicate HTML id — lip sync may still run per React tree while FFmpeg mux only keeps one <audio>.`
        : "",
      narrationUndeclared.length > 0
        ? `${narrationUndeclared.length} narration segment(s) resolved for lip sync but not declared for mux.`
        : "",
    );
  }
};

export const buildHyperframesTimelineDiagnostics = (
  scene: Scene,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): HyperframesTimelineSlideDiag[] =>
  scene.slide_elements.map((slide, slideIndex) => {
    const timelineDurationMs = getSlidePlaybackDurationMs(slide);
    const narrationEndMs = getSlideNarrationEndMs(slide, measuredNarrationDurationByUrl);
    const playbackDurationMs = getHyperframesSlidePlaybackDurationMs(
      slide,
      measuredNarrationDurationByUrl,
    );
    return {
      slideIndex,
      slideId: slide.element_id,
      timelineDurationMs,
      narrationEndMs,
      playbackDurationMs,
      sceneOffsetMs: getHyperframesSceneSlideOffsetMs(
        scene.slide_elements,
        slideIndex,
        measuredNarrationDurationByUrl,
      ),
      overflowMs: Math.max(0, narrationEndMs - timelineDurationMs),
    };
  });

export const logHyperframesTimelineDiagnostics = (
  scene: Scene,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): void => {
  const slides = buildHyperframesTimelineDiagnostics(scene, measuredNarrationDurationByUrl);
  const sceneTotalDurationMs = getHyperframesSceneTotalDurationMs(
    scene.slide_elements,
    measuredNarrationDurationByUrl,
  );
  const timelineOnlyDurationMs = scene.slide_elements.reduce(
    (acc, slide) => acc + getSlidePlaybackDurationMs(slide),
    0,
  );
  logJson(":timeline", {
    sceneTotalDurationMs,
    timelineOnlyDurationMs,
    extendedByMs: Math.max(0, sceneTotalDurationMs - timelineOnlyDurationMs),
    slides,
    overflowSlides: slides.filter((slide) => slide.overflowMs > 0).length,
  });
  if (slides.some((slide) => slide.overflowMs > 0)) {
    console.warn(
      `${HF_MEDIA_LOG_PREFIX}:warn`,
      "narration extends past slide.timeline on",
      slides.filter((slide) => slide.overflowMs > 0).length,
      "slide(s); Hyperframes seek/mux uses narration-extended slide durations.",
    );
  }
};

const parseDomSec = (value: string | null): number | null => {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const collectHyperframesDomAudioDiagnostics = (
  expectedAudios: readonly HyperframesAudioDeclaration[],
): HyperframesDomAudioDiag[] => {
  if (typeof document === "undefined") return [];
  return expectedAudios.map((track) => {
    const el = document.getElementById(track.id) as HTMLAudioElement | null;
    const dataStart = parseDomSec(el?.getAttribute("data-start") ?? null);
    const dataEnd = parseDomSec(el?.getAttribute("data-end") ?? null);
    return {
      id: track.id,
      dataStart,
      dataEnd,
      expectedStart: track.startSec,
      expectedEnd: track.endSec,
      startDeltaMs:
        dataStart == null ? null : Math.round((dataStart - track.startSec) * 1000),
      endDeltaMs: dataEnd == null ? null : Math.round((dataEnd - track.endSec) * 1000),
      missing: !el,
      srcTail: tailUrlForDiag(el?.getAttribute("src") ?? track.src),
    };
  });
};

export const isHyperframesMediaDomReady = (
  expectedAudios: readonly HyperframesAudioDeclaration[],
  toleranceMs = 2,
): boolean => {
  const rows = collectHyperframesDomAudioDiagnostics(expectedAudios);
  if (rows.length === 0) return true;
  return rows.every((row) => {
    if (row.missing || row.dataStart == null || row.dataEnd == null) return false;
    const startOk = Math.abs(row.startDeltaMs ?? Infinity) <= toleranceMs;
    const endOk = Math.abs(row.endDeltaMs ?? Infinity) <= toleranceMs;
    return startOk && endOk;
  });
};

export const logHyperframesDomAudioDiagnostics = (
  expectedAudios: readonly HyperframesAudioDeclaration[],
): void => {
  const rows = collectHyperframesDomAudioDiagnostics(expectedAudios);
  const mismatched = rows.filter(
    (row) =>
      row.missing ||
      row.dataStart == null ||
      row.dataEnd == null ||
      Math.abs(row.startDeltaMs ?? Infinity) > 2 ||
      Math.abs(row.endDeltaMs ?? Infinity) > 2,
  );
  logJson(":dom", {
    expectedCount: rows.length,
    missingCount: rows.filter((row) => row.missing).length,
    mismatchedCount: mismatched.length,
    ready: mismatched.length === 0,
    tracks: rows,
  });
  if (mismatched.length > 0) {
    console.warn(
      `${HF_MEDIA_LOG_PREFIX}:warn`,
      `${mismatched.length} <audio> declaration(s) missing or data-start/data-end mismatch vs React state — FFmpeg mux may use stale windows.`,
    );
  }
};
