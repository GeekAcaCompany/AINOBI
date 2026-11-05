// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mouth localization and frame sequence baking unit tests — locateMouth bbox goldens (measured from the reference implementation),
 * bakeFrames structure (frame names/frame 0 identical to the base patch/mouth opening progression).
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Raster } from "./image.ts";
import { cropRaster } from "./image.ts";
import { decodePng } from "./png.ts";
import { N_FRAMES, bakeFrames, locateMouth, saveDiffDebug } from "./mouth.ts";
import { makeRectAvatarPair, rastersEqual } from "./test_fixtures.ts";

/** Measured from the reference implementation: the semantic anchor ROI of this synthetic character pair */
const PATCH_BBOX: [number, number, number, number] = [435, 201, 589, 335];

test("locateMouth: 灰屏角色对黄金 bbox（ROI 内暗腔收紧 + 外扩钳制）", () => {
  const { base, opened } = makeRectAvatarPair();
  const detected = locateMouth(base, opened, [0, 0], PATCH_BBOX, [512, 242]);
  // Measured from the reference implementation: (473, 227, 552, 300)
  assert.deepEqual(detected, [473, 227, 552, 300]);
});

test("locateMouth: 无暗腔变化（编辑没张嘴）→ null", () => {
  const { base } = makeRectAvatarPair();
  const detected = locateMouth(base, base, [0, 0], PATCH_BBOX, [512, 242]);
  assert.equal(detected, null);
});

test("locateMouth: ROI 外的暗变化不竞争（衣褶保护）", () => {
  const { base, opened } = makeRectAvatarPair();
  // Create a large darkened area on the legs (outside the ROI)
  for (let y = 700; y < 900; y++) {
    for (let x = 400; x < 560; x++) {
      const o = (y * 1024 + x) * 4;
      opened.data[o] = 10;
      opened.data[o + 1] = 10;
      opened.data[o + 2] = 10;
    }
  }
  const detected = locateMouth(base, opened, [0, 0], PATCH_BBOX, [512, 242]);
  assert.deepEqual(detected, [473, 227, 552, 300]);
});

test("locateMouth: 尺寸不一致 / ROI 越界 → 显式报错", () => {
  const { base, opened } = makeRectAvatarPair();
  const small = cropRaster(opened, [0, 0, 512, 512]);
  assert.throws(
    () => locateMouth(base, small, [0, 0], PATCH_BBOX, [512, 242]),
    /same dimensions/,
  );
  assert.throws(
    () => locateMouth(base, opened, [0, 0], [1000, 1000, 2000, 2000], [512, 242]),
    /outside canvas/,
  );
});

test("bakeFrames: 七帧结构 + 帧 0 恒等基础贴片 + 张嘴推进可见", async () => {
  const { base, opened } = makeRectAvatarPair();
  const detected = locateMouth(base, opened, [0, 0], PATCH_BBOX, [512, 242])!;
  const outDir = await mkdtemp(join(tmpdir(), "ainobi-mouth-test-"));
  const names = await bakeFrames(base, opened, [0, 0], PATCH_BBOX, detected, 242, outDir);
  assert.deepEqual(names, ["m0", "m1", "m2", "m3", "m4", "m5", "m6"].map((n) => `${n}.png`));
  assert.equal(names.length, N_FRAMES);

  const frames = await Promise.all(
    names.map(async (name) => decodePng(new Uint8Array(await readFile(join(outDir, name))))),
  );
  // Frame 0 (closed) is identical to the base patch
  const patchBase = cropRaster(base, PATCH_BBOX);
  assert.ok(rastersEqual(frames[0]!, patchBase), "frame 0 must equal the base patch");
  // Intermediate and fully open frames both differ visibly from the closed frame
  assert.ok(!rastersEqual(frames[1]!, frames[0]!));
  assert.ok(!rastersEqual(frames[N_FRAMES - 1]!, frames[0]!));
  // The fully open frame is significantly darker at the detected cavity core
  const core = (frame: Raster, y: number, x: number) => {
    const fy = y - PATCH_BBOX[1];
    const fx = x - PATCH_BBOX[0];
    const idx = (fy * frame.width + fx) * 4;
    return frame.data[idx]!;
  };
  const closedLuma = core(frames[0]!, 260, 512);
  const openLuma = core(frames[N_FRAMES - 1]!, 260, 512);
  assert.ok(
    openLuma < closedLuma - 60,
    `open ${openLuma} must darken vs closed ${closedLuma}`,
  );
});

test("saveDiffDebug: 叠图落盘（红框 ROI + 黄框检出）", async () => {
  const { base } = makeRectAvatarPair();
  const outDir = await mkdtemp(join(tmpdir(), "ainobi-diff-test-"));
  const path = join(outDir, "mouth_debug.png");
  await saveDiffDebug(base, PATCH_BBOX, path, [473, 227, 552, 300]);
  const raster = decodePng(new Uint8Array(await readFile(path)));
  assert.equal(raster.width, 1024);
  // The ROI border line is red
  const o = (201 * 1024 + 435) * 4;
  assert.deepEqual([raster.data[o], raster.data[o + 1], raster.data[o + 2]], [255, 0, 0]);
});
