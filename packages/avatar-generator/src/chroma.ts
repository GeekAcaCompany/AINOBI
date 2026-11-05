// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chroma key matting (the deterministic path).
 *
 * Image models can't produce reliable transparency directly, so every asset is generated on a solid screen, and this module
 * turns the screen color into alpha: tight tolerance mask + border-connected flood fill (protecting same-colored design areas inside the subject,
 * while small enclosed pockets in hair gaps are still treated as background) → grow into the wide tolerance mask (eating screen
 * vignetting/noise) → erode 1px to swallow the screen edge → Gaussian softening → despill saturated screen edges
 * (solving the compositing equation from the dominant channel ratio to recover clean foreground colors).
 */

import type { Raster } from "./image.ts";
import {
  alphaBand,
  bandThresholdBBox,
  cloneRaster,
  cropRaster,
  gaussianBlurBand,
  minFilterBand,
  maxFilterBand,
} from "./image.ts";
import { pyRound } from "./cvops.ts";

/** Neutral gray screen RGB */
export const CHROMA_RGB: readonly [number, number, number] = [0x80, 0x80, 0x80];

/** Max per-channel difference counted as background (cel-shaded art on #808080 far exceeds this) */
export const CHROMA_TOLERANCE = 32;

/** Reasonable range of alpha coverage (too low = extraction failed; too high = background not keyed out) */
export const MIN_COVERAGE = 0.01;
export const MAX_COVERAGE = 0.98;

/** Enclosed chroma pockets ≤ this fraction of the canvas are treated as background showing through gaps */
export const MAX_POCKET_FRAC = 0.015;

/** Only strongly saturated screens need despill (neutral gray has no dominant channel spill, and might hit clothing) */
export const MIN_SCREEN_DOMINANCE = 96;

/** RGB triple */
type Rgb = readonly [number, number, number];

/** Mask of pixels whose per-channel difference from the chroma is ≤ tolerance (255 = hit) */
export function chromaLikeMask(
  raster: Raster,
  tolerance: number,
  chromaRgb: Rgb = CHROMA_RGB,
): Uint8Array {
  const mask = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const ok =
      Math.abs(raster.data[o] - chromaRgb[0]) <= tolerance &&
      Math.abs(raster.data[o + 1] - chromaRgb[1]) <= tolerance &&
      Math.abs(raster.data[o + 2] - chromaRgb[2]) <= tolerance;
    mask[i] = ok ? 255 : 0;
  }
  return mask;
}

/** Whether a pixel is on the canvas border */
function isBorderIndex(idx: number, width: number, height: number): boolean {
  const y = (idx / width) | 0;
  const x = idx - y * width;
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
}

/**
 * Background mask: border-connected chroma regions + small enclosed pockets.
 *
 * Connectivity protects same-colored design areas inside the subject; pockets larger than the canvas fraction are kept
 * (large enclosed chroma areas are treated as intentional design rather than gaps).
 */
export function backgroundMask(
  mask: Uint8Array,
  width: number,
  height: number,
  maxPocketFrac: number = MAX_POCKET_FRAC,
): Uint8Array {
  const bg = new Uint8Array(mask.length);
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const component: number[] = [];
  const maxPocket = maxPocketFrac * width * height;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] !== 0) continue;
    let tail = 0;
    stack[tail++] = start;
    seen[start] = 1;
    component.length = 0;
    let touchesBorder = false;
    while (tail > 0) {
      const idx = stack[--tail];
      component.push(idx);
      if (!touchesBorder && isBorderIndex(idx, width, height)) {
        touchesBorder = true;
      }
      const y = (idx / width) | 0;
      const x = idx - y * width;
      if (x > 0 && seen[idx - 1] === 0 && mask[idx - 1] !== 0) {
        seen[idx - 1] = 1;
        stack[tail++] = idx - 1;
      }
      if (x < width - 1 && seen[idx + 1] === 0 && mask[idx + 1] !== 0) {
        seen[idx + 1] = 1;
        stack[tail++] = idx + 1;
      }
      if (y > 0 && seen[idx - width] === 0 && mask[idx - width] !== 0) {
        seen[idx - width] = 1;
        stack[tail++] = idx - width;
      }
      if (y < height - 1 && seen[idx + width] === 0 && mask[idx + width] !== 0) {
        seen[idx + width] = 1;
        stack[tail++] = idx + width;
      }
    }
    if (touchesBorder || component.length <= maxPocket) {
      for (const idx of component) {
        bg[idx] = 255;
      }
    }
  }
  return bg;
}

/** Grows the background ring by ring into adjacent wide-tolerance pixels (the rounds cap stops it eating deep into gradients) */
export function growBackground(
  bg: Uint8Array,
  wide: Uint8Array,
  width: number,
  height: number,
  rounds = 12,
): Uint8Array {
  let cur = Uint8Array.from(bg);
  for (let round = 0; round < rounds; round++) {
    const grown = maxFilterBand(cur, width, height, 3);
    let changed = false;
    const next = new Uint8Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      // frontier = wide ∧ ¬bg ∧ dilate(bg)
      const frontier = wide[i] !== 0 && cur[i] === 0 && grown[i] !== 0 ? 255 : 0;
      const merged = cur[i] !== 0 || frontier !== 0 ? 255 : 0;
      if (merged !== cur[i]) changed = true;
      next[i] = merged;
    }
    cur = next;
    if (!changed) break;
  }
  return cur;
}

/**
 * Saturated screen edge despill: estimates the screen color mix ratio from the dominant channel ratio, tightens alpha and solves
 * the compositing equation to recover the foreground color. Only affects the narrow band near transparency; saturated colors inside the subject are unaffected.
 */
export function decontaminateChromaEdges(
  raster: Raster,
  chromaRgb: Rgb,
  edgeRadius = 3,
): Raster {
  const out = cloneRaster(raster);
  // Force RGBA semantics (data is already interleaved RGBA)
  let keyChannel = 0;
  if (chromaRgb[1] > chromaRgb[keyChannel]) keyChannel = 1;
  if (chromaRgb[2] > chromaRgb[keyChannel]) keyChannel = 2;
  const others = [0, 1, 2].filter((c) => c !== keyChannel);
  const screenDominance =
    chromaRgb[keyChannel] - Math.max(chromaRgb[others[0]], chromaRgb[others[1]]);
  if (screenDominance < MIN_SCREEN_DOMINANCE) {
    return out;
  }

  const alpha = alphaBand(out);
  let kernelSize = Math.max(3, edgeRadius * 2 + 1);
  if (kernelSize % 2 === 0) kernelSize += 1;
  const neighborhoodMin = minFilterBand(alpha, out.width, out.height, kernelSize);

  const otherIdx = keyChannel === 0 ? [1, 2] : keyChannel === 1 ? [0, 2] : [0, 1];
  for (let i = 0; i < alpha.length; i++) {
    const o = i * 4;
    const pixelDominance = out.data[o + keyChannel] - Math.max(out.data[o + otherIdx[0]], out.data[o + otherIdx[1]]);
    const screenFraction = Math.min(Math.max(pixelDominance / screenDominance, 0), 1);
    const estimatedAlpha = (1 - screenFraction) * 255;
    const contaminated = neighborhoodMin[i] < 224 && pixelDominance > 3;
    let refinedAlpha = alpha[i];
    if (contaminated) {
      refinedAlpha = Math.min(refinedAlpha, estimatedAlpha);
    }
    // Solve C = α·F + (1-α)·chroma
    if (contaminated && refinedAlpha >= 8 && estimatedAlpha >= 8) {
      const colorAlphaFraction = Math.max(estimatedAlpha / 255, 1 / 255);
      for (let c = 0; c < 3; c++) {
        const recovered =
          (out.data[o + c] - (1 - colorAlphaFraction) * chromaRgb[c]) / colorAlphaFraction;
        out.data[o + c] = Math.min(Math.max(pyRound(recovered), 0), 255);
      }
    }
    if (refinedAlpha < 8) {
      out.data[o] = 0;
      out.data[o + 1] = 0;
      out.data[o + 2] = 0;
    }
    out.data[o + 3] = Math.min(Math.max(pyRound(refinedAlpha), 0), 255);
  }
  return out;
}

/**
 * Chroma key background removal: returns an RGBA copy (screen transparent, subject opaque).
 * Tight/wide dual tolerance masks → border-connected background → growth → erode + soften → despill.
 */
export function keyOutBackground(
  raster: Raster,
  tolerance: number = CHROMA_TOLERANCE,
  chromaRgb: Rgb = CHROMA_RGB,
): Raster {
  const { width, height } = raster;
  const tight = chromaLikeMask(raster, tolerance, chromaRgb);
  const wide = chromaLikeMask(raster, tolerance * 2, chromaRgb);
  let bg = backgroundMask(tight, width, height);
  bg = growBackground(bg, wide, width, height);
  bg = minFilterBand(bg, width, height, 3);
  bg = gaussianBlurBand(bg, width, height, 1.0);
  const out = cloneRaster(raster);
  for (let i = 0; i < bg.length; i++) {
    out.data[i * 4 + 3] = 255 - bg[i];
  }
  return decontaminateChromaEdges(out, chromaRgb);
}

/** bbox of alpha ≥ 8; fully transparent throws (extraction failure guard) */
export function cropToAlphaBbox(raster: Raster): { image: Raster; bbox: [number, number, number, number] } {
  const alpha = alphaBand(raster);
  const bbox = bandThresholdBBox(alpha, raster.width, raster.height, 8);
  if (bbox === null) {
    throw new Error("extraction produced a fully transparent image; the edit likely failed");
  }
  return { image: cropRaster(raster, bbox), bbox };
}
