// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Translation registration between the base image and the variant image.
 *
 * Even when asked to "keep the composition bit for bit", image edits drift the whole canvas by up to a hundred pixels — a direct
 * difference would be drowned by high-contrast stripes along the character outline, so the drift must be removed before mouth localization.
 *
 * Main engine: ECC (MOTION_TRANSLATION, working resolution 1/4) — intensity alignment based on all edge pixels,
 * still works on flat cel-shaded art; on non-convergence falls back to phase correlation
 * (sub-pixel translation); out-of-range shifts are zeroed outright (results with a whole-image misalignment aren't trusted).
 */

import type { Raster } from "./image.ts";
import { cloneRaster, luminanceBand, resizeRaster } from "./image.ts";
import { EccNoConvergenceError, eccTranslation, phaseCorrelate, pyRound } from "./cvops.ts";

export const MAX_SHIFT = 160;

const DOWNSCALE = 4;

/** Grayscale + 1/4 downsampling (bilinear) — the registration working resolution */
function graySmall(raster: Raster): Float64Array {
  const w = Math.max(1, Math.floor(raster.width / DOWNSCALE));
  const h = Math.max(1, Math.floor(raster.height / DOWNSCALE));
  const small = resizeRaster(raster, w, h, "bilinear");
  const band = luminanceBand(small);
  return Float64Array.from(band);
}

/** (dx, dy): translating variant by (dx, dy) aligns it with base */
export function registerTranslation(base: Raster, variant: Raster): [number, number] {
  const gBase = graySmall(base);
  const gVar = graySmall(variant);
  const width = Math.max(1, Math.floor(base.width / DOWNSCALE));
  const height = Math.max(1, Math.floor(base.height / DOWNSCALE));

  let dx: number;
  let dy: number;
  let method: string;
  try {
    const result = eccTranslation(gBase, gVar, width, height);
    // ECC's warp translates input by (tx, ty) to align with template;
    // the variant's own drift relative to base is its negation
    dx = -result.tx * DOWNSCALE;
    dy = -result.ty * DOWNSCALE;
    method = "ecc";
  } catch (error) {
    if (!(error instanceof EccNoConvergenceError)) {
      throw error;
    }
    // ECC may not converge on flat art: fall back to phase correlation (returns the variant's shift relative to
    // base, so the correction is negated)
    const shift = phaseCorrelate(gBase, gVar, width, height);
    dx = -shift.dx * DOWNSCALE;
    dy = -shift.dy * DOWNSCALE;
    method = "phase";
  }

  if (Math.abs(dx) > MAX_SHIFT || Math.abs(dy) > MAX_SHIFT) {
    console.warn(
      `  [warn] registration shift (${dx.toFixed(0)},${dy.toFixed(0)}) exceeds ${MAX_SHIFT}px — ignoring`,
    );
    return [0, 0];
  }
  console.info(`  register (${method}): shift (${dx.toFixed(1)}, ${dy.toFixed(1)})`);
  return [pyRound(dx), pyRound(dy)];
}

/** Integer translation (RGB edges filled black / RGBA edges filled transparent) */
export function applyShift(img: Raster, dx: number, dy: number): Raster {
  if (dx === 0 && dy === 0) {
    return cloneRaster(img);
  }
  const out = cloneRaster(img);
  const fillA = 255;
  for (let y = 0; y < img.height; y++) {
    const sy = y - dy;
    for (let x = 0; x < img.width; x++) {
      const sx = x - dx;
      const o = (y * img.width + x) * 4;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) {
        // Edges translated in are filled with the background; the alpha channel is filled with 0 or opaque black depending on the source transparency
        const srcOpaque = img.data[3] !== 0;
        out.data[o] = 0;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = srcOpaque ? fillA : 0;
        continue;
      }
      const s = (sy * img.width + sx) * 4;
      out.data[o] = img.data[s];
      out.data[o + 1] = img.data[s + 1];
      out.data[o + 2] = img.data[s + 2];
      out.data[o + 3] = img.data[s + 3];
    }
  }
  return out;
}
