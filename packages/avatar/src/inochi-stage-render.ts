// SPDX-License-Identifier: AGPL-3.0-only
import type { Inochi2DModelProps } from "./Inochi2DModel.tsx";

/**
 * Inochi2D render parameters shared by courseware stages (editor canvas, preview playback).
 * Supersampling + a grow-only buffer + a pixel cap; keep both callers in sync when changing them.
 */
export const COURSEWARE_INOCHI_STAGE_RENDER_PROPS = {
  quality: "low",
  fps: 30,
  autoResize: true,
  antialias: false,
  pixelRatio: 1,
  minRenderShortEdge: 576,
  maxSuperSample: 4,
  maxRenderShortEdge: 640,
  maxRenderPixels: 420_000,
  /** Courseware vtuber slots are usually far smaller than 480px; enabling it would stack a CSS blur and look blurry. */
  softBlurBelowDisplayHeight: 0,
} as const satisfies Pick<
  Inochi2DModelProps,
  | "quality"
  | "fps"
  | "autoResize"
  | "antialias"
  | "pixelRatio"
  | "minRenderShortEdge"
  | "maxSuperSample"
  | "maxRenderShortEdge"
  | "maxRenderPixels"
  | "softBlurBelowDisplayHeight"
>;

export type CoursewareInochiStageRenderProps = typeof COURSEWARE_INOCHI_STAGE_RENDER_PROPS;

/** Assemble the Inochi component props from the stage slot's pixel size (without callbacks / modelUrl). */
export function buildCoursewareInochiStageModelProps(
  widthPx: number,
  heightPx: number,
  overrides?: Partial<Inochi2DModelProps>,
): Pick<
  Inochi2DModelProps,
  keyof CoursewareInochiStageRenderProps | "maxHeight" | "maxWidth" | "className"
> &
  Partial<Inochi2DModelProps> {
  return {
    ...COURSEWARE_INOCHI_STAGE_RENDER_PROPS,
    maxHeight: Math.max(20, Math.round(heightPx)),
    maxWidth: Math.max(20, Math.round(widthPx)),
    className: "h-full w-full",
    ...overrides,
  };
}
