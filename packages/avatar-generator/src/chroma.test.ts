// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chroma key unit tests — keyOutBackground / despill / background mask flood fill / cropping
 * (goldens measured from the reference implementation: green screen small image alpha rows, despilled edge pixels).
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import type { Raster } from "./image.ts";
import { createRaster, setPixel } from "./image.ts";
import {
  backgroundMask,
  chromaLikeMask,
  cropToAlphaBbox,
  decontaminateChromaEdges,
  growBackground,
  keyOutBackground,
} from "./chroma.ts";
import { pixel } from "./test_fixtures.ts";

/** A 24x16 green screen subject measured from the reference implementation (rectangle 6..14 × 4..11) */
function greenSmall(): Raster {
  const raster = createRaster(24, 16, [0, 255, 0, 255]);
  for (let y = 4; y <= 11; y++) {
    for (let x = 6; x <= 14; x++) {
      setPixel(raster, x, y, [240, 220, 200, 255]);
    }
  }
  return raster;
}

test("chromaLikeMask: 双公差（32/64）命中集", () => {
  const raster = createRaster(3, 1, [0, 255, 0, 255]);
  setPixel(raster, 1, 0, [10, 240, 10, 255]); // Per-channel differences 10/15/10 → within the tight tolerance
  setPixel(raster, 2, 0, [240, 220, 200, 255]); // Subject color → outside both tolerances
  const tight = chromaLikeMask(raster, 32, [0, 255, 0]);
  const wide = chromaLikeMask(raster, 64, [0, 255, 0]);
  assert.equal(tight[0], 255);
  assert.equal(tight[1], 255);
  assert.equal(tight[2], 0);
  assert.equal(wide[0], 255);
  assert.equal(wide[2], 0);
});

test("backgroundMask: 边界连通 + 小口袋；大封闭区保留", () => {
  const width = 12;
  const height = 10;
  const mask = new Uint8Array(width * height);
  // Border-connected background band: row 0
  for (let x = 0; x < width; x++) mask[x] = 255;
  // Central 2x2 enclosed pocket (4/120 = 3.3% > 1.5% → kept)
  mask[5 * width + 5] = 255;
  mask[5 * width + 6] = 255;
  mask[6 * width + 5] = 255;
  mask[6 * width + 6] = 255;
  const bg = backgroundMask(mask, width, height);
  assert.equal(bg[0], 255); // Border-connected
  assert.equal(bg[5 * width + 5], 0); // Large pocket kept
  // Small pocket (1px, < 1.5%) → treated as background
  mask[8 * width + 8] = 255;
  const bg2 = backgroundMask(mask, width, height);
  assert.equal(bg2[8 * width + 8], 255);
});

test("growBackground: 只向宽公差像素逐圈生长", () => {
  const width = 10;
  const height = 4;
  const bg = new Uint8Array(width * height);
  const wide = new Uint8Array(width * height);
  for (let x = 0; x < 3; x++) {
    bg[x] = 255;
    wide[x] = 255;
  }
  wide[3] = 255; // The wide tolerance allows column 3
  const grown = growBackground(bg, wide, width, height);
  assert.equal(grown[3], 255);
  assert.equal(grown[4], 0);
  // Nowhere to grow → stable
  const stable = growBackground(bg, bg, width, height);
  assert.equal(stable[3], 0);
});

test("keyOutBackground: 绿屏黄金（alpha 行 + 主体颜色保真）", () => {
  const raster = greenSmall();
  const rgba = keyOutBackground(raster, 32, [0, 255, 0]);
  // Measured from the reference implementation: row 0 fully transparent; row 7 edge feathering [240,254,255…]
  for (let x = 0; x < 24; x++) {
    assert.equal(pixel(rgba, x, 0)[3], 0, `row0 x=${x}`);
  }
  const row7 = Array.from({ length: 24 }, (_, x) => pixel(rgba, x, 7)[3]);
  assert.deepEqual(row7, [0, 0, 0, 0, 0, 0, 240, 254, 255, 255, 255, 255, 255, 254, 240, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // Subject interior colors unchanged (despill doesn't touch non-spill pixels)
  assert.deepEqual(pixel(rgba, 10, 7), [240, 220, 200, 255]);
});

test("decontaminateChromaEdges: 绿溢反解黄金（边缘收紧 + 主体饱和色不动）", () => {
  const chroma = [0, 255, 0] as const;
  const foreground = [240, 220, 200] as const;
  const image = createRaster(12, 5, [...foreground, 255]);
  for (let y = 0; y < 5; y++) {
    setPixel(image, 0, y, [chroma[0], chroma[1], chroma[2], 0]);
    const fractions = [0.25, 0.5, 0.75];
    for (let x = 1; x <= 3; x++) {
      const fraction = fractions[x - 1]!;
      const composite = [0, 1, 2].map((c) =>
        Math.round(fraction * foreground[c] + (1 - fraction) * chroma[c]),
      );
      setPixel(image, x, y, [composite[0], composite[1], composite[2], Math.min(255, Math.round(fraction * 330))]);
    }
  }
  // Legitimate saturated colors inside the subject must not be touched
  setPixel(image, 9, 2, [20, 210, 35, 255]);
  const original = pixel(image, 2, 2);
  assert.deepEqual(original, [120, 238, 100, 165]);

  const cleaned = decontaminateChromaEdges(image, chroma);
  // Goldens measured from the reference implementation
  assert.deepEqual(pixel(cleaned, 2, 2), [223, 223, 186, 137]);
  assert.deepEqual(pixel(cleaned, 1, 2), [222, 222, 185, 69]);
  assert.deepEqual(pixel(cleaned, 3, 2), [223, 223, 186, 206]);
  assert.deepEqual(pixel(cleaned, 9, 2), [20, 210, 35, 255]);
  assert.deepEqual(pixel(cleaned, 0, 2), [0, 0, 0, 0]);
});

test("decontaminateChromaEdges: 中性灰屏（无主导通道）→ 原样返回", () => {
  const image = createRaster(4, 4, [10, 200, 30, 255]);
  const cleaned = decontaminateChromaEdges(image, [128, 128, 128]);
  assert.deepEqual(pixel(cleaned, 1, 1), [10, 200, 30, 255]);
});

test("cropToAlphaBbox: 裁到 alpha≥8；全透明抛错", () => {
  const raster = createRaster(8, 6, [0, 0, 0, 0]);
  for (let y = 2; y < 5; y++) {
    for (let x = 3; x < 7; x++) {
      setPixel(raster, x, y, [255, 0, 0, 255]);
    }
  }
  const { image, bbox } = cropToAlphaBbox(raster);
  assert.deepEqual(bbox, [3, 2, 7, 5]);
  assert.equal(image.width, 4);

  assert.throws(
    () => cropToAlphaBbox(createRaster(4, 4, [0, 0, 0, 0])),
    /fully transparent/,
  );
});
