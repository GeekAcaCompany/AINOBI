// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Matting unit tests — a synthetic character on a 1024 gray screen: cutout bbox/alpha golden parity
 * (measured from the reference implementation); the green screen path uses loose assertions (despill involves floating point path differences).
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { alphaBand } from "./image.ts";
import { cutout } from "./segment.ts";
import { makeGreenAvatarPair, makeRectAvatarPair, pixel } from "./test_fixtures.ts";

test("cutout: 灰屏角色黄金（bbox + 角落/主体 alpha + 边缘过渡带）", () => {
  const { base } = makeRectAvatarPair();
  const { image, bbox } = cutout(base, "synthetic avatar", true);
  // bbox measured from the reference implementation
  assert.deepEqual(bbox, [327, 97, 698, 1004]);
  assert.equal(pixel(image, 3, 3)[3], 0);
  assert.equal(pixel(image, 512, 500)[3], 255);
  // Transition band goldens at the head's left edge (row 240, x=396..404) and the skull's top edge (column 512, y=96..104)
  const alpha = alphaBand(image);
  const row = Array.from({ length: 9 }, (_, i) => alpha[240 * 1024 + 396 + i]);
  assert.deepEqual(row, [0, 15, 76, 180, 240, 254, 255, 255, 255]);
  const col = Array.from({ length: 9 }, (_, i) => alpha[(96 + i) * 1024 + 512]);
  assert.deepEqual(col, [0, 15, 76, 180, 240, 254, 255, 255, 255]);
});

test("cutout: 绿屏角色 —— 背景全透、主体不透明、嘴部保留", () => {
  const { base } = makeGreenAvatarPair();
  const { image } = cutout(base, "green avatar", true);
  assert.equal(pixel(image, 3, 3)[3], 0);
  assert.equal(pixel(image, 512, 500)[3], 255);
  // The semantic mouth (near the lip line center 512,242) must not be keyed out
  assert.ok(pixel(image, 512, 240)[3] > 200);
  // The subject interior isn't contaminated by green
  const body = pixel(image, 500, 600);
  assert.ok(Math.abs(body[0] - 49) <= 2 && Math.abs(body[1] - 93) <= 2 && Math.abs(body[2] - 139) <= 2);
});

test("cutout: keepCanvas=false → 裁剪到主体 bbox", () => {
  const { base } = makeRectAvatarPair();
  const { image, bbox } = cutout(base, "cropped", false);
  assert.deepEqual(bbox, [327, 97, 698, 1004]);
  assert.equal(image.width, 698 - 327);
  assert.equal(image.height, 1004 - 97);
});
