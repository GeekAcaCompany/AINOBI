// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PNG codec unit tests — decoding goldens use real PNG bytes produced by the production image stack;
 * the encoding side focuses on round trips and structure checks.
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { decodePng, encodePng } from "./png.ts";
import { createRaster, setPixel } from "./image.ts";
import { pixel } from "./test_fixtures.ts";

/** An 8x6 RGBA PNG produced by the production image stack (golden bytes) */
const RGBA_SAMPLE_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAANklEQVR4nKWNsQkAMAzDZOgDfiBz/38wxWtLpk4WSGABFO7CWd282G4wYMHLCUYZTjDK8P/FAXADFM4kujgrAAAAAElFTkSuQmCC";

/** A 5x4 grayscale PNG produced by the production image stack (golden bytes) */
const GRAY_SAMPLE_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAAAAABjWKqcAAAAE0lEQVR4nGNkMDIyMmLiBAFkEgAVOwFXiz1ZUgAAAABJRU5ErkJggg==";

test("png: 解码线上图像栈产出的 RGBA PNG（黄金像素对拍）", () => {
  const raster = decodePng(Buffer.from(RGBA_SAMPLE_B64, "base64"));
  assert.equal(raster.width, 8);
  assert.equal(raster.height, 6);
  const expected: Array<[number, number, number, number]> = [
    [0, 0, 0, 0], [30, 0, 17, 255], [60, 0, 34, 255], [90, 0, 51, 0],
    [120, 0, 68, 255], [150, 0, 85, 255], [180, 0, 102, 0], [210, 0, 119, 255],
    [0, 40, 17, 255], [30, 40, 34, 255], [60, 40, 51, 0], [90, 40, 68, 255],
    [120, 40, 85, 255], [150, 40, 102, 0], [180, 40, 119, 255], [210, 40, 136, 255],
    [0, 80, 34, 255], [30, 80, 51, 0], [60, 80, 68, 255], [90, 80, 85, 255],
    [120, 80, 102, 0], [150, 80, 119, 255], [180, 80, 136, 255], [210, 80, 153, 0],
    [0, 120, 51, 0], [30, 120, 68, 255], [60, 120, 85, 255], [90, 120, 102, 0],
    [120, 120, 119, 255], [150, 120, 136, 255], [180, 120, 153, 0], [210, 120, 170, 255],
    [0, 160, 68, 255], [30, 160, 85, 255], [60, 160, 102, 0], [90, 160, 119, 255],
    [120, 160, 136, 255], [150, 160, 153, 0], [180, 160, 170, 255], [210, 160, 187, 255],
    [0, 200, 85, 255], [30, 200, 102, 0], [60, 200, 119, 255], [90, 200, 136, 255],
    [120, 200, 153, 0], [150, 200, 170, 255], [180, 200, 187, 255], [210, 200, 204, 0],
  ];
  expected.forEach((rgba, index) => {
    const x = index % 8;
    const y = Math.floor(index / 8);
    assert.deepEqual(pixel(raster, x, y), rgba, `pixel (${x},${y})`);
  });
});

test("png: 解码线上图像栈产出的灰度 PNG（color type 0）", () => {
  const raster = decodePng(Buffer.from(GRAY_SAMPLE_B64, "base64"));
  assert.equal(raster.width, 5);
  assert.equal(raster.height, 4);
  const expected = [0, 50, 100, 150, 200, 9, 59, 109, 159, 209, 18, 68, 118, 168, 218, 27, 77, 127, 177, 227];
  expected.forEach((value, index) => {
    const x = index % 5;
    const y = Math.floor(index / 5);
    const rgba = pixel(raster, x, y);
    assert.equal(rgba[0], value);
    assert.equal(rgba[1], value);
    assert.equal(rgba[2], value);
    assert.equal(rgba[3], 255);
  });
});

test("png: 编码 → 解码 roundtrip（逐字节 RGBA 保真）", () => {
  const raster = createRaster(13, 7, [0, 0, 0, 0]);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 13; x++) {
      setPixel(raster, x, y, [(x * 19) % 256, (y * 37) % 256, (x + y) * 11 % 256, (x * y) % 256]);
    }
  }
  const encoded = encodePng(raster);
  // PNG structure: signature + IHDR length 13
  assert.equal(encoded[0], 0x89);
  assert.equal(encoded[1], 0x50);
  const decoded = decodePng(encoded);
  assert.equal(decoded.width, 13);
  assert.equal(decoded.height, 7);
  for (let i = 0; i < raster.data.length; i++) {
    assert.equal(decoded.data[i], raster.data[i]);
  }
});

test("png: 坏签名 / 截断 chunk → 显式报错", () => {
  assert.throws(() => decodePng(Buffer.from("not a png at all..........")), /invalid PNG signature/);
  const good = encodePng(createRaster(4, 4, [1, 2, 3, 255]));
  const truncated = good.subarray(0, 30);
  assert.throws(() => decodePng(truncated));
});
