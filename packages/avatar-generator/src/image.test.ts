// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Image kernel unit tests — Gaussian blur (extended box filter goldens), resampling (bilinear goldens),
 * Min/Max filters, paste blending, checkerboard and text drawing.
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  createRaster,
  cropRaster,
  fillRectangle,
  gaussianBlurBand,
  maxFilterBand,
  minFilterBand,
  pasteRaster,
  resizeRaster,
  setPixel,
  thumbnailRaster,
} from "./image.ts";
import { pixel } from "./test_fixtures.ts";

/** Builds a single-channel band (row-major) */
function band(width: number, height: number, fill: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = fill(x, y);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gaussian blur (delta impulse response goldens)
// ---------------------------------------------------------------------------

test("gaussianBlur: radius=1.0 冲激响应与参考实现逐位一致", () => {
  const size = 21;
  const impulse = band(size, size, (x, y) => (x === 10 && y === 10 ? 255 : 0));
  const blurred = gaussianBlurBand(impulse, size, size, 1.0);
  const row = Array.from(blurred.subarray(10 * size, 10 * size + size));
  const col = Array.from(blurred.filter((_, i) => i % size === 10));
  // Golden values measured from the production image stack with the same params
  assert.deepEqual(row, [0, 0, 0, 0, 0, 0, 0, 1, 6, 24, 42, 24, 6, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(col, [0, 0, 0, 0, 0, 0, 0, 0, 6, 24, 42, 24, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("gaussianBlur: 多半径冲激响应黄金（0.5 / 1.4 / 2.0 / 3.0）", () => {
  const size = 33;
  const c = 16;
  for (const [radius, expected] of [
    [0.5, [0, 0, 0, 1, 21, 154, 21, 1, 0, 0, 0]] as const,
    [1.4, [0, 0, 2, 7, 15, 17, 15, 7, 2, 0, 0]] as const,
    [2.0, [1, 2, 4, 6, 8, 9, 8, 6, 4, 2, 1]] as const,
    [3.0, [2, 2, 3, 4, 4, 4, 4, 4, 3, 2, 2]] as const,
  ]) {
    const impulse = band(size, size, (x, y) => (x === c && y === c ? 255 : 0));
    const blurred = gaussianBlurBand(impulse, size, size, radius);
    const half = Math.floor(expected.length / 2);
    const row = Array.from(blurred.subarray(c * size + c - half, c * size + c + half + 1));
    assert.deepEqual(row, [...expected], `radius=${radius}`);
  }
});

test("gaussianBlur: 阶跃边缘过渡带黄金", () => {
  // A 16x1 step with columns 8..15 at 255 → the transition band measured from the reference implementation
  const step = band(16, 1, (x) => (x >= 8 ? 255 : 0));
  const blurred = gaussianBlurBand(step, 16, 1, 1.0);
  assert.deepEqual(Array.from(blurred), [0, 0, 0, 0, 0, 1, 15, 75, 179, 240, 254, 255, 255, 255, 255, 255]);
});

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

test("resize: BILINEAR 16→4 斜坡黄金", () => {
  const raster = createRaster(16, 16, [0, 0, 0, 255]);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      setPixel(raster, x, y, [Math.min(255, x * 16), 0, 0, 255]);
    }
  }
  const small = resizeRaster(raster, 4, 4, "bilinear");
  assert.deepEqual(
    [0, 1, 2, 3].map((x) => pixel(small, x, 0)[0]),
    [30, 88, 152, 210],
  );
});

test("resize: NEAREST 2x 放大为 2x2 块；LANCZOS 恒等缩放保尺寸", () => {
  const raster = createRaster(2, 2, [0, 0, 0, 255]);
  setPixel(raster, 1, 0, [255, 0, 0, 255]);
  setPixel(raster, 0, 1, [0, 255, 0, 255]);
  setPixel(raster, 1, 1, [0, 0, 255, 255]);
  const up = resizeRaster(raster, 4, 4, "nearest");
  assert.deepEqual(pixel(up, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(up, 1, 1), [0, 0, 0, 255]);
  assert.deepEqual(pixel(up, 2, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(up, 1, 3), [0, 255, 0, 255]);
  assert.deepEqual(pixel(up, 3, 3), [0, 0, 255, 255]);
  const same = resizeRaster(raster, 2, 2, "lanczos");
  assert.equal(same.width, 2);
});

test("thumbnail: 只缩不放，等比进盒", () => {
  const raster = createRaster(100, 50, [1, 2, 3, 255]);
  const thumb = thumbnailRaster(raster, [40, 40]);
  assert.equal(thumb.width, 40);
  assert.equal(thumb.height, 20);
  const unchanged = thumbnailRaster(raster, [200, 200]);
  assert.equal(unchanged.width, 100);
});

// ---------------------------------------------------------------------------
// Min/Max filters (out-of-window pixels don't count)
// ---------------------------------------------------------------------------

test("minFilter/maxFilter: 方块腐蚀与膨胀（含角落行为）", () => {
  const m = band(9, 9, (x, y) => (x >= 3 && y >= 3 ? 255 : 0));
  const min3 = minFilterBand(m, 9, 9, 3);
  // The (4,4) window is all 255; the edge (3,3) window contains 0 → 0
  assert.equal(min3[4 * 9 + 4], 255);
  assert.equal(min3[3 * 9 + 3], 0);
  const max3 = maxFilterBand(m, 9, 9, 3);
  // The (2,2) window touches (3,3) → 255
  assert.equal(max3[2 * 9 + 2], 255);
  assert.equal(max3[1 * 9 + 1], 0);
});

// ---------------------------------------------------------------------------
// crop / paste
// ---------------------------------------------------------------------------

test("crop: 左闭右开裁剪", () => {
  const raster = createRaster(10, 10, [0, 0, 0, 255]);
  fillRectangle(raster, [2, 2, 5, 5], [255, 0, 0, 255]);
  const cropped = cropRaster(raster, [2, 2, 6, 6]);
  assert.equal(cropped.width, 4);
  assert.equal(cropped.height, 4);
  assert.deepEqual(pixel(cropped, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(cropped, 3, 3), [255, 0, 0, 255]);
});

test("paste: 带 mask 的 alpha 混合（mask=128 → 各半）", () => {
  const dst = createRaster(2, 1, [0, 0, 0, 255]);
  const src = createRaster(2, 1, [100, 100, 100, 255]);
  const mask = new Uint8Array([0, 128]);
  pasteRaster(dst, src, 0, 0, mask);
  assert.deepEqual(pixel(dst, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(dst, 1, 0), [50, 50, 50, 255]);
});
