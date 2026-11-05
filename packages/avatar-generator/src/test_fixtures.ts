// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Synthetic assets for pipeline unit tests (only referenced by *.test.ts; never in any production call chain).
 *
 * Everything is drawn with solid rectangles — pixel-deterministic, reproducible bit for bit by any implementation,
 * so golden assertions stay reusable across refactors.
 */

import type { Raster } from "./image.ts";
import { createRaster, fillRectangle } from "./image.ts";

/** Rectangle (endpoint-inclusive) */
type Rect = readonly [number, number, number, number];

/** Gray screen synthetic character pair (neutral gray background + body/head/closed mouth + open mouth dark cavity) */
export function makeRectAvatarPair(): { base: Raster; opened: Raster } {
  const base = createRaster(1024, 1024, [128, 128, 128, 255]);
  fillRectangle(base, [330, 330, 694, 1000], [49, 93, 139, 255]); // Body #315d8b
  fillRectangle(base, [400, 100, 624, 370], [241, 191, 156, 255]); // Head #f1bf9c
  fillRectangle(base, [486, 228, 538, 240], [104, 45, 57, 255]); // Closed mouth #682d39

  const opened = createRaster(1024, 1024, [128, 128, 128, 255]);
  fillRectangle(opened, [330, 330, 694, 1000], [49, 93, 139, 255]);
  fillRectangle(opened, [400, 100, 624, 370], [241, 191, 156, 255]);
  fillRectangle(opened, [482, 234, 542, 292], [69, 19, 34, 255]); // Open mouth dark cavity #451322
  fillRectangle(opened, [494, 263, 530, 285], [169, 75, 100, 255]); // Tongue #a94b64
  return { base, opened };
}

/** Green screen synthetic character pair (for the pipeline path: deterministic chroma key) */
export function makeGreenAvatarPair(): { base: Raster; opened: Raster } {
  const base = createRaster(1024, 1024, [0, 255, 0, 255]);
  fillRectangle(base, [330, 330, 694, 1000], [49, 93, 139, 255]);
  fillRectangle(base, [400, 100, 624, 370], [241, 191, 156, 255]);
  fillRectangle(base, [486, 228, 538, 240], [104, 45, 57, 255]);

  const opened = createRaster(1024, 1024, [0, 255, 0, 255]);
  fillRectangle(opened, [330, 330, 694, 1000], [49, 93, 139, 255]);
  fillRectangle(opened, [400, 100, 624, 370], [241, 191, 156, 255]);
  fillRectangle(opened, [482, 234, 542, 292], [69, 19, 34, 255]);
  fillRectangle(opened, [494, 263, 530, 285], [169, 75, 100, 255]);
  return { base, opened };
}

/** Registration test texture (256x256, with lines to guarantee gradients) */
export function makeRegisterFixture(): Raster {
  const img = createRaster(256, 256, [30, 30, 40, 255]);
  fillRectangle(img, [40, 60, 120, 180], [220, 180, 140, 255]);
  fillRectangle(img, [150, 30, 210, 110], [60, 120, 200, 255]);
  for (let x = 0; x < 256; x += 17) {
    fillRectangle(img, [x, 0, x, 255], [50 + (x % 60), 40, 60, 255]);
  }
  return img;
}

/** Small green screen + subject (for chroma key goldens: 24x16) */
export function makeSmallGreenFixture(): Raster {
  const img = createRaster(24, 16, [0, 255, 0, 255]);
  fillRectangle(img, [6, 4, 14, 11], [240, 220, 200, 255]);
  return img;
}

/** Pixel-by-pixel equality (including size and every RGBA byte) */
export function rastersEqual(a: Raster, b: Raster): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** Reads a pixel quadruple */
export function pixel(raster: Raster, x: number, y: number): [number, number, number, number] {
  const o = (y * raster.width + x) * 4;
  return [raster.data[o], raster.data[o + 1], raster.data[o + 2], raster.data[o + 3]];
}
