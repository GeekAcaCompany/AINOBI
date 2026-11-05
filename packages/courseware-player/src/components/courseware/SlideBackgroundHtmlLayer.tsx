// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactElement } from "react";

import {
  SLIDE_LOGICAL_HEIGHT,
  SLIDE_LOGICAL_WIDTH,
} from "../../lib/courseware/slide-cover-layout.ts";

import { CoursewareHtmlStageEmbed } from "./CoursewareHtmlStageEmbed.tsx";

/**
 * The HTML layer of a slide background. Lays `slide.background_html_src` full-screen below the elements
 * (color < image < HTML < elements). Being a background, pointer interaction passes through it.
 * Used alongside the image background ({@link getSlideBackgroundImageLayerStyle}) at the same render spot.
 */
export function SlideBackgroundHtmlLayer({
  src,
  slideId,
  scale,
  contentZoom,
  targetSizePx,
  previewStage,
  playbackGateActive,
  onPlaybackLoadingChange,
  zClassName = "z-0",
  interactive = false,
  loadingLabel,
  loadFailedTitle,
}: {
  src: string | undefined;
  slideId: string;
  /** Canvas scale (pixels per logical unit). With targetSizePx given, the fit scale wins. */
  scale: number;
  /** Content zoom of the background HTML (carried over from the original HTML element's content_zoom, 1–2.5). */
  contentZoom?: number;
  /** For thumbnails / the minimap: contain within these CSS pixels. */
  targetSizePx?: { width: number; height: number };
  previewStage?: boolean;
  playbackGateActive?: boolean;
  onPlaybackLoadingChange?: (loading: boolean) => void;
  /** Stacking order (default z-0: right above the image background, below the elements). */
  zClassName?: string;
  /**
   * Makes the background HTML mouse-operable in preview/player. false while editing
   * (so the background doesn't get in the way of selection / marquee selection). Since it lies below the elements, the upper
   * element container must let pointer events pass through its empty areas.
   */
  interactive?: boolean;
  loadingLabel?: string;
  loadFailedTitle?: string;
}): ReactElement | null {
  const trimmed = (src ?? "").trim();
  if (!trimmed) return null;
  return (
    <div
      className={`${interactive ? "pointer-events-auto" : "pointer-events-none"} absolute inset-0 overflow-hidden ${zClassName}`}
    >
      <CoursewareHtmlStageEmbed
        elementId={`${slideId}__bg_html`}
        title="slide-background-html"
        src={trimmed}
        widthLogical={SLIDE_LOGICAL_WIDTH}
        heightLogical={SLIDE_LOGICAL_HEIGHT}
        scale={scale}
        contentZoom={contentZoom}
        targetSizePx={targetSizePx}
        previewStage={previewStage}
        playbackGateActive={playbackGateActive}
        onPlaybackLoadingChange={onPlaybackLoadingChange}
        loadingLabel={loadingLabel}
        loadFailedTitle={loadFailedTitle}
      />
    </div>
  );
}

export default SlideBackgroundHtmlLayer;
