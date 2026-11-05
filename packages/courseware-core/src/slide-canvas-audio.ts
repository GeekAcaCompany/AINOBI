// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioElement, Element, GroupElement, HtmlElement, SlideElement } from "./elements.ts";

/** How a slide canvas `audio` element appears on the stage. */
export type CanvasAudioDisplayMode = "hidden" | "button" | "player";

export const CANVAS_AUDIO_DISPLAY_META_KEY = "canvas_audio_display";

export function parseCanvasAudioDisplayMode(value: unknown): CanvasAudioDisplayMode {
  if (value === "hidden" || value === "button" || value === "player") return value;
  return "hidden";
}

export function getCanvasAudioDisplayMode(element: Element): CanvasAudioDisplayMode {
  if (element.element_type !== "audio") return "hidden";
  const meta = element.metadata as Record<string, unknown>;
  return parseCanvasAudioDisplayMode(meta[CANVAS_AUDIO_DISPLAY_META_KEY]);
}

export const CANVAS_AUDIO_PLAYBACK_RATE_META_KEY = "playback_rate";

const clampCanvasAudioPlaybackRate = (value: number): number =>
  Math.min(4, Math.max(0.1, value));

/** Playback rate of canvas audio elements (default 1). */
export function getCanvasAudioPlaybackRate(element: Element): number {
  if (element.element_type !== "audio") return 1;
  const raw = (element.metadata as Record<string, unknown>)[CANVAS_AUDIO_PLAYBACK_RATE_META_KEY];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 1;
  if (!Number.isFinite(n) || n <= 0) return 1;
  return clampCanvasAudioPlaybackRate(n);
}

export function applyCanvasAudioPlaybackRate(
  element: AudioElement,
  playbackRate: number,
): AudioElement {
  const rate = clampCanvasAudioPlaybackRate(playbackRate);
  const nextMetadata = { ...element.metadata };
  if (Math.abs(rate - 1) < 0.001) {
    delete nextMetadata[CANVAS_AUDIO_PLAYBACK_RATE_META_KEY];
  } else {
    nextMetadata[CANVAS_AUDIO_PLAYBACK_RATE_META_KEY] = rate;
  }
  return { ...element, metadata: nextMetadata };
}

export function applyCanvasAudioDisplayMode(
  element: AudioElement,
  mode: CanvasAudioDisplayMode,
): AudioElement {
  return {
    ...element,
    metadata: {
      ...element.metadata,
      [CANVAS_AUDIO_DISPLAY_META_KEY]: mode,
    },
  };
}

/**
 * Audio elements on the slide canvas (not `scene.audio_elements`). Timelines
 * are slide-local. (Quiz stem audio is now expressed in the quiz AST itself.)
 */
export function collectSlideCanvasAudioElements(slide: SlideElement): AudioElement[] {
  const out: AudioElement[] = [];

  const walk = (nodes: Element[]): void => {
    for (const el of nodes) {
      if (el.element_type === "audio") {
        out.push(el as AudioElement);
      } else if (el.element_type === "group") {
        walk((el as GroupElement).children_elements);
      } else if (el.element_type === "html") {
        walk((el as HtmlElement).children_elements);
      }
    }
  };

  walk(slide.children_elements);
  return out;
}

/** Mixed only in {@link GlobalAudioTracks}; visible button/player clips use on-stage widgets. */
export function collectSlideCanvasAudioElementsForMixer(slide: SlideElement): AudioElement[] {
  return collectSlideCanvasAudioElements(slide).filter(
    (a) => getCanvasAudioDisplayMode(a) === "hidden",
  );
}
