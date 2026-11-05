// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pixel algorithm layer unit tests — morphology/connected components/sigma Gaussian/warp/Telea inpainting/ECC/phase correlation.
 * Morphology and connected component goldens measured from the reference library; the same for warp and the Gaussian impulse response.
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import type { Raster } from "./image.ts";
import { createRaster, fillRectangle, setPixel } from "./image.ts";
import {
  EccNoConvergenceError,
  connectedComponentsWithStats,
  cvGaussianBlurBand,
  dilateBand,
  eccTranslation,
  erodeBand,
  inpaintTelea,
  morphClose3,
  phaseCorrelate,
  pyRound,
  pyRound6,
  warpVerticalBilinearMask,
  warpVerticalLanczos4,
} from "./cvops.ts";

// ---------------------------------------------------------------------------
// pyRound / pyRound6 (banker's rounding)
// ---------------------------------------------------------------------------

test("pyRound: .5 取偶（银行家舍入语义）", () => {
  assert.equal(pyRound(8.5), 8);
  assert.equal(pyRound(9.5), 10);
  assert.equal(pyRound(-8.5), -8);
  assert.equal(pyRound(0.5), 0);
  assert.equal(pyRound(1.5), 2);
  assert.equal(pyRound(-0.5), 0);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(7.48), 7);
  assert.equal(pyRound(2.09), 2);
  assert.equal(pyRound(3), 3);
});

test("pyRound6: round(x, 6) 定点语义", () => {
  assert.equal(pyRound6(0.28292355), 0.282924);
  assert.equal(pyRound6(0.00848252), 0.008483);
  assert.equal(pyRound6(1), 1);
});

// ---------------------------------------------------------------------------
// Morphology (goldens: dilate treats out-of-bounds as 0 / erode as 255)
// ---------------------------------------------------------------------------

function mask9(): Uint8Array {
  const m = new Uint8Array(7 * 7);
  for (let x = 0; x < 7; x++) m[0 * 7 + x] = 1; // Top row all 1
  for (let y = 3; y < 7; y++) {
    for (let x = 3; x < 7; x++) m[y * 7 + x] = 1; // Bottom-right 4x4
  }
  return m;
}

test("morph: dilate/erode/close 与参考库逐位一致（含图像边界）", () => {
  const m = new Uint8Array(7 * 7);
  for (let y = 3; y < 7; y++) {
    for (let x = 3; x < 7; x++) m[y * 7 + x] = 1;
  }
  const dil = dilateBand(m, 7, 7, 3);
  // Reference library dilate: the region grows 1px in every direction (out of bounds is 0, so no outward growth)
  assert.equal(dil[2 * 7 + 2], 1);
  assert.equal(dil[3 * 7 + 3], 1);
  assert.equal(dil[2 * 7 + 1], 0);
  // Border shape with the top row all 1: dilate doesn't go out of bounds
  const m2 = mask9();
  const dil2 = dilateBand(m2, 7, 7, 3);
  assert.equal(dil2[0], 1);
  // erode: the top row mask is eroded by the 0 row at y=1 (eroded if any 4-neighbor is 0)
  const ero2 = erodeBand(m2, 7, 7, 3);
  assert.equal(ero2[0], 0);
  // Closing = dilate → erode: the bottom-right block grows then shrinks, and its outer edge returns to place
  const closed = morphClose3(m, 7, 7);
  assert.equal(closed[3 * 7 + 3], 1);
  assert.equal(closed[2 * 7 + 2], 0);
});

// ---------------------------------------------------------------------------
// Connected components (stats/centroids goldens)
// ---------------------------------------------------------------------------

test("connectedComponents: stats/centroids 黄金（8 邻接，背景=0）", () => {
  const m = new Uint8Array(10 * 12);
  for (let y = 1; y < 3; y++) {
    for (let x = 1; x < 4; x++) m[y * 12 + x] = 1;
  }
  for (let y = 5; y < 8; y++) {
    for (let x = 6; x < 10; x++) m[y * 12 + x] = 1;
  }
  const cc = connectedComponentsWithStats(m, 12, 10);
  assert.equal(cc.count, 3);
  assert.deepEqual(cc.stats[0], { x: 0, y: 0, w: 12, h: 10, area: 102 });
  assert.deepEqual(cc.stats[1], { x: 1, y: 1, w: 3, h: 2, area: 6 });
  assert.deepEqual(cc.stats[2], { x: 6, y: 5, w: 4, h: 3, area: 12 });
  assert.ok(Math.abs(cc.centroids[0]!.cx - 5.470588235294118) < 1e-9);
  assert.equal(cc.centroids[0]!.cy, 4.5);
  assert.deepEqual(cc.centroids[1], { cx: 2, cy: 1.5 });
  assert.deepEqual(cc.centroids[2], { cx: 7.5, cy: 6 });
  // Label consistency: label 1 covers the top-left block
  assert.equal(cc.labels[1 * 12 + 1], 1);
  assert.equal(cc.labels[6 * 12 + 8], 2);
  assert.equal(cc.labels[0], 0);
});

// ---------------------------------------------------------------------------
// Sigma Gaussian (impulse response golden)
// ---------------------------------------------------------------------------

test("cvGaussianBlur: σ=1.4 冲激响应黄金（ksize 自动 9，单次舍入）", () => {
  const size = 21;
  const delta = new Float64Array(size * size);
  delta[10 * size + 10] = 255;
  const blurred = cvGaussianBlurBand(delta, size, size, 1.4);
  const row = Array.from(blurred.subarray(10 * size, 10 * size + size));
  assert.deepEqual(row, [0, 0, 0, 0, 0, 0, 0, 2, 7, 16, 21, 16, 7, 2, 0, 0, 0, 0, 0, 0, 0]);
});

test("cvGaussianBlur: REFLECT_101 边界（角落不引入黑边）", () => {
  const flat = new Float64Array(16 * 16).fill(200);
  const blurred = cvGaussianBlurBand(flat, 16, 16, 1.4);
  for (const v of blurred) {
    assert.equal(v, 200);
  }
});

// ---------------------------------------------------------------------------
// Vertical compression warp
// ---------------------------------------------------------------------------

function rampRaster(width: number, height: number): Raster {
  const raster = createRaster(width, height, [0, 0, 0, 255]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(raster, x, y, [Math.min(255, y * 12), 0, 0, 255]);
    }
  }
  return raster;
}

test("warpLanczos4: t=0.5 锚点 8 的竖向压缩黄金（前向变换语义）", () => {
  const src = rampRaster(10, 20);
  const warped = warpVerticalLanczos4(src, 0.5, 8);
  // dst row y ← src row (y-4)/0.5: rows 6..12 take src 4,6,8,10,12,14,16
  const got = [6, 7, 8, 9, 10, 11, 12].map((y) => warped.data[(y * 10 + 0) * 4]);
  assert.deepEqual(got, [48, 72, 96, 120, 144, 168, 192]);
});

test("warpLanczos4: t=1 恒等（逐字节）", () => {
  const src = rampRaster(9, 15);
  const warped = warpVerticalLanczos4(src, 1, 7);
  for (let i = 0; i < src.data.length; i++) {
    assert.equal(warped.data[i], src.data[i]);
  }
});

test("warpBilinearMask: 亚像素位置线性插值 + 常量 0 边界", () => {
  const height = 20;
  const width = 4;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) mask[y * width + x] = Math.min(255, y * 10);
  }
  // t=0.75, anchor=2 → src_y = (y-0.5)/0.75; y=3 → 10/3 → 33.3 → 33
  const warped = warpVerticalBilinearMask(mask, width, height, 0.75, 2);
  assert.equal(warped[3 * width + 0], 33);
  // y=0 → src_y = -2.67 → out of bounds → 0
  assert.equal(warped[0], 0);
});

// ---------------------------------------------------------------------------
// Telea inpainting
// ---------------------------------------------------------------------------

test("inpaintTelea: 常量图回填 ±2 内（参考实现 J 项归一噪声同量级）；掩码外逐位不变", () => {
  const raster = createRaster(15, 15, [77, 77, 77, 255]);
  const mask = new Uint8Array(15 * 15);
  for (let y = 5; y < 10; y++) {
    for (let x = 5; x < 10; x++) mask[y * 15 + x] = 255;
  }
  const fixed = inpaintTelea(raster, mask, 3);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const o = (y * 15 + x) * 4;
      const inHole = y >= 5 && y < 10 && x >= 5 && x < 10;
      if (inHole) {
        assert.ok(Math.abs(fixed.data[o] - 77) <= 2, `(${x},${y})=${fixed.data[o]}`);
      } else {
        assert.equal(fixed.data[o], 77);
        assert.equal(fixed.data[o + 1], 77);
        assert.equal(fixed.data[o + 2], 77);
      }
    }
  }
  // The original image isn't modified
  assert.equal(raster.data[0], 77);
});

test("inpaintTelea: 横向斜坡挖洞 → 近线性回填（±3 容差）", () => {
  const raster = createRaster(24, 20, [0, 0, 0, 255]);
  for (let x = 0; x < 24; x++) {
    fillRectangle(raster, [x, 0, x, 19], [Math.min(255, x * 11), 0, 0, 255]);
  }
  const mask = new Uint8Array(24 * 20);
  for (let y = 8; y < 13; y++) {
    for (let x = 9; x < 16; x++) mask[y * 24 + x] = 255;
  }
  const fixed = inpaintTelea(raster, mask, 3);
  for (let y = 8; y < 13; y++) {
    for (let x = 9; x < 16; x++) {
      const o = (y * 24 + x) * 4;
      assert.ok(
        Math.abs(fixed.data[o] - x * 11) <= 20,
        `(${x},${y}) got ${fixed.data[o]} want ~${x * 11}`,
      );
    }
  }
  // Outside the mask is untouched
  assert.equal(fixed.data[(0 * 24 + 5) * 4], 55);
});

// ---------------------------------------------------------------------------
// ECC / phase correlation
// ---------------------------------------------------------------------------

/** Smooth texture (sin×cos + deterministic micro noise): gradients everywhere, so ECC can converge */
function smoothTexture(width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const noise = ((x * 7 + y * 13) % 17) * 0.5;
      out[y * width + x] = Math.min(255, Math.max(0, Math.sin(y * 0.35) * 90 + Math.cos(x * 0.21) * 70 + noise));
    }
  }
  return out;
}

/** Integer-shift sampling with reflection padding (shifted samples have no black bands — ECC isn't biased by border artifacts) */
function shiftReflect(
  mat: Float64Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Float64Array {
  const reflect = (i: number, size: number): number => {
    if (size === 1) return 0;
    if (i < 0) i = -i;
    const period = 2 * (size - 1);
    i = i % period;
    return i >= size ? period - i : i;
  };
  const out = new Float64Array(mat.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = mat[reflect(y - dy, height) * width + reflect(x - dx, width)];
    }
  }
  return out;
}

test("eccTranslation: 已知平移恢复（反射填充移位，±0.01px）", () => {
  const width = 64;
  const height = 64;
  const base = smoothTexture(width, height);
  const shifted = (dx: number, dy: number) => shiftReflect(base, width, height, dx, dy);
  for (const [dx, dy] of [[3, -2], [-5, 4], [2, 2], [0, 0], [-7, -3]] as const) {
    const result = eccTranslation(base, shifted(dx, dy), width, height);
    assert.ok(Math.abs(result.tx - dx) <= 0.01, `tx: ${result.tx} want ${dx}`);
    assert.ok(Math.abs(result.ty - dy) <= 0.01, `ty: ${result.ty} want ${dy}`);
  }
  // Large displacements may fall into the "correlation will be minimized" zone → explicitly non-convergent (the upper layer falls back to phase correlation)
  assert.throws(() => eccTranslation(base, shifted(8, 6), width, height), EccNoConvergenceError);
});

test("eccTranslation: 平图 → 显式不收敛（供上层回退相位相关）", () => {
  const flat = new Float64Array(32 * 32).fill(128);
  assert.throws(
    () => eccTranslation(flat, flat, 32, 32),
    EccNoConvergenceError,
  );
});

test("phaseCorrelate: 已知平移恢复（亚像素抛物线细化，±0.5px）", () => {
  const width = 64;
  const height = 64;
  const base = smoothTexture(width, height);
  for (const [dx, dy] of [[3, -2], [-6, 5], [0, 0]] as const) {
    const shifted = shiftReflect(base, width, height, dx, dy);
    const result = phaseCorrelate(base, shifted, width, height);
    assert.ok(Math.abs(result.dx - dx) <= 0.5, `dx: ${result.dx} want ${dx}`);
    assert.ok(Math.abs(result.dy - dy) <= 0.5, `dy: ${result.dy} want ${dy}`);
  }
});
