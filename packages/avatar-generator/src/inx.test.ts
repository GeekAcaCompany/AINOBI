// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INP1 writer unit tests — seed uuid goldens (bit-identical to the reference implementation's values),
 * single-frame/multi-frame model write/read round trips (node tree, parameter bindings, texture decoding).
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Raster } from "./image.ts";
import { createRaster, fillEllipse } from "./image.ts";
import { decodePng } from "./png.ts";
import { MAGIC, readInochiModel, seededUuid, writeInochiModel } from "./inx.ts";

test("seededUuid: 种子派生 uuid 黄金（确定性，跨实现一致）", () => {
  // Measured from the reference implementation's random.Random("ainobi-generated-inx:{seed}").getrandbits(32)
  assert.equal(seededUuid("root:generated-avatar"), 2768616871);
  assert.equal(seededUuid("part:body_base"), 3646345224);
  assert.equal(seededUuid("param:Mouth::Open"), 4214914572);
  assert.equal(seededUuid("part:mouth_frame_0"), 3303357730);
  // Same seed, always the same value
  assert.equal(seededUuid("root:generated-avatar"), 2768616871);
});

function ellipseBody(): Raster {
  const base = createRaster(128, 128, [0, 0, 0, 0]);
  fillEllipse(base, [30, 8, 98, 126], [240, 210, 190, 255]);
  return base;
}

function mouthTexture(height: number): Raster {
  const mouth = createRaster(28, 20, [240, 210, 190, 255]);
  fillEllipse(mouth, [8, 8, 20, 8 + height], [70, 15, 25, 255]);
  return mouth;
}

test("inx: 单嘴纹理模型 —— 节点树与标准 Mouth::Open 参数", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ainobi-inx-test-"));
  const path = join(outDir, "model.inx");
  await writeInochiModel(ellipseBody(), mouthTexture(12), [50, 42, 78, 62], path);

  const bytes = new Uint8Array(await readFile(path));
  assert.equal(Buffer.from(bytes.subarray(0, 8)).toString("latin1"), MAGIC);
  const { payload, textures } = readInochiModel(bytes);
  assert.equal(textures.length, 2);
  const children = (payload.nodes as Record<string, unknown>).children as Array<Record<string, unknown>>;
  assert.deepEqual(children.map((node) => node.name), ["body_base", "mouth_open"]);
  const mouthNode = children[1]!;
  assert.equal(mouthNode.opacity, 0);
  const parameter = (payload.param as Array<Record<string, unknown>>)[0]!;
  assert.equal(parameter.name, "Mouth::Open");
  const binding = (parameter.bindings as Array<Record<string, unknown>>)[0]!;
  assert.equal(binding.node, mouthNode.uuid);
  // Texture 0 decodes to a valid PNG (sized after cropping to the subject's alpha bbox)
  const texture0 = decodePng(textures[0]!);
  assert.ok(texture0.width >= 60 && texture0.width <= 80, `width=${texture0.width}`);
  assert.ok(texture0.height >= 110 && texture0.height <= 130, `height=${texture0.height}`);
});

test("inx: 烘焙嘴帧模型 —— 帧节点 opacity 梯度 + 轴点 [0, 0.5, 1]", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ainobi-inx-frames-test-"));
  const path = join(outDir, "model.inx");
  const frames = [1, 6, 12].map((height) => mouthTexture(height));
  await writeInochiModel(ellipseBody(), frames, [50, 42, 78, 62], path);

  const { payload, textures } = readInochiModel(new Uint8Array(await readFile(path)));
  const children = (payload.nodes as Record<string, unknown>).children as Array<Record<string, unknown>>;
  const mouthNodes = children.slice(1);
  assert.equal(textures.length, 4);
  assert.deepEqual(mouthNodes.map((node) => node.name), ["mouth_frame_0", "mouth_frame_1", "mouth_frame_2"]);
  assert.deepEqual(mouthNodes.map((node) => node.opacity), [1, 0, 0]);
  assert.ok(mouthNodes.every((node) => node.mask_threshold === 0));
  const parameter = (payload.param as Array<Record<string, unknown>>)[0]!;
  assert.equal(parameter.name, "Mouth::Open");
  assert.deepEqual((parameter.axis_points as unknown[])[0], [0, 0.5, 1]);
  const bindings = parameter.bindings as Array<Record<string, unknown>>;
  assert.deepEqual(
    bindings.map((binding) => binding.values),
    [[[1], [0], [0]], [[0], [1], [0]], [[0], [0], [1]]],
  );
});

test("inx: 嘴纹理尺寸不匹配 / bbox 越界 / 全透明主体 → 显式报错", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ainobi-inx-err-test-"));
  const wrongSize = createRaster(10, 10, [1, 2, 3, 255]);
  await assert.rejects(
    () => writeInochiModel(ellipseBody(), wrongSize, [50, 42, 78, 62], join(outDir, "b.inx")),
    /does not match bbox/,
  );
  await assert.rejects(
    () => writeInochiModel(ellipseBody(), mouthTexture(12), [50, 42, 200, 300], join(outDir, "c.inx")),
    /outside the generated avatar canvas/,
  );
  const empty = createRaster(64, 64, [0, 0, 0, 0]);
  await assert.rejects(
    () => writeInochiModel(empty, mouthTexture(12), [10, 10, 38, 30], join(outDir, "d.inx")),
    /fully transparent/,
  );
});

test("inx: 读回校验（坏签名/尾字节）", () => {
  assert.throws(() => readInochiModel(new Uint8Array(32)), /signature/);
});
