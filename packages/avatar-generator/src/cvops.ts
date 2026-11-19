// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pixel algorithm layer: morphology / connected components / affine sampling / inpainting (Telea FMM) / translation registration
 * (ECC + phase correlation).
 *
 * Semantic conventions strictly aligned with the reference implementation:
 * - binary morphology: dilate treats out-of-bounds as 0, erode treats it as 255 (the subject isn't eroded by the border)
 * - connectedComponentsWithStats: 8-connectivity, labels assigned by first appearance in row-major order,
 *   stats = [x, y, w, h, area] (label 0 is the whole background)
 * - sigma Gaussian: kernel size round(6σ+1)|1 (8U), a true normalized Gaussian kernel, separable on both axes with a single rounding,
 *   border REFLECT_101
 * - vertical compression warp: forward transform y' = t*y + anchor*(1-t) (the anchor line stays put), sampling by the inverse map
 *   src_y = (y - anchor*(1-t))/t; images use LANCZOS4 (8 taps), masks use bilinear + constant 0
 * - Telea inpainting fills distance layer by distance layer with fast marching (FMM): band pixels become KNOWN when popped,
 *   and INSIDE 4-neighbors solve the distance equation and are pushed; color = gradient extrapolation of the known neighbor pixels
 *   weighted by direction × distance × level
 * - ECC: MOTION_TRANSLATION Gauss-Newton with a lambda illumination compensation term; lambda_d ≤ 0 counts as
 *   non-convergent (the upper layer falls back to phase correlation)
 */

import type { Raster } from "./image.ts";

// ---------------------------------------------------------------------------
// Banker's rounding (.5 to even — the uniform rounding rule of this pipeline)
// ---------------------------------------------------------------------------

export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Fixed six-digit rounding (×1e6, round, then divide back) */
export function pyRound6(value: number): number {
  return pyRound(value * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Binary morphology (band: 0/1 or 0/255 both work, nonzero counts as set)
// ---------------------------------------------------------------------------

/** Dilation with a square all-ones kernel (out-of-bounds is 0) */
export function dilateBand(band: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const out = new Uint8Array(band.length);
  const r = (k - 1) >> 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let dy = -r; dy <= r && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (band[yy * width + xx] !== 0) {
            hit = 1;
            break;
          }
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/** Erosion with a square all-ones kernel (out-of-bounds is 255 → the border isn't eroded) */
export function erodeBand(band: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const out = new Uint8Array(band.length);
  const r = (k - 1) >> 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (band[yy * width + xx] === 0) {
            all = 0;
            break;
          }
        }
      }
      out[y * width + x] = all;
    }
  }
  return out;
}

/** Morphological closing (dilate then erode; the common 3x3 kernel form) */
export function morphClose3(band: Uint8Array, width: number, height: number): Uint8Array {
  return erodeBand(dilateBand(band, width, height, 3), width, height, 3);
}

// ---------------------------------------------------------------------------
// Connected components (8-connectivity, row-major label assignment; stats/centroids isomorphic to connectedComponentsWithStats)
// ---------------------------------------------------------------------------

export interface ConnectedComponentStats {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

export interface ConnectedComponentsResult {
  /** Label count (including background 0) */
  count: number;
  labels: Int32Array;
  stats: ConnectedComponentStats[];
  centroids: Array<{ cx: number; cy: number }>;
}

export function connectedComponentsWithStats(
  band: Uint8Array,
  width: number,
  height: number,
): ConnectedComponentsResult {
  const labels = new Int32Array(width * height).fill(-1);
  const stats: ConnectedComponentStats[] = [];
  const centroids: Array<{ cx: number; cy: number }> = [];
  // Background (label 0): the set of pixels with value 0
  stats.push({ x: 0, y: 0, w: width, h: height, area: 0 });
  let bgSumX = 0;
  let bgSumY = 0;
  let bgCount = 0;

  const queue = new Int32Array(width * height);
  let nextLabel = 1;
  for (let seed = 0; seed < width * height; seed++) {
    if (labels[seed] !== -1) continue;
    const seedValue = band[seed] !== 0;
    const label = seedValue ? nextLabel++ : 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    labels[seed] = label;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    while (head < tail) {
      const idx = queue[head++];
      const y = (idx / width) | 0;
      const x = idx - y * width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const n = yy * width + xx;
          if (labels[n] !== -1) continue;
          if ((band[n] !== 0) === seedValue) {
            labels[n] = label;
            queue[tail++] = n;
          }
        }
      }
    }
    if (seedValue) {
      stats.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
      centroids.push({ cx: sumX / area, cy: sumY / area });
    } else {
      // Total background area/centroid (adding back the parts merged during the scan)
      stats[0].area += area;
      bgSumX += sumX;
      bgSumY += sumY;
      bgCount += area;
    }
  }
  if (bgCount > 0) {
    centroids.unshift({ cx: bgSumX / bgCount, cy: bgSumY / bgCount });
  } else {
    centroids.unshift({ cx: 0, cy: 0 });
  }
  return { count: nextLabel, labels, stats, centroids };
}

// ---------------------------------------------------------------------------
// sigma Gaussian (8U semantic kernel + REFLECT_101)
// ---------------------------------------------------------------------------

/** reflect_101 border index (gfedcb|abcdefgh|gfedcba) */
function reflect101(idx: number, size: number): number {
  if (size === 1) return 0;
  if (idx < 0) idx = -idx;
  const period = 2 * (size - 1);
  idx = idx % period;
  return idx >= size ? period - idx : idx;
}

/** sigma Gaussian blur of a single-channel band (ksize = round(6σ+1)|1, separable on both axes, single rounding) */
export function cvGaussianBlurBand(
  band: Float64Array | Uint8Array,
  width: number,
  height: number,
  sigma: number,
): Uint8Array {
  const size = Math.max(3, Math.round(6 * sigma + 1) | 1);
  const radius = (size - 1) >> 1;
  const kernel = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - radius;
    kernel[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const mid = new Float64Array(band.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += band[y * width + reflect101(x + k, width)] * kernel[k + radius];
      }
      mid[y * width + x] = acc;
    }
  }
  const out = new Uint8Array(band.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += mid[reflect101(y + k, height) * width + x] * kernel[k + radius];
      }
      out[y * width + x] = Math.round(acc);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vertical compression warp (mouth-opening frame sequence)
// ---------------------------------------------------------------------------

function lanczos4(u: number): number {
  if (u === 0) return 1;
  const au = Math.abs(u);
  if (au >= 4) return 0;
  const a = Math.PI * u;
  return (4 * Math.sin(a) * Math.sin(a / 4)) / (a * a);
}

/**
 * Vertical compression warp: forward transform src_y' = t*src_y + anchor*(1-t) (the anchor row stays put,
 * other rows move toward it). Inverse map: dst row y ← src row (y - anchor*(1-t))/t,
 * vertical 8-tap LANCZOS4, REFLECT_101; horizontal identity (the integer-position kernel degenerates to a unit impulse).
 */
export function warpVerticalLanczos4(
  raster: Raster,
  t: number,
  anchor: number,
): Raster {
  const { width, height, data } = raster;
  const out: Raster = { width, height, data: new Uint8ClampedArray(data.length) };
  const srcYBase = anchor * (1 - t);
  for (let y = 0; y < height; y++) {
    const srcY = (y - srcYBase) / t;
    const y0 = Math.floor(srcY);
    const fy = srcY - y0;
    // 8-tap LANCZOS4 (k = y0-3 .. y0+4)
    const weights: number[] = [];
    let wsum = 0;
    for (let k = 0; k < 8; k++) {
      const w = lanczos4(fy - (k - 3));
      weights.push(w);
      wsum += w;
    }
    if (wsum !== 0) {
      for (let k = 0; k < 8; k++) weights[k] /= wsum;
    }
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < 8; k++) {
        const sy = reflect101(y0 + k - 3, height);
        const w = weights[k];
        if (w === 0) continue;
        const o = (sy * width + x) * 4;
        r += data[o] * w;
        g += data[o + 1] * w;
        b += data[o + 2] * w;
        a += data[o + 3] * w;
      }
      const d = (y * width + x) * 4;
      out.data[d] = Math.round(r);
      out.data[d + 1] = Math.round(g);
      out.data[d + 2] = Math.round(b);
      out.data[d + 3] = Math.round(a);
    }
  }
  return out;
}

/** Vertical compression warp of a mask: bilinear + constant 0 border */
export function warpVerticalBilinearMask(
  band: Uint8Array,
  width: number,
  height: number,
  t: number,
  anchor: number,
): Uint8Array {
  const out = new Uint8Array(band.length);
  const srcYBase = anchor * (1 - t);
  for (let y = 0; y < height; y++) {
    const srcY = (y - srcYBase) / t;
    const y0 = Math.floor(srcY);
    const fy = srcY - y0;
    const y1 = y0 + 1;
    const in0 = y0 >= 0 && y0 <= height - 1;
    const in1 = y1 >= 0 && y1 <= height - 1;
    for (let x = 0; x < width; x++) {
      const v0 = in0 ? band[y0 * width + x] : 0;
      const v1 = in1 ? band[y1 * width + x] : 0;
      out[y * width + x] = Math.round(v0 * (1 - fy) + v1 * fy);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Telea inpainting (FMM)
//
// fmSolve and inpaintTelea are adapted from OpenCV, modules/photo/src/inpaint.cpp (FastMarching_solve and
// icvTeleaInpaintFMM), translated to TypeScript for three-channel images.
// Copyright (C) 2000, Intel Corporation, all rights reserved.
// OpenCV is under the Apache License 2.0, and that file carries the Intel License Agreement. Both texts are in
// ../licenses/ (opencv-LICENSE, opencv-COPYRIGHT, opencv-intel-license.txt).
// ---------------------------------------------------------------------------

const FLAG_KNOWN = 0;
const FLAG_BAND = 1;
const FLAG_INSIDE = 2;

/** FMM distance equation (arrival time solution from a two-point combination) */
function fmSolve(
  i1: number,
  j1: number,
  i2: number,
  j2: number,
  flags: Uint8Array,
  tmap: Float64Array,
  ecols: number,
): number {
  const a11 = tmap[i1 * ecols + j1];
  const a22 = tmap[i2 * ecols + j2];
  const m12 = Math.min(a11, a22);
  if (flags[i1 * ecols + j1] !== FLAG_INSIDE) {
    if (flags[i2 * ecols + j2] !== FLAG_INSIDE) {
      if (Math.abs(a11 - a22) >= 1.0) {
        return 1 + m12;
      }
      return (a11 + a22 + Math.sqrt(2 - (a11 - a22) * (a11 - a22))) * 0.5;
    }
    return 1 + a11;
  }
  if (flags[i2 * ecols + j2] !== FLAG_INSIDE) {
    return 1 + a22;
  }
  return 1 + m12;
}

/** (T, order) min-heap with insertion order */
class FmmHeap {
  private ts: number[] = [];
  private orders: number[] = [];
  private is: number[] = [];
  private js: number[] = [];
  private nextOrder = 0;

  push(i: number, j: number, t: number): void {
    this.ts.push(t);
    this.orders.push(this.nextOrder++);
    this.is.push(i);
    this.js.push(j);
    let c = this.ts.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.less(c, p)) {
        this.swap(c, p);
        c = p;
      } else {
        break;
      }
    }
  }

  pop(): { i: number; j: number } | null {
    const n = this.ts.length;
    if (n === 0) return null;
    const i = this.is[0];
    const j = this.js[0];
    const last = n - 1;
    this.swap(0, last);
    this.ts.pop();
    this.orders.pop();
    this.is.pop();
    this.js.pop();
    let p = 0;
    for (;;) {
      const l = 2 * p + 1;
      const r = l + 1;
      let m = p;
      if (l < this.ts.length && this.less(l, m)) m = l;
      if (r < this.ts.length && this.less(r, m)) m = r;
      if (m === p) break;
      this.swap(p, m);
      p = m;
    }
    return { i, j };
  }

  private less(a: number, b: number): boolean {
    if (this.ts[a] !== this.ts[b]) return this.ts[a] < this.ts[b];
    return this.orders[a] < this.orders[b];
  }

  private swap(a: number, b: number): void {
    [this.ts[a], this.ts[b]] = [this.ts[b], this.ts[a]];
    [this.orders[a], this.orders[b]] = [this.orders[b], this.orders[a]];
    [this.is[a], this.is[b]] = [this.is[b], this.is[a]];
    [this.js[a], this.js[b]] = [this.js[b], this.js[a]];
  }
}

/** Dilation with a 3x3 cross kernel (only for initializing the inpainting band) */
function dilateCross(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = mask[y * width + x] !== 0;
      if (!hit && y > 0) hit = mask[(y - 1) * width + x] !== 0;
      if (!hit && y < height - 1) hit = mask[(y + 1) * width + x] !== 0;
      if (!hit && x > 0) hit = mask[y * width + x - 1] !== 0;
      if (!hit && x < width - 1) hit = mask[y * width + x + 1] !== 0;
      out[y * width + x] = hit ? 1 : 0;
    }
  }
  return out;
}

/**
 * Telea inpainting (RGB, radius default 3). The masked region is filled distance layer by distance layer (FMM) with the
 * direction×distance×level weighted sum of known neighbor pixels + first-order gradient extrapolation; pixels outside the mask are unchanged bit for bit.
 */
export function inpaintTelea(raster: Raster, mask: Uint8Array, inpaintRange = 3): Raster {
  const h = raster.height;
  const w = raster.width;
  const range = Math.max(1, Math.min(100, Math.round(inpaintRange)));
  const erows = h + 2;
  const ecols = w + 2;

  // Padded mask / flags / distance map (1-based coordinates, border 0)
  const pmask = new Uint8Array(erows * ecols);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pmask[(y + 1) * ecols + (x + 1)] = mask[y * w + x] !== 0 ? 1 : 0;
    }
  }
  const dilatedCross = dilateCross(pmask, ecols, ecols);
  const band = new Uint8Array(erows * ecols);
  for (let i = 0; i < band.length; i++) {
    band[i] = dilatedCross[i] !== 0 && pmask[i] === 0 ? 1 : 0;
  }
  const flags = new Uint8Array(erows * ecols); // KNOWN=0
  const tmap = new Float64Array(erows * ecols).fill(1.0e6);
  for (let i = 0; i < band.length; i++) {
    if (band[i] !== 0) {
      flags[i] = FLAG_BAND;
      tmap[i] = 0;
    } else if (pmask[i] !== 0) {
      flags[i] = FLAG_INSIDE;
    }
  }

  const out: Raster = { width: w, height: h, data: new Uint8ClampedArray(raster.data) };
  const heap = new FmmHeap();
  for (let i = 0; i < erows; i++) {
    for (let j = 0; j < ecols; j++) {
      if (band[i * ecols + j] !== 0) heap.push(i, j, 0);
    }
  }

  const at = (i: number, j: number) => i * ecols + j;
  for (;;) {
    const top = heap.pop();
    if (!top) break;
    const { i: ii, j: jj } = top;
    flags[at(ii, jj)] = FLAG_KNOWN;
    const neighbors: Array<[number, number]> = [
      [ii - 1, jj],
      [ii, jj - 1],
      [ii + 1, jj],
      [ii, jj + 1],
    ];
    for (const [i, j] of neighbors) {
      if (i <= 0 || j <= 0 || i > erows - 2 || j > ecols - 2) continue;
      if (flags[at(i, j)] !== FLAG_INSIDE) continue;
      const dist = Math.min(
        fmSolve(i - 1, j, i, j - 1, flags, tmap, ecols),
        fmSolve(i + 1, j, i, j - 1, flags, tmap, ecols),
        fmSolve(i - 1, j, i, j + 1, flags, tmap, ecols),
        fmSolve(i + 1, j, i, j + 1, flags, tmap, ecols),
      );
      tmap[at(i, j)] = dist;

      // Gradient of T (differences along the known direction)
      let gtx: number;
      if (flags[at(i, j + 1)] !== FLAG_INSIDE) {
        gtx =
          flags[at(i, j - 1)] !== FLAG_INSIDE
            ? (tmap[at(i, j + 1)] - tmap[at(i, j - 1)]) * 0.5
            : tmap[at(i, j + 1)] - tmap[at(i, j)];
      } else {
        gtx = flags[at(i, j - 1)] !== FLAG_INSIDE ? tmap[at(i, j)] - tmap[at(i, j - 1)] : 0;
      }
      let gty: number;
      if (flags[at(i + 1, j)] !== FLAG_INSIDE) {
        gty =
          flags[at(i - 1, j)] !== FLAG_INSIDE
            ? (tmap[at(i + 1, j)] - tmap[at(i - 1, j)]) * 0.5
            : tmap[at(i + 1, j)] - tmap[at(i, j)];
      } else {
        gty = flags[at(i - 1, j)] !== FLAG_INSIDE ? tmap[at(i, j)] - tmap[at(i - 1, j)] : 0;
      }

      const Ia = [0, 0, 0];
      const Jx = [0, 0, 0];
      const Jy = [0, 0, 0];
      const s = [1e-20, 1e-20, 1e-20];
      for (let k = i - range; k <= i + range; k++) {
        const km = k - 1 + (k === 1 ? 1 : 0);
        const kp = k - 1 - (k === erows - 2 ? 1 : 0);
        for (let l = j - range; l <= j + range; l++) {
          const lm = l - 1 + (l === 1 ? 1 : 0);
          const lp = l - 1 - (l === ecols - 2 ? 1 : 0);
          if (k <= 0 || l <= 0 || k >= erows - 1 || l >= ecols - 1) continue;
          if (flags[at(k, l)] === FLAG_INSIDE) continue;
          if ((l - j) * (l - j) + (k - i) * (k - i) > range * range) continue;
          const ry = i - k;
          const rx = j - l;
          const vl = rx * rx + ry * ry;
          if (vl === 0) continue;
          const dst = 1 / (vl * Math.sqrt(vl));
          const lev = 1 / (1 + Math.abs(tmap[at(k, l)] - tmap[at(i, j)]));
          let dir = rx * gtx + ry * gty;
          if (Math.abs(dir) <= 0.01) dir = 1e-6;
          const wgt = Math.abs(dst * lev * dir);
          for (let color = 0; color < 3; color++) {
            let gix = 0;
            if (flags[at(k, l + 1)] !== FLAG_INSIDE) {
              gix =
                flags[at(k, l - 1)] !== FLAG_INSIDE
                  ? (out.data[(km * w + lp + 1) * 4 + color] - out.data[(km * w + lm - 1) * 4 + color]) * 2
                  : out.data[(km * w + lp + 1) * 4 + color] - out.data[(km * w + lm) * 4 + color];
            } else if (flags[at(k, l - 1)] !== FLAG_INSIDE) {
              gix = out.data[(km * w + lp) * 4 + color] - out.data[(km * w + lm - 1) * 4 + color];
            }
            let giy = 0;
            if (flags[at(k + 1, l)] !== FLAG_INSIDE) {
              giy =
                flags[at(k - 1, l)] !== FLAG_INSIDE
                  ? (out.data[((kp + 1) * w + lm) * 4 + color] - out.data[((km - 1) * w + lm) * 4 + color]) * 2
                  : out.data[((kp + 1) * w + lm) * 4 + color] - out.data[(km * w + lm) * 4 + color];
            } else if (flags[at(k - 1, l)] !== FLAG_INSIDE) {
              giy = out.data[(kp * w + lm) * 4 + color] - out.data[((km - 1) * w + lm) * 4 + color];
            }
            Ia[color] += wgt * out.data[((k - 1) * w + (l - 1)) * 4 + color];
            Jx[color] -= wgt * gix * rx;
            Jy[color] -= wgt * giy * ry;
            s[color] += wgt;
          }
        }
      }
      for (let color = 0; color < 3; color++) {
        const sat =
          Ia[color] / s[color] +
          (Jx[color] + Jy[color]) / (Math.sqrt(Jx[color] * Jx[color] + Jy[color] * Jy[color]) + 1e-20);
        const v = Math.round(sat + 0.5);
        out.data[((i - 1) * w + (j - 1)) * 4 + color] = Math.max(0, Math.min(255, v));
      }
      flags[at(i, j)] = FLAG_BAND;
      heap.push(i, j, dist);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Translation registration: ECC (MOTION_TRANSLATION) + phase correlation fallback
//
// eccTranslation is adapted from OpenCV, modules/video/src/ecc.cpp (cv::findTransformECC), translated to TypeScript
// and reduced to the translation model. It carries the same copyright notice and license texts as the inpainting
// code above.
// ---------------------------------------------------------------------------

/** 5x5 binomial Gaussian ([1,4,6,4,1]/16, REFLECT_101) — ECC pre-smoothing */
function gauss5x5(mat: Float64Array, width: number, height: number): Float64Array {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float64Array(mat.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -2; i <= 2; i++) {
        acc += mat[y * width + reflect101(x + i, width)] * k[i + 2];
      }
      tmp[y * width + x] = acc;
    }
  }
  const out = new Float64Array(mat.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -2; i <= 2; i++) {
        acc += tmp[reflect101(y + i, height) * width + x] * k[i + 2];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

/** Central difference gradient (REFLECT_101) */
function centralGradient(mat: Float64Array, width: number, height: number, axis: "x" | "y"): Float64Array {
  const out = new Float64Array(mat.length);
  if (axis === "x") {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] =
          0.5 * (mat[y * width + reflect101(x + 1, width)] - mat[y * width + reflect101(x - 1, width)]);
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] =
          0.5 * (mat[reflect101(y + 1, height) * width + x] - mat[reflect101(y - 1, height) * width + x]);
      }
    }
  }
  return out;
}

/** Inverse-mapped translation warp (src sampled at (x+tx, y+ty), out of bounds 0, bilinear) */
function warpTranslation(
  mat: Float64Array,
  width: number,
  height: number,
  tx: number,
  ty: number,
): Float64Array {
  const out = new Float64Array(mat.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x + tx;
      const sy = y + ty;
      if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      out[y * width + x] =
        mat[y0 * width + x0] * (1 - fx) * (1 - fy) +
        mat[y0 * width + x1] * fx * (1 - fy) +
        mat[y1 * width + x0] * (1 - fx) * fy +
        mat[y1 * width + x1] * fx * fy;
    }
  }
  return out;
}

export class EccNoConvergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EccNoConvergenceError";
  }
}

/**
 * MOTION_TRANSLATION ECC: Gauss-Newton iterations aligning input → template.
 * Returns (tx, ty): input translated by (tx, ty) aligns with template (at working resolution).
 * Non-convergence (lambda_d ≤ 0 / zero norm / singular Hessian) throws EccNoConvergenceError.
 */
export function eccTranslation(
  template: Float64Array,
  input: Float64Array,
  width: number,
  height: number,
  maxIterations = 200,
  epsilon = 1e-5,
): { tx: number; ty: number; rho: number } {
  const tf = gauss5x5(template, width, height);
  const imf = gauss5x5(input, width, height);
  const gx = centralGradient(imf, width, height, "x");
  const gy = centralGradient(imf, width, height, "y");
  let tx = 0;
  let ty = 0;
  let rho = -1;
  let lastRho = -epsilon;

  for (let iter = 0; iter < maxIterations && Math.abs(rho - lastRho) >= epsilon; iter++) {
    const iw = warpTranslation(imf, width, height, tx, ty);
    const gxw = warpTranslation(gx, width, height, tx, ty);
    const gyw = warpTranslation(gy, width, height, tx, ty);
    // Valid pixels (whose inverse map lands in bounds)
    const valid = new Uint8Array(width * height);
    let n = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = x + tx;
        const sy = y + ty;
        if (sx >= 0 && sy >= 0 && sx <= width - 1 && sy <= height - 1) {
          valid[y * width + x] = 1;
          n++;
        }
      }
    }
    if (n === 0) {
      throw new EccNoConvergenceError("no overlapping pixels");
    }
    let imgSum = 0;
    let tmpSum = 0;
    for (let i = 0; i < valid.length; i++) {
      if (valid[i]) {
        imgSum += iw[i];
        tmpSum += tf[i];
      }
    }
    const imgMean = imgSum / n;
    const tmpMean = tmpSum / n;
    let imgVar = 0;
    let tmpVar = 0;
    let correlation = 0;
    for (let i = 0; i < valid.length; i++) {
      if (!valid[i]) continue;
      const iv = iw[i] - imgMean;
      const tv = tf[i] - tmpMean;
      imgVar += iv * iv;
      tmpVar += tv * tv;
      correlation += tv * iv;
    }
    const imgNorm = Math.sqrt(imgVar);
    const tmpNorm = Math.sqrt(tmpVar);
    if (imgNorm === 0 || tmpNorm === 0) {
      throw new EccNoConvergenceError("zero-norm image");
    }
    // Zero-mean copies + valid-region gradients
    const iwZm = new Float64Array(iw.length);
    const tfZm = new Float64Array(tf.length);
    const jx = new Float64Array(iw.length);
    const jy = new Float64Array(iw.length);
    for (let i = 0; i < valid.length; i++) {
      if (!valid[i]) continue;
      iwZm[i] = iw[i] - imgMean;
      tfZm[i] = tf[i] - tmpMean;
      jx[i] = gxw[i];
      jy[i] = gyw[i];
    }
    // Hessian (2x2 symmetric)
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    let ipx = 0;
    let ipy = 0;
    let tpx = 0;
    let tpy = 0;
    for (let i = 0; i < valid.length; i++) {
      if (!valid[i]) continue;
      h00 += jx[i] * jx[i];
      h01 += jx[i] * jy[i];
      h11 += jy[i] * jy[i];
      ipx += jx[i] * iwZm[i];
      ipy += jy[i] * iwZm[i];
      tpx += jx[i] * tfZm[i];
      tpy += jy[i] * tfZm[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (det === 0) {
      throw new EccNoConvergenceError("singular Hessian");
    }
    const hi00 = h11 / det;
    const hi01 = -h01 / det;
    const hi11 = h00 / det;
    lastRho = rho;
    rho = correlation / (imgNorm * tmpNorm);
    const iphx = hi00 * ipx + hi01 * ipy;
    const iphy = hi01 * ipx + hi11 * ipy;
    const lambdaN = imgNorm * imgNorm - (ipx * iphx + ipy * iphy);
    const lambdaD = correlation - (tpx * iphx + tpy * iphy);
    if (lambdaD <= 0) {
      throw new EccNoConvergenceError("correlation is going to be minimized");
    }
    const lambda = lambdaN / lambdaD;
    // error = lambda * templateZM - imageWarped(ZM)
    let epx = 0;
    let epy = 0;
    for (let i = 0; i < valid.length; i++) {
      if (!valid[i]) continue;
      const err = lambda * tfZm[i] - iwZm[i];
      epx += jx[i] * err;
      epy += jy[i] * err;
    }
    tx += hi00 * epx + hi01 * epy;
    ty += hi01 * epx + hi11 * epy;
  }
  return { tx, ty, rho };
}

// ---------------------------------------------------------------------------
// Phase correlation (radix-2 FFT; input size must be a power of 2, and shifts must be much smaller than the size to avoid wraparound)
// ---------------------------------------------------------------------------

/** In-place radix-2 FFT (re/im lengths are powers of 2) */
function fftInPlace(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** 2D FFT (power-of-2 size; flattened row-major) */
function fft2d(re: Float64Array, im: Float64Array, width: number, height: number, inverse: boolean): void {
  const rowRe = new Float64Array(width);
  const rowIm = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rowRe[x] = re[y * width + x];
      rowIm[x] = im[y * width + x];
    }
    fftInPlace(rowRe, rowIm, inverse);
    for (let x = 0; x < width; x++) {
      re[y * width + x] = rowRe[x];
      im[y * width + x] = rowIm[x];
    }
  }
  const colRe = new Float64Array(height);
  const colIm = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      colRe[y] = re[y * width + x];
      colIm[y] = im[y * width + x];
    }
    fftInPlace(colRe, colIm, inverse);
    for (let y = 0; y < height; y++) {
      re[y * width + x] = colRe[y];
      im[y * width + x] = colIm[y];
    }
  }
}

/**
 * Phase correlation: returns the shift (dx, dy) of b relative to a (b ≈ a translated by (dx, dy)).
 * The peak gets 1D parabolic sub-pixel refinement.
 */
export function phaseCorrelate(
  a: Float64Array,
  b: Float64Array,
  width: number,
  height: number,
): { dx: number; dy: number } {
  const n = width * height;
  const reA = Float64Array.from(a);
  const imA = new Float64Array(n);
  const reB = Float64Array.from(b);
  const imB = new Float64Array(n);
  fft2d(reA, imA, width, height, false);
  fft2d(reB, imB, width, height, false);
  // Cross-power spectrum (magnitude-normalized): R = conj(A)·B — when b = a shifted by d the peak lands at +d
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rr = reA[i] * reB[i] + imA[i] * imB[i];
    const ii = reA[i] * imB[i] - imA[i] * reB[i];
    const mag = Math.hypot(rr, ii);
    const norm = mag === 0 ? 1 : mag;
    re[i] = rr / norm;
    im[i] = ii / norm;
  }
  fft2d(re, im, width, height, true);
  // Peak (taking the real-part magnitude)
  let peak = 0;
  let peakIdx = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(re[i]);
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
  }
  const py = (peakIdx / width) | 0;
  const px = peakIdx - py * width;
  const wrap = (v: number, size: number) => ((v % size) + size) % size;
  const at = (x: number, y: number) => wrap(y, height) * width + wrap(x, width);
  const parabola = (left: number, center: number, right: number): number => {
    const denom = left - 2 * center + right;
    return denom === 0 ? 0 : 0.5 * (left - right) / denom;
  };
  const dxs = parabola(re[at(px - 1, py)], re[at(px, py)], re[at(px + 1, py)]);
  const dys = parabola(re[at(px, py - 1)], re[at(px, py)], re[at(px, py + 1)]);
  let dx = px + dxs;
  let dy = py + dys;
  if (dx > width / 2) dx -= width;
  if (dy > height / 2) dy -= height;
  return { dx, dy };
}
