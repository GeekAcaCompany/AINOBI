// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Translation registration unit tests — applyShift integer translation semantics + registerTranslation known-shift
 * recovery goldens (final values measured from the reference implementation on the same texture) + zeroing of out-of-range shifts.
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { createRaster, fillRectangle, setPixel } from "./image.ts";
import { applyShift, registerTranslation } from "./register.ts";
import { makeRegisterFixture, pixel, rastersEqual } from "./test_fixtures.ts";

test("applyShift: 整数平移（正向移出填黑、透明图填透）", () => {
  const raster = createRaster(5, 5, [0, 0, 0, 255]);
  fillRectangle(raster, [2, 2, 2, 2], [255, 255, 255, 255]);
  const shifted = applyShift(raster, 2, 1);
  assert.deepEqual(pixel(shifted, 4, 3), [255, 255, 255, 255]);
  assert.deepEqual(pixel(shifted, 2, 2), [0, 0, 0, 255]);
  // Transparent RGBA translation → filled with transparency
  const rgba = createRaster(4, 4, [9, 9, 9, 0]);
  setPixel(rgba, 1, 1, [200, 100, 50, 128]);
  const shiftedRgba = applyShift(rgba, 1, 0);
  assert.deepEqual(pixel(shiftedRgba, 2, 1), [200, 100, 50, 128]);
  assert.deepEqual(pixel(shiftedRgba, 0, 1), [0, 0, 0, 0]);
  // Zero shift → identical copy
  const same = applyShift(raster, 0, 0);
  assert.ok(rastersEqual(same, raster));
});

test("registerTranslation: 已知位移恢复黄金（±1px）", () => {
  const img = makeRegisterFixture();
  const cases: Array<[number, number, [number, number]]> = [
    [12, -8, [-12, 8]],
    [-20, 14, [20, -14]],
    [0, 0, [0, 0]],
    [7, 9, [-7, -9]],
    [-33, -21, [33, 20]],
  ];
  for (const [dx, dy, expected] of cases) {
    const shifted = applyShift(img, dx, dy);
    const got = registerTranslation(img, shifted);
    assert.ok(
      Math.abs(got[0] - expected[0]) <= 1 && Math.abs(got[1] - expected[1]) <= 1,
      `shift (${dx},${dy}) → got (${got[0]},${got[1]}) want (${expected[0]},${expected[1]})`,
    );
  }
});

test("registerTranslation: 远超带宽的真实位移在 1/4 尺度混叠（与参考实现同行为）", () => {
  const img = makeRegisterFixture();
  const shifted = applyShift(img, 200, 0);
  // A 200px shift is outside the 64px phase correlation bandwidth → the peak aliases to ~120px (measured 122 in the reference implementation)
  const got = registerTranslation(img, shifted);
  assert.equal(got[1], 0);
  assert.ok(got[0] >= 110 && got[0] <= 135, `aliased estimate ${got[0]}`);
});
