// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Raster image kernel (interleaved RGBA buffers + filter/geometry/drawing primitives with reference semantics).
 *
 * The avatar pipeline does all pixel processing in a runtime with no native image library:
 * - resampling (NEAREST / BILINEAR / LANCZOS) aligned bit for bit with the existing production plane semantics
 *   (the support widens proportionally when downsampling, weights normalized)
 * - Gaussian blur implemented as "three passes of extended box filtering" (including float32 fixed-point mantissas — goldens locked bit for bit)
 * - Min/Max filters don't count out-of-bounds pixels (the window is clipped)
 * - rectangle drawing includes endpoints, crop/paste boxes are half-open — consistent with the reference implementation
 * A 5x7 dot-matrix font for annotations is embedded in this file.
 */

/** RGBA8 raster (data length is always width*height*4) */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Pixel coordinate box (half-open) */
export type Box = [number, number, number, number];

/** Resampling filter */
export type ResampleFilter = "nearest" | "bilinear" | "lanczos";

export function createRaster(width: number, height: number, fill: readonly [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { width, height, data };
}

export function cloneRaster(raster: Raster): Raster {
  return {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data),
  };
}

/** Reads a pixel (out-of-bounds coordinates replicate the edge; the result is written into a reused array) */
export function getPixel(raster: Raster, x: number, y: number, out: number[] = []): number[] {
  const cx = Math.min(Math.max(x, 0), raster.width - 1);
  const cy = Math.min(Math.max(y, 0), raster.height - 1);
  const o = (cy * raster.width + cx) * 4;
  out[0] = raster.data[o];
  out[1] = raster.data[o + 1];
  out[2] = raster.data[o + 2];
  out[3] = raster.data[o + 3];
  return out;
}

export function setPixel(raster: Raster, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    return;
  }
  const o = (y * raster.width + x) * 4;
  raster.data[o] = rgba[0];
  raster.data[o + 1] = rgba[1];
  raster.data[o + 2] = rgba[2];
  raster.data[o + 3] = rgba[3];
}

/** Crop (half-open box; out-of-bounds and negative width/height clamped/thrown as in the reference implementation) */
export function cropRaster(raster: Raster, box: Box): Raster {
  let [x0, y0, x1, y1] = box;
  x0 = Math.max(0, Math.min(x0, raster.width));
  y0 = Math.max(0, Math.min(y0, raster.height));
  x1 = Math.max(0, Math.min(x1, raster.width));
  y1 = Math.max(0, Math.min(y1, raster.height));
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const width = x1 - x0;
  const height = y1 - y0;
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y++) {
    const srcRow = ((y0 + y) * raster.width + x0) * 4;
    const dstRow = (y * width) * 4;
    out.data.set(raster.data.subarray(srcRow, srcRow + width * 4), dstRow);
  }
  return out;
}

/**
 * Paste: pastes src into dst with (dx, dy) as the top-left corner.
 * With a mask (a 0..255 single-channel band the same size as src), alpha blends
 * (dst = src*mask + dst*(1-mask), per channel including alpha).
 */
export function pasteRaster(
  dst: Raster,
  src: Raster,
  dx: number,
  dy: number,
  mask?: Uint8Array,
): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      const m = mask ? mask[y * src.width + x] / 255 : 255;
      if (m >= 1) {
        dst.data[d] = src.data[s];
        dst.data[d + 1] = src.data[s + 1];
        dst.data[d + 2] = src.data[s + 2];
        dst.data[d + 3] = src.data[s + 3];
      } else if (m > 0) {
        dst.data[d] = src.data[s] * m + dst.data[d] * (1 - m);
        dst.data[d + 1] = src.data[s + 1] * m + dst.data[d + 1] * (1 - m);
        dst.data[d + 2] = src.data[s + 2] * m + dst.data[d + 2] * (1 - m);
        dst.data[d + 3] = src.data[s + 3] * m + dst.data[d + 3] * (1 - m);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

/** Lanczos-windowed sinc (lobe is the support radius) */
function lanczos(u: number, lobe: number): number {
  if (u === 0) return 1;
  if (Math.abs(u) >= lobe) return 0;
  const a = Math.PI * u;
  return (lobe * Math.sin(a) * Math.sin(a / lobe)) / (a * a);
}

/** Triangle kernel (the separable form of bilinear) */
function triangle(u: number): number {
  if (u <= -1 || u >= 1) return 0;
  return 1 - Math.abs(u);
}

interface Weights {
  start: number;
  weights: number[];
}

/** Precomputes 1D resampling weights (the support widens proportionally when downsampling) */
function resampleWeights(inSize: number, outSize: number, filter: ResampleFilter): Weights[] {
  const result: Weights[] = [];
  const ratio = inSize / outSize;
  const support = filter === "lanczos" ? 3.0 : filter === "bilinear" ? 1.0 : 0.5;
  const filterFn = (u: number) =>
    filter === "lanczos" ? lanczos(u, 3.0) : filter === "bilinear" ? triangle(u) : 0;
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * ratio - 0.5;
    const half = support * Math.max(1, ratio);
    const x0 = Math.max(0, Math.ceil(center - half));
    const x1 = Math.min(inSize - 1, Math.floor(center + half));
    const weights: number[] = [];
    let sum = 0;
    for (let x = x0; x <= x1; x++) {
      const u = (x - center) / Math.max(1, ratio);
      const w = filterFn(u);
      weights.push(w);
      sum += w;
    }
    if (sum !== 0) {
      for (let k = 0; k < weights.length; k++) weights[k] /= sum;
    }
    result.push({ start: x0, weights });
  }
  return result;
}

/** Resampling (two separable passes; horizontal first, then vertical) */
export function resizeRaster(raster: Raster, width: number, height: number, filter: ResampleFilter): Raster {
  if (filter === "nearest") {
    const out = createRaster(width, height, [0, 0, 0, 0]);
    for (let y = 0; y < height; y++) {
      const sy = Math.min(raster.height - 1, Math.floor((y + 0.5) * (raster.height / height)));
      for (let x = 0; x < width; x++) {
        const sx = Math.min(raster.width - 1, Math.floor((x + 0.5) * (raster.width / width)));
        const s = (sy * raster.width + sx) * 4;
        const d = (y * width + x) * 4;
        out.data[d] = raster.data[s];
        out.data[d + 1] = raster.data[s + 1];
        out.data[d + 2] = raster.data[s + 2];
        out.data[d + 3] = raster.data[s + 3];
      }
    }
    return out;
  }
  const wx = resampleWeights(raster.width, width, filter);
  const wy = resampleWeights(raster.height, height, filter);
  // Horizontal
  const mid = new Float64Array(width * raster.height * 4);
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < width; x++) {
      const { start, weights } = wx[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < weights.length; k++) {
        const s = (y * raster.width + start + k) * 4;
        const w = weights[k];
        r += raster.data[s] * w;
        g += raster.data[s + 1] * w;
        b += raster.data[s + 2] * w;
        a += raster.data[s + 3] * w;
      }
      const d = (y * width + x) * 4;
      mid[d] = r;
      mid[d + 1] = g;
      mid[d + 2] = b;
      mid[d + 3] = a;
    }
  }
  // Vertical + rounding
  const out = createRaster(width, height, [0, 0, 0, 0]);
  for (let y = 0; y < height; y++) {
    const { start, weights } = wy[y];
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < weights.length; k++) {
        const s = ((start + k) * width + x) * 4;
        const w = weights[k];
        r += mid[s] * w;
        g += mid[s + 1] * w;
        b += mid[s + 2] * w;
        a += mid[s + 3] * w;
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

/** Proportional fit into a box (shrink only, never enlarge) — thumbnail semantics */
export function thumbnailRaster(raster: Raster, box: readonly [number, number]): Raster {
  const [bw, bh] = box;
  const scale = Math.min(bw / raster.width, bh / raster.height, 1);
  if (scale >= 1) {
    return cloneRaster(raster);
  }
  const width = Math.max(1, Math.round(raster.width * scale));
  const height = Math.max(1, Math.round(raster.height * scale));
  return resizeRaster(raster, width, height, "lanczos");
}

// ---------------------------------------------------------------------------
// Single-channel band (L mode) tools
// ---------------------------------------------------------------------------

/** RGBA → ITU-R 601-2 luma band (L = (299R + 587G + 114B)/1000) */
export function luminanceBand(raster: Raster): Uint8Array {
  const band = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < band.length; i++) {
    const o = i * 4;
    band[i] = (raster.data[o] * 299 + raster.data[o + 1] * 587 + raster.data[o + 2] * 114) / 1000;
  }
  return band;
}

/** Extracts the alpha channel band */
export function alphaBand(raster: Raster): Uint8Array {
  const band = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < band.length; i++) {
    band[i] = raster.data[i * 4 + 3];
  }
  return band;
}

/** Overwrites alpha with a single-channel band */
export function putAlphaBand(raster: Raster, band: Uint8Array): void {
  for (let i = 0; i < band.length; i++) {
    raster.data[i * 4 + 3] = band[i];
  }
}

/** Nonzero bbox (getbbox semantics; all zero returns null) */
export function bandBBox(band: Uint8Array, width: number, height: number): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (band[y * width + x] !== 0) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return [x0, y0, x1 + 1, y1 + 1];
}

/** bbox above a threshold (v >= threshold counts as valid) */
export function bandThresholdBBox(band: Uint8Array, width: number, height: number, threshold: number): Box | null {
  const flags = Uint8Array.from(band, (v) => (v >= threshold ? 1 : 0));
  return bandBBox(flags, width, height);
}

/** Histogram (256 buckets) */
export function bandHistogram(band: Uint8Array): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < band.length; i++) {
    hist[band[i]] += 1;
  }
  return hist;
}

// ---------------------------------------------------------------------------
// Gaussian blur ("extended box filter" implementation — three passes approximating a Gaussian)
//
// gaussianBlurBoxRadius and boxBlurLine are adapted from Pillow, src/libImaging/BoxBlur.c (_gaussian_blur_radius and
// ImagingLineBoxBlur8), translated to TypeScript.
// Copyright © 1997-2011 by Secret Labs AB. Copyright © 1995-2011 by Fredrik Lundh and contributors.
// Copyright © 2010 by Jeffrey 'Alex' Clark and contributors.
// Pillow is under the MIT-CMU license, in ../licenses/pillow-LICENSE.
// ---------------------------------------------------------------------------

/** Target sigma → radius of a single extended box filter pass (gwosdek-ssvm11 [7][11][14]; float32 throughout) */
function gaussianBlurBoxRadius(radius: number, passes: number): number {
  const f = Math.fround;
  const sigma2 = f(f(radius * radius) / passes);
  const L = f(Math.sqrt(f(f(12.0 * sigma2) + 1.0)));
  const l = Math.floor(f((L - 1.0) / 2.0));
  const a = f(
    f((2 * l + 1) * f(l * (l + 1) - 3 * sigma2)) /
      f(6 * f(sigma2 - f((l + 1) * (l + 1)))),
  );
  return f(l + a);
}

/** Single horizontal extended box filter pass (uint8 fixed point, edge replication; bit-identical to the reference implementation) */
function boxBlurLine(line: Uint8Array, out: Uint8Array, floatRadius: number): void {
  const n = line.length;
  const radius = Math.trunc(floatRadius);
  const fr21 = Math.fround(Math.fround(floatRadius * 2) + 1);
  // The reference implementation truncates after a float32 division
  const ww = Math.trunc(Math.fround((1 << 24) / fr21));
  const fw = Math.floor(((1 << 24) - (radius * 2 + 1) * ww) / 2);
  const edgeA = Math.min(radius + 1, n);
  const edgeB = Math.max(n - radius - 1, 0);

  let acc = line[0] * (radius + 1);
  for (let x = 0; x < edgeA - 1; x++) {
    acc += line[x];
  }
  acc += line[n - 1] * (radius - edgeA + 1);

  const save = (x: number, left: number, right: number) => {
    const bulk = acc * ww + (line[left] + line[right]) * fw;
    // bulk ≤ 255*2^24 < 2^32: must shift as unsigned 32-bit (>> would wrap through int32)
    out[x] = (bulk + (1 << 23)) >>> 24;
  };

  if (edgeA <= edgeB) {
    for (let x = 0; x < edgeA; x++) {
      acc += line[x + radius] - line[0];
      save(x, 0, x + radius + 1);
    }
    for (let x = edgeA; x < edgeB; x++) {
      acc += line[x + radius] - line[x - radius - 1];
      save(x, x - radius - 1, x + radius + 1);
    }
    for (let x = edgeB; x < n; x++) {
      acc += line[n - 1] - line[x - radius - 1];
      save(x, x - radius - 1, n - 1);
    }
  } else {
    for (let x = 0; x < edgeB; x++) {
      acc += line[x + radius] - line[0];
      save(x, 0, x + radius + 1);
    }
    for (let x = edgeB; x < edgeA; x++) {
      acc += line[n - 1] - line[0];
      save(x, 0, n - 1);
    }
    for (let x = edgeA; x < n; x++) {
      acc += line[n - 1] - line[x - radius - 1];
      save(x, x - radius - 1, n - 1);
    }
  }
}

/** Transposes a single-channel band */
function transposeBand(band: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(band.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[x * height + y] = band[y * width + x];
    }
  }
  return out;
}

/**
 * Gaussian blur of a single-channel band (radius is sigma;
 * approximated with three extended box filter passes, three horizontal and three vertical, uint8 fixed-point rounding per pass).
 */
export function gaussianBlurBand(
  band: Uint8Array,
  width: number,
  height: number,
  radius: number,
  passes = 3,
): Uint8Array {
  if (radius === 0) {
    return Uint8Array.from(band);
  }
  const boxRadius = gaussianBlurBoxRadius(radius, passes);
  let cur: Uint8Array = Uint8Array.from(band);
  const rowOut = new Uint8Array(width);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      const row = cur.subarray(y * width, (y + 1) * width);
      boxBlurLine(row, rowOut, boxRadius);
      cur.set(rowOut, y * width);
    }
  }
  let t: Uint8Array = transposeBand(cur, width, height);
  const colOut = new Uint8Array(height);
  for (let pass = 0; pass < passes; pass++) {
    for (let x = 0; x < width; x++) {
      const col = t.subarray(x * height, (x + 1) * height);
      boxBlurLine(col, colOut, boxRadius);
      t.set(colOut, x * height);
    }
  }
  cur = transposeBand(t, height, width);
  return cur;
}

// ---------------------------------------------------------------------------
// Min/Max filters (out-of-window pixels don't count)
// ---------------------------------------------------------------------------

/** k×k minimum filter (k odd) */
export function minFilterBand(band: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const out = new Uint8Array(band.length);
  const r = (k - 1) >> 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 255;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const v = band[yy * width + xx];
          if (v < best) best = v;
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

/** k×k maximum filter (k odd) */
export function maxFilterBand(band: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const out = new Uint8Array(band.length);
  const r = (k - 1) >> 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const v = band[yy * width + xx];
          if (v > best) best = v;
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

/** Rectangle fill (includes endpoints — consistent with the reference implementation's draw.rectangle semantics) */
export function fillRectangle(raster: Raster, box: Box, color: readonly [number, number, number, number]): void {
  const [x0, y0, x1, y1] = box;
  for (let y = Math.max(0, y0); y <= Math.min(raster.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(raster.width - 1, x1); x++) {
      const o = (y * raster.width + x) * 4;
      raster.data[o] = color[0];
      raster.data[o + 1] = color[1];
      raster.data[o + 2] = color[2];
      raster.data[o + 3] = color[3];
    }
  }
}

/** Rectangle outline (includes endpoints; width is the line width, growing outward) */
export function strokeRectangle(
  raster: Raster,
  box: Box,
  color: readonly [number, number, number, number],
  width = 1,
): void {
  const [x0, y0, x1, y1] = box;
  const w = Math.max(1, width);
  fillRectangle(raster, [x0, y0, x1, y0 + w - 1], color);
  fillRectangle(raster, [x0, y1 - w + 1, x1, y1], color);
  fillRectangle(raster, [x0, y0, x0 + w - 1, y1], color);
  fillRectangle(raster, [x1 - w + 1, y0, x1, y1], color);
}

/** Ellipse fill (inscribed in the endpoint-inclusive box) */
export function fillEllipse(raster: Raster, box: Box, color: readonly [number, number, number, number]): void {
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.max(0.5, (x1 - x0) / 2);
  const ry = Math.max(0.5, (y1 - y0) / 2);
  for (let y = Math.max(0, y0); y <= Math.min(raster.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(raster.width - 1, x1); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) {
        const o = (y * raster.width + x) * 4;
        raster.data[o] = color[0];
        raster.data[o + 1] = color[1];
        raster.data[o + 2] = color[2];
        raster.data[o + 3] = color[3];
      }
    }
  }
}

/** Checkerboard background (cell is the square width) */
export function checkerboardRaster(
  size: readonly [number, number],
  cell = 24,
  light: readonly [number, number, number] = [225, 225, 225],
  dark: readonly [number, number, number] = [170, 170, 170],
): Raster {
  const out = createRaster(size[0], size[1], [light[0], light[1], light[2], 255]);
  for (let y = 0; y < size[1]; y++) {
    for (let x = 0; x < size[0]; x++) {
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 1) {
        const o = (y * size[0] + x) * 4;
        out.data[o] = dark[0];
        out.data[o + 1] = dark[1];
        out.data[o + 2] = dark[2];
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5x7 dot-matrix font (panel annotations)
// ---------------------------------------------------------------------------

/** 7 rows × 5 bits per glyph (MSB on the left) */
const FONT_5X7: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  "%": [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "+": [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  ":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  a: [0x00, 0x00, 0x0e, 0x01, 0x0f, 0x11, 0x0f],
  b: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x1e],
  c: [0x00, 0x00, 0x0f, 0x10, 0x10, 0x10, 0x0f],
  d: [0x01, 0x01, 0x0f, 0x11, 0x11, 0x11, 0x0f],
  e: [0x00, 0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e],
  f: [0x06, 0x08, 0x08, 0x1e, 0x08, 0x08, 0x08],
  g: [0x00, 0x0f, 0x11, 0x11, 0x0f, 0x01, 0x1e],
  h: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x11],
  i: [0x04, 0x00, 0x0c, 0x04, 0x04, 0x04, 0x0e],
  j: [0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0c],
  k: [0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12],
  l: [0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  m: [0x00, 0x00, 0x1a, 0x15, 0x15, 0x15, 0x15],
  n: [0x00, 0x00, 0x1e, 0x11, 0x11, 0x11, 0x11],
  o: [0x00, 0x00, 0x0e, 0x11, 0x11, 0x11, 0x0e],
  p: [0x00, 0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10],
  q: [0x00, 0x0f, 0x11, 0x11, 0x0f, 0x01, 0x01],
  r: [0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10],
  s: [0x00, 0x00, 0x0f, 0x10, 0x0e, 0x01, 0x1e],
  t: [0x08, 0x08, 0x1e, 0x08, 0x08, 0x08, 0x06],
  u: [0x00, 0x00, 0x11, 0x11, 0x11, 0x11, 0x0f],
  v: [0x00, 0x00, 0x11, 0x11, 0x11, 0x0a, 0x04],
  w: [0x00, 0x00, 0x11, 0x15, 0x15, 0x15, 0x0a],
  x: [0x00, 0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11],
  y: [0x00, 0x11, 0x11, 0x11, 0x0f, 0x01, 0x1e],
  z: [0x00, 0x00, 0x1f, 0x02, 0x04, 0x08, 0x1f],
};

/** Draws text starting at (x, y) (1px between characters, 8px line height; unknown characters render as spaces) */
export function drawText(
  raster: Raster,
  x: number,
  y: number,
  text: string,
  color: readonly [number, number, number, number],
): void {
  let cursor = x;
  for (const ch of text) {
    const glyph = FONT_5X7[ch] ?? FONT_5X7[" "]!;
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          setPixel(raster, cursor + col, y + row, color);
        }
      }
    }
    cursor += 6;
  }
}

/** Top annotation bar (background color + white text) — for review panels */
export function labelPanel(raster: Raster, label: string): Raster {
  const out = cloneRaster(raster);
  fillRectangle(out, [0, 0, out.width - 1, 27], [9, 13, 20, 255]);
  drawText(out, 10, 8, label, [255, 255, 255, 255]);
  return out;
}

/** Proportional fit centered on a dark canvas (vision _fit) */
export function fitPanel(raster: Raster, size: readonly [number, number]): Raster {
  const rgb = cloneRaster(raster);
  // Consistent with the reference implementation: convert to RGB, then resize
  for (let i = 0; i < rgb.data.length; i += 4) {
    rgb.data[i + 3] = 255;
  }
  const thumb = thumbnailRaster(rgb, size);
  const canvas = createRaster(size[0], size[1], [34, 40, 52, 255]);
  pasteRaster(canvas, thumb, Math.floor((size[0] - thumb.width) / 2), Math.floor((size[1] - thumb.height) / 2));
  return canvas;
}
