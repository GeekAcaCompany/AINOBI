// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pixel refinement within the semantic mouth ROI and mouth-opening frame sequence baking.
 *
 * This module doesn't decide "where the mouth is" — the multimodal vision gate (or offline manual anchors) provides a face-relative
 * ROI; pixel analysis only verifies and tightens the changed region inside that ROI, so clothing folds elsewhere on the canvas
 * can't compete with the real mouth. Baking only transforms the connected dark cavity inside the ROI that passed the pixel gate and the semantic gate,
 * compressing vertically around the visually located lip line, while the nose/cheeks/chin keep the base image as-is.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Raster } from "./image.ts";
import {
  cloneRaster,
  cropRaster,
  fillRectangle,
  luminanceBand,
  pasteRaster,
  strokeRectangle,
} from "./image.ts";
import { encodePng } from "./png.ts";
import {
  connectedComponentsWithStats,
  cvGaussianBlurBand,
  dilateBand,
  inpaintTelea,
  morphClose3,
  warpVerticalBilinearMask,
  warpVerticalLanczos4,
} from "./cvops.ts";
import { applyShift } from "./register.ts";

/** Luma differences above this count as "changed pixels" (high enough to reject texture noise, low enough to include mouth interior vs skin) */
export const DIFF_THRESHOLD = 36;
/** An open mouth interior is dark in cel-shaded art (deep red to near black; 165 allows dark red cavities, skin/blush sit above it) */
export const OPEN_DARK_LUMA = 165;
/** A real open mouth = a dark cavity appears: the variant must be significantly darker than the base on the detected blob (shadow noise ~20-40, cavity ~100+) */
export const MIN_MEAN_DARKENING = 45;
export const MIN_CHANGED_PIXELS = 18;
/** Detected blob expansion (mouth patch margin) */
export const PAD_X = 8;
export const PAD_Y = 6;

export const N_FRAMES = 7;

type Box = [number, number, number, number];

/**
 * The tightened "changed mouth" bbox within the semantic face ROI.
 *
 * Callers must provide search_bbox (the ROI) and the visually located lip point target.
 * Returns null when there's no credible dark cavity change (the edit didn't open the mouth).
 */
export function locateMouth(
  baseRgb: Raster,
  openRgb: Raster,
  shift: [number, number],
  searchBbox: Box,
  target: [number, number],
): Box | null {
  const openAligned = applyShift(openRgb, shift[0], shift[1]);
  if (baseRgb.width !== openAligned.width || baseRgb.height !== openAligned.height) {
    throw new Error("base and open variant must have the same dimensions");
  }
  const width = baseRgb.width;
  const height = baseRgb.height;
  const [x0r, y0r, x1r, y1r] = searchBbox;
  if (!(0 <= x0r && x0r < x1r && x1r <= width && 0 <= y0r && y0r < y1r && y1r <= height)) {
    throw new Error(`semantic search bbox outside canvas: [${searchBbox.join(", ")}]`);
  }

  const baseL = luminanceBand(baseRgb);
  const openL = luminanceBand(openAligned);
  const raw = new Uint8Array(width * height);
  for (let y = y0r; y < y1r; y++) {
    for (let x = x0r; x < x1r; x++) {
      const i = y * width + x;
      if (baseL[i] - openL[i] > DIFF_THRESHOLD && openL[i] < OPEN_DARK_LUMA) {
        raw[i] = 1;
      }
    }
  }

  // Close small gaps, then run connected components, but quality stats only count the original seed pixels
  const merged = dilateBand(morphClose3(raw, width, height), width, height, 3);
  const cc = connectedComponentsWithStats(merged, width, height);
  const [tx, ty] = target;
  const roiDiag = Math.max(1.0, Math.hypot(x1r - x0r, y1r - y0r));
  let bestScore = -1;
  let bestBox: Box | null = null;
  let bestInfo = "";
  for (let label = 1; label < cc.count; label++) {
    const stat = cc.stats[label];
    const seedCount = countSeeds(cc.labels, raw, label, width, height);
    if (seedCount < MIN_CHANGED_PIXELS) continue;
    const meanDarkening = meanDarkeningOf(cc.labels, raw, label, baseL, openL, width, height);
    if (meanDarkening < MIN_MEAN_DARKENING) continue;
    const { cx, cy } = cc.centroids[label];
    const distance = Math.hypot(cx - tx, cy - ty) / roiDiag;
    if (distance > 0.38) continue;
    const score = seedCount * Math.max(0.15, 1.0 - distance * 2.0);
    if (score > bestScore) {
      bestScore = score;
      bestBox = [stat.x, stat.y, stat.x + stat.w, stat.y + stat.h];
      bestInfo = `${seedCount}px, darkening ${meanDarkening.toFixed(0)}, semantic ROI [${searchBbox.join(", ")}]`;
    }
  }

  if (bestBox === null) {
    console.warn(
      "  [warn] no convincing dark mouth change inside the semantic face ROI " +
        "(the edit likely did not open the mouth)",
    );
    return null;
  }
  console.info(`  mouth change: ${bestInfo}`);
  const [bx, by, bx1, by1] = bestBox;
  return [
    Math.max(x0r, bx - PAD_X),
    Math.max(y0r, by - PAD_Y),
    Math.min(x1r, bx1 + PAD_X),
    Math.min(y1r, by1 + PAD_Y),
  ];
}

/** Original seed pixel count (raw hits within the component) */
function countSeeds(
  labels: Int32Array,
  raw: Uint8Array,
  label: number,
  width: number,
  height: number,
): number {
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === label && raw[i] !== 0) count++;
  }
  return count;
}

/** Average darkening on seed pixels (mean of base − open luma) */
function meanDarkeningOf(
  labels: Int32Array,
  raw: Uint8Array,
  label: number,
  baseL: Uint8Array,
  openL: Uint8Array,
  width: number,
  height: number,
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === label && raw[i] !== 0) {
      sum += baseL[i] - openL[i];
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** Debug overlay: red box for the semantic ROI + yellow box for the detected change bbox */
export async function saveDiffDebug(
  baseRgb: Raster,
  bbox: Box,
  path: string,
  changeBbox?: Box | null,
): Promise<void> {
  const vis = cloneRaster(baseRgb);
  strokeRectangle(vis, [bbox[0], bbox[1], bbox[2] - 1, bbox[3] - 1], [255, 0, 0, 255], 3);
  if (changeBbox) {
    strokeRectangle(
      vis,
      [changeBbox[0], changeBbox[1], changeBbox[2] - 1, changeBbox[3] - 1],
      [255, 215, 0, 255],
      2,
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encodePng(vis));
}

/**
 * Bakes N_FRAMES mouth patches covering mouth openness 0..1.
 *
 * Only transforms the connected dark cavity region inside the semantic mouth patch that passed both gates (pixel gate + semantic gate);
 * the mouth-opening difference is compressed vertically around the visual lip line. The original closed lip line is inpainted away first, then the compressed
 * open frame is overlaid — otherwise the undeformed closed lip would leave a second dark edge below the compressed cavity.
 */
export async function bakeFrames(
  baseRgb: Raster,
  openRgb: Raster,
  shift: [number, number],
  bbox: Box,
  changeBbox: Box,
  lipY: number,
  outDir: string,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });

  const openAligned = applyShift(openRgb, shift[0], shift[1]);
  const [x0, y0, x1, y1] = bbox;
  const w = x1 - x0;
  const h = y1 - y0;
  const patchBase = cropRaster(baseRgb, bbox);
  const patchOpen = cropRaster(openAligned, bbox);

  // Change mask: max per-channel difference > 14, limited to the accepted change bbox expanded by 4px
  // (edit models often introduce low-level perturbations across the whole image)
  const delta = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const d = Math.max(
      Math.abs(patchBase.data[o] - patchOpen.data[o]),
      Math.abs(patchBase.data[o + 1] - patchOpen.data[o + 1]),
      Math.abs(patchBase.data[o + 2] - patchOpen.data[o + 2]),
    );
    delta[i] = d > 14 ? 1 : 0;
  }
  const allowed = new Uint8Array(w * h);
  const [cx0, cy0, cx1, cy1] = changeBbox;
  const ax0 = Math.max(0, cx0 - x0 - 4);
  const ay0 = Math.max(0, cy0 - y0 - 4);
  const ax1 = Math.min(w, cx1 - x0 + 4);
  const ay1 = Math.min(h, cy1 - y0 + 4);
  for (let y = ay0; y < ay1; y++) {
    for (let x = ax0; x < ax1; x++) {
      allowed[y * w + x] = 1;
    }
  }
  const maskArr = new Uint8Array(w * h);
  for (let i = 0; i < maskArr.length; i++) {
    maskArr[i] = delta[i] !== 0 && allowed[i] !== 0 ? 1 : 0;
  }

  // Edits may leave scattered skin perturbations beside the mouth, and compressing them would produce stray dark marks
  // beside intermediate openings — keep only the connected component that best overlaps the semantically accepted dark cavity bbox
  const mergedMask = morphClose3(maskArr, w, h);
  const cc = connectedComponentsWithStats(mergedMask, w, h);
  const targetX0 = Math.max(0, cx0 - x0);
  const targetY0 = Math.max(0, cy0 - y0);
  const targetX1 = Math.min(w, cx1 - x0);
  const targetY1 = Math.min(h, cy1 - y0);
  let bestLabel = 0;
  let bestScore = -1;
  for (let label = 1; label < cc.count; label++) {
    let overlap = 0;
    for (let y = targetY0; y < targetY1; y++) {
      for (let x = targetX0; x < targetX1; x++) {
        if (cc.labels[y * w + x] === label) overlap++;
      }
    }
    const score = overlap * Math.max(1, w * h) + cc.stats[label].area;
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }
  if (bestLabel === 0) {
    throw new Error("mouth frame mask contains no connected changed pixels");
  }

  const coreMask = new Uint8Array(w * h);
  for (let i = 0; i < coreMask.length; i++) {
    coreMask[i] = cc.labels[i] === bestLabel ? 255 : 0;
  }
  // Remove the original closed lip: inpainting is limited to the selected mouth component, leaving facial features and collars untouched
  const cleanMask = dilateBand(coreMask, w, h, 3);
  const cleanBase = inpaintTelea(patchBase, cleanMask, 3);
  const softMask = cvGaussianBlurBand(
    Uint8Array.from(cleanMask, (v) => (v !== 0 ? 255 : 0)),
    w,
    h,
    1.4,
  );
  const anchor = Math.max(0, Math.min(h - 1, lipY - y0));

  const names: string[] = [];
  for (let k = 0; k < N_FRAMES; k++) {
    const t = k / (N_FRAMES - 1);
    let frame: Raster;
    if (t > 0.02) {
      const warped = warpVerticalLanczos4(patchOpen, t, anchor);
      const warpedMask = warpVerticalBilinearMask(softMask, w, h, t, anchor);
      // The renderer cross-fades frame 0 → frame 1, so nonzero frames can use a clean lip base throughout without jumping
      frame = cloneRaster(cleanBase);
      pasteRaster(frame, warped, 0, 0, warpedMask);
    } else {
      frame = cloneRaster(patchBase);
    }
    const name = `m${k}.png`;
    await writeFile(`${outDir}/${name}`, encodePng(frame));
    names.push(name);
  }
  return names;
}
