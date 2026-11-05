// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AudioElement,
  Element,
  GroupElement,
  HtmlElement,
  NarrationElement,
  Scene,
  SlideElement,
  VideoElement,
} from "../courseware/index.ts";
import { collectSlideCanvasAudioElementsForMixer } from "@ainobi/courseware-core/slide-canvas-audio.ts";
import {
  lookupMeasuredNarrationDurationMs,
  resolveNarrationSegmentsForHyperframes,
} from "../courseware/narration-segments.ts";

import {
  emptyHyperframesMediaDiagnostics,
  tailUrlForDiag,
  type HyperframesMediaDiagnostics,
  type HyperframesMediaSkipEvent,
  type HyperframesNarrationDiag,
} from "./hyperframes-media-diagnostics.ts";
import { getHyperframesSceneSlideOffsetMs } from "./playback-timing.ts";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export interface HyperframesAudioDeclaration {
  id: string;
  src: string;
  startSec: number;
  endSec: number;
  volume: number;
  mediaStartSec?: number;
  loop?: boolean;
}

export interface HyperframesVideoAudioDeclaration {
  id: string;
  src: string;
  startSec: number;
  endSec: number;
  volume: number;
  loop?: boolean;
}

export interface HyperframesMediaDeclarations {
  audios: HyperframesAudioDeclaration[];
  videoAudios: HyperframesVideoAudioDeclaration[];
  diagnostics: HyperframesMediaDiagnostics;
}

function walkSlideElements(slide: SlideElement, visit: (element: Element) => void): void {
  const walk = (nodes: Element[]): void => {
    for (const element of nodes) {
      visit(element);
      if (element.element_type === "group") {
        walk((element as GroupElement).children_elements);
      } else if (element.element_type === "html") {
        walk((element as HtmlElement).children_elements);
      }
    }
  };
  walk(slide.children_elements);
}

function audioFromTrack(track: AudioElement, sceneOffsetMs: number): HyperframesAudioDeclaration | null {
  const src = track.source?.trim();
  if (!src) return null;

  const startMs = sceneOffsetMs + track.timeline.start_at;
  const endMs = sceneOffsetMs + track.timeline.end_at;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  return {
    id: `hf-audio-${track.element_id}`,
    src,
    startSec: startMs / 1000,
    endSec: endMs / 1000,
    volume: clamp01(track.volume),
    ...(track.source_start_at > 0 ? { mediaStartSec: track.source_start_at / 1000 } : {}),
    ...(track.loop ? { loop: true } : {}),
  };
}

function videoAudioFromElement(
  video: VideoElement,
  sceneOffsetMs: number,
): HyperframesVideoAudioDeclaration | null {
  const src = video.source?.trim();
  if (!src || video.muted) return null;

  const startMs = sceneOffsetMs + video.timeline.start_at;
  const endMs = sceneOffsetMs + video.timeline.end_at;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  return {
    id: `hf-video-audio-${video.element_id}`,
    src,
    startSec: startMs / 1000,
    endSec: endMs / 1000,
    volume: clamp01(video.volume),
    ...(video.loop ? { loop: true } : {}),
  };
}

/** Unique narration segment audio URLs across the scene (for headless duration measurement). */
export function collectNarrationAudioUrlsFromScene(scene: Scene): string[] {
  const urls = new Set<string>();
  for (const slide of scene.slide_elements) {
    walkSlideElements(slide, (element) => {
      if (element.element_type !== "narration") return;
      for (const seg of (element as NarrationElement).segments) {
        const url = seg.audio_url?.trim();
        if (url) urls.add(url);
      }
    });
  }
  return [...urls];
}

/** Collect scene-wide timed media for Hyperframes probe / audio mux (data-start / data-end). */
export function collectHyperframesMediaDeclarations(
  scene: Scene,
  measuredNarrationDurationByUrl: Readonly<Record<string, number>> = {},
): HyperframesMediaDeclarations {
  const audios: HyperframesAudioDeclaration[] = [];
  const videoAudios: HyperframesVideoAudioDeclaration[] = [];
  const diagnostics = emptyHyperframesMediaDiagnostics();
  const seenAudioIds = new Map<string, HyperframesAudioDeclaration | HyperframesVideoAudioDeclaration>();

  const recordSkip = (event: HyperframesMediaSkipEvent): void => {
    diagnostics.skipped.push(event);
    diagnostics.skippedCount += 1;
  };

  const pushAudio = (
    decl: HyperframesAudioDeclaration | null,
    ctx?: Pick<HyperframesMediaSkipEvent, "kind" | "slideId" | "slideIndex" | "narrationId" | "segmentIndex">,
  ): void => {
    if (!decl) return;
    const existing = seenAudioIds.get(decl.id);
    if (existing) {
      recordSkip({
        kind: ctx?.kind ?? "audio",
        reason: "duplicate_id",
        id: decl.id,
        collidedWithId: existing.id,
        slideId: ctx?.slideId,
        slideIndex: ctx?.slideIndex,
        narrationId: ctx?.narrationId,
        segmentIndex: ctx?.segmentIndex,
        srcTail: tailUrlForDiag(decl.src),
        startSec: decl.startSec,
        endSec: decl.endSec,
        detail: `duplicate HTML id; kept first track (${tailUrlForDiag(existing.src)} ${existing.startSec}s-${existing.endSec}s)`,
      });
      return;
    }
    seenAudioIds.set(decl.id, decl);
    audios.push(decl);
  };

  const pushVideoAudio = (decl: HyperframesVideoAudioDeclaration | null): void => {
    if (!decl) return;
    const existing = seenAudioIds.get(decl.id);
    if (existing) {
      recordSkip({
        kind: "video_audio",
        reason: "duplicate_id",
        id: decl.id,
        collidedWithId: existing.id,
        srcTail: tailUrlForDiag(decl.src),
        startSec: decl.startSec,
        endSec: decl.endSec,
        detail: `duplicate HTML id; kept first track (${tailUrlForDiag(existing.src)} ${existing.startSec}s-${existing.endSec}s)`,
      });
      return;
    }
    seenAudioIds.set(decl.id, decl);
    videoAudios.push(decl);
  };

  for (const track of scene.audio_elements) {
    const decl = audioFromTrack(track, 0);
    if (!decl) {
      if (!track.source?.trim()) {
        recordSkip({
          kind: "audio",
          reason: "missing_src",
          id: `hf-audio-${track.element_id}`,
          detail: "scene audio_elements track has empty source",
        });
      } else {
        recordSkip({
          kind: "audio",
          reason: "invalid_timeline",
          id: `hf-audio-${track.element_id}`,
          detail: `timeline ${track.timeline.start_at}-${track.timeline.end_at}ms invalid after scene offset`,
        });
      }
      continue;
    }
    pushAudio(decl, { kind: "audio" });
  }

  for (let slideIndex = 0; slideIndex < scene.slide_elements.length; slideIndex += 1) {
    const slide = scene.slide_elements[slideIndex];
    if (!slide) continue;
    const sceneOffsetMs = getHyperframesSceneSlideOffsetMs(
      scene.slide_elements,
      slideIndex,
      measuredNarrationDurationByUrl,
    );

    for (const track of collectSlideCanvasAudioElementsForMixer(slide)) {
      const decl = audioFromTrack(track, sceneOffsetMs);
      if (!decl) {
        recordSkip({
          kind: "audio",
          reason: !track.source?.trim() ? "missing_src" : "invalid_timeline",
          id: `hf-audio-${track.element_id}`,
          slideId: slide.element_id,
          slideIndex,
          detail: "slide canvas audio track skipped",
        });
        continue;
      }
      pushAudio(decl, { kind: "audio", slideId: slide.element_id, slideIndex });
    }

    walkSlideElements(slide, (element) => {
      if (element.element_type === "video") {
        const decl = videoAudioFromElement(element as VideoElement, sceneOffsetMs);
        if (!decl) return;
        pushVideoAudio(decl);
        return;
      }
      if (element.element_type !== "narration") return;

      const narration = element as NarrationElement;
      const segments = resolveNarrationSegmentsForHyperframes(
        narration,
        measuredNarrationDurationByUrl,
      );
      const resolvedByIndex = new Map(segments.map((seg) => [seg.index, seg]));

      diagnostics.narrationRawSegmentCount += narration.segments.length;
      diagnostics.narrationResolvedSegmentCount += segments.length;

      const narrationDiag: HyperframesNarrationDiag = {
        slideIndex,
        slideId: slide.element_id,
        narrationId: narration.element_id,
        rawSegmentCount: narration.segments.length,
        resolvedSegmentCount: segments.length,
        segments: [],
      };

      for (let i = 0; i < narration.segments.length; i += 1) {
        const raw = narration.segments[i]!;
        const canonicalSrc = raw.audio_url?.trim() ?? "";
        const measured = lookupMeasuredNarrationDurationMs(canonicalSrc, measuredNarrationDurationByUrl);
        const effectiveDurationMs = Math.max(raw.duration_ms, measured);
        const resolved = resolvedByIndex.get(i);
        const declaredId = `hf-narration-${slide.element_id}-${narration.element_id}-${i}`;

        const segmentDiag = {
          segmentIndex: i,
          startMs: resolved?.startMs ?? -1,
          endMs: resolved?.endMs ?? -1,
          storedDurationMs: raw.duration_ms,
          measuredDurationMs: measured,
          effectiveDurationMs,
          srcTail: tailUrlForDiag(canonicalSrc),
          declaredId,
          declared: false,
        };

        if (!canonicalSrc) {
          recordSkip({
            kind: "narration",
            reason: "narration_no_audio_url",
            id: declaredId,
            slideId: slide.element_id,
            slideIndex,
            narrationId: narration.element_id,
            segmentIndex: i,
            detail: "segment has empty audio_url",
          });
          narrationDiag.segments.push(segmentDiag);
          continue;
        }

        if (effectiveDurationMs <= 0) {
          recordSkip({
            kind: "narration",
            reason: "narration_zero_duration",
            id: declaredId,
            slideId: slide.element_id,
            slideIndex,
            narrationId: narration.element_id,
            segmentIndex: i,
            srcTail: segmentDiag.srcTail,
            detail: `stored=${raw.duration_ms}ms measured=${measured}ms`,
          });
          narrationDiag.segments.push(segmentDiag);
          continue;
        }

        if (!resolved) {
          recordSkip({
            kind: "narration",
            reason: "narration_zero_duration",
            id: declaredId,
            slideId: slide.element_id,
            slideIndex,
            narrationId: narration.element_id,
            segmentIndex: i,
            srcTail: segmentDiag.srcTail,
            detail: "segment absent from resolveNarrationSegmentsForHyperframes output",
          });
          narrationDiag.segments.push(segmentDiag);
          continue;
        }

        const startMs = sceneOffsetMs + resolved.startMs;
        const endMs = sceneOffsetMs + resolved.endMs;
        if (endMs <= startMs) {
          recordSkip({
            kind: "narration",
            reason: "narration_invalid_timeline",
            id: declaredId,
            slideId: slide.element_id,
            slideIndex,
            narrationId: narration.element_id,
            segmentIndex: i,
            srcTail: segmentDiag.srcTail,
            startSec: startMs / 1000,
            endSec: endMs / 1000,
            detail: `scene window ${startMs}-${endMs}ms invalid`,
          });
          narrationDiag.segments.push({
            ...segmentDiag,
            startMs: resolved.startMs,
            endMs: resolved.endMs,
          });
          continue;
        }

        const beforeCount = audios.length;
        pushAudio(
          {
            id: declaredId,
            src: canonicalSrc,
            startSec: startMs / 1000,
            endSec: endMs / 1000,
            volume: clamp01(narration.ai_teacher_tts_volume ?? 1),
          },
          {
            kind: "narration",
            slideId: slide.element_id,
            slideIndex,
            narrationId: narration.element_id,
            segmentIndex: i,
          },
        );
        segmentDiag.declared = audios.length > beforeCount;
        segmentDiag.startMs = resolved.startMs;
        segmentDiag.endMs = resolved.endMs;
        narrationDiag.segments.push(segmentDiag);
      }

      diagnostics.narrations.push(narrationDiag);
    });
  }

  diagnostics.declaredAudioCount = audios.length;
  diagnostics.declaredVideoAudioCount = videoAudios.length;
  diagnostics.narrationDeclaredCount = audios.filter((a) => a.id.startsWith("hf-narration-")).length;

  return { audios, videoAudios, diagnostics };
}
