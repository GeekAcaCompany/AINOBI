// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Subject matting (background removal).
 *
 * This implementation takes the deterministic chroma key path: assets generated on a green screen get an alpha cap from border-chroma flood fill +
 * saturated screen cleanup (gray screen assets skip the saturation cleanup — gray clothing/hair might
 * hit the screen color). Output quality is backstopped by the upper layer's cutout metrics and the final semantic QA: if matting damages
 * the character the whole pipeline fails, never delivering silently.
 */

import type { Raster } from "./image.ts";
import { alphaBand, bandBBox, cloneRaster, putAlphaBand } from "./image.ts";
import {
  CHROMA_TOLERANCE,
  cropToAlphaBbox,
  decontaminateChromaEdges,
  keyOutBackground,
} from "./chroma.ts";
import { pyRound } from "./cvops.ts";

/** Median color of the four corners (compatible with both legacy gray screens and green screens) */
function cornerMedianChroma(raster: Raster): [number, number, number] {
  const w = raster.width;
  const h = raster.height;
  const corners: Array<[number, number, number]> = [
    [raster.data[0], raster.data[1], raster.data[2]],
    [raster.data[((h - 1) * w + (w - 1)) * 4], raster.data[((h - 1) * w + (w - 1)) * 4 + 1], raster.data[((h - 1) * w + (w - 1)) * 4 + 2]],
    [raster.data[(w - 1) * 4], raster.data[(w - 1) * 4 + 1], raster.data[(w - 1) * 4 + 2]],
    [raster.data[(h - 1) * w * 4], raster.data[(h - 1) * w * 4 + 1], raster.data[(h - 1) * w * 4 + 2]],
  ];
  const pick = (channel: number): number => {
    const values = corners.map((c) => c[channel]).sort((a, b) => a - b);
    return values[2];
  };
  return [pick(0), pick(1), pick(2)];
}

export interface CutoutResult {
  image: Raster;
  /** With keep_canvas, the subject's alpha bbox (fully transparent falls back to the whole image) */
  bbox: [number, number, number, number];
}

/**
 * Background removal: chroma key alpha cap + saturated screen residue cleanup + a light alpha fix.
 *
 * With keepCanvas=false, crops to the subject bbox. Too-low coverage only warns (failure is left to
 * the upstream semantic judgment).
 */
export function cutout(
  img: Raster,
  name = "",
  keepCanvas = false,
): CutoutResult {
  const width = img.width;
  const height = img.height;
  const chroma = cornerMedianChroma(img);
  const saturated = Math.max(...chroma) - Math.min(...chroma) >= 120;

  const rgba = keyOutBackground(img, CHROMA_TOLERANCE, chroma);

  // Saturated screen residue cleanup: spill alpha tightening driven by the "dominant channel distance" in color space —
  // green screens usually leave semi-transparent green fringes inside hair/sleeves that the chroma key cap alone can't clean up
  if (saturated) {
    const alpha = alphaBand(rgba);
    for (let i = 0; i < alpha.length; i++) {
      const o = i * 4;
      const distance = Math.max(
        Math.abs(img.data[o] - chroma[0]),
        Math.abs(img.data[o + 1] - chroma[1]),
        Math.abs(img.data[o + 2] - chroma[2]),
      );
      const spillAlpha = distance <= 40 ? 0 : Math.min(255, pyRound(((distance - 40) * 255) / 56));
      alpha[i] = Math.min(alpha[i], spillAlpha);
    }
    putAlphaBand(rgba, alpha);
  }

  // Light alpha cleanup (< 12 zeroed) — keeps the soft matte subject
  const alpha = alphaBand(rgba);
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < 12) alpha[i] = 0;
  }
  putAlphaBand(rgba, alpha);
  let cleaned = rgba;
  if (saturated) {
    cleaned = decontaminateChromaEdges(rgba, chroma);
  }

  const finalAlpha = alphaBand(cleaned);
  let covered = 0;
  for (let i = 0; i < finalAlpha.length; i++) {
    if (finalAlpha[i] >= 8) covered++;
  }
  const coverage = covered / (width * height);
  const label = name ? `part '${name}'` : "part";
  if (coverage < 0.01) {
    console.warn(
      `  [warn] ${label}: cutout coverage ${(coverage * 100).toFixed(1)}% is very low — segmentation may have failed`,
    );
  }

  if (keepCanvas) {
    const bbox = bandBBox(finalAlpha, width, height) ?? [0, 0, width, height];
    return { image: cloneRaster(cleaned), bbox };
  }
  return cropToAlphaBbox(cleaned);
}
