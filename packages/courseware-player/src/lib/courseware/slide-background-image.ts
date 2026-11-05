// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import type { SlideBackgroundImageFit } from "@ainobi/courseware-core/elements.ts";
import { SLIDE_BACKGROUND_IMAGE_FIT_VALUES } from "@ainobi/courseware-core/elements.ts";

export const SLIDE_BACKGROUND_IMAGE_FIT_DEFAULT: SlideBackgroundImageFit = "cover";

export function isSlideBackgroundImageFit(value: unknown): value is SlideBackgroundImageFit {
  return (
    typeof value === "string" &&
    (SLIDE_BACKGROUND_IMAGE_FIT_VALUES as readonly string[]).includes(value)
  );
}

/**
 * For the absolutely positioned canvas layer covering the whole page (background image only, without the background color and grid).
 */
export function getSlideBackgroundImageLayerStyle(
  backgroundImageUrl: string | undefined,
  fit: SlideBackgroundImageFit | undefined,
): CSSProperties | null {
  const url = (backgroundImageUrl ?? "").trim();
  if (!url) return null;
  const f = fit ?? SLIDE_BACKGROUND_IMAGE_FIT_DEFAULT;
  const base: CSSProperties = {
    backgroundImage: `url(${JSON.stringify(url)})`,
  };
  switch (f) {
    case "cover":
      return { ...base, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    case "contain":
      return { ...base, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    case "stretch":
      return { ...base, backgroundSize: "100% 100%", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    case "repeat":
      return { ...base, backgroundSize: "auto", backgroundPosition: "top left", backgroundRepeat: "repeat" };
    case "repeat_x":
      return { ...base, backgroundSize: "auto", backgroundPosition: "top left", backgroundRepeat: "repeat-x" };
    case "repeat_y":
      return { ...base, backgroundSize: "auto", backgroundPosition: "top left", backgroundRepeat: "repeat-y" };
    case "center":
      return { ...base, backgroundSize: "auto", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    default:
      return { ...base, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
  }
}
