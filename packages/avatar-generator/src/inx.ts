// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal Inochi2D INP1 (.inx) writer/reader (for generated teachers that passed QA acceptance).
 *
 * Format: MAGIC + big-endian JSON length + JSON model + TEX_SECT + texture count + per texture
 * (big-endian byte length + PNG encoding marker + PNG bytes). Part/parameter uuids are seed-derived
 * deterministic 32-bit random numbers (same seed, same uuids — generated models are reproducible); the random number
 * generator is a standard MT19937 (init_by_array seeding), bit-identical to the uuid values of existing .inx assets.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Raster } from "./image.ts";
import { alphaBand, bandBBox, cloneRaster, cropRaster } from "./image.ts";
import { encodePng } from "./png.ts";

export const MAGIC = "TRNSRTS\0";
const TEX_SECTION = "TEX_SECT";
const TEX_ENCODING_PNG = 0;
const NONE_ID = 4294967295;
const INDICES_QUAD = [0, 2, 1, 2, 3, 1];

// ---------------------------------------------------------------------------
// MT19937 (init_by_array seeding + 32-bit draws)
//
// Mt19937 is adapted from the reference implementation mt19937ar.c (init_genrand, init_by_array, and the 32-bit
// generator), translated to TypeScript.
// Copyright (C) 1997 - 2002, Makoto Matsumoto and Takuji Nishimura, All rights reserved.
// It is under the 3-clause BSD license in ../licenses/mt19937-LICENSE.txt.
// ---------------------------------------------------------------------------

const MT_N = 624;
const MT_M = 397;
const MT_MATRIX_A = 0x9908b0df;
const MT_UPPER_MASK = 0x80000000;
const MT_LOWER_MASK = 0x7fffffff;

/** 32×32 → low 32 bits multiplication (a direct double multiplication would exceed 2^53 and lose precision) */
function mul32(a: number, b: number): number {
  const al = a & 0xffff;
  const ah = a >>> 16;
  const bl = b & 0xffff;
  const bh = b >>> 16;
  const ll = al * bl;
  const mid = al * bh + ah * bl; // ≤ 2^32, exact in double precision
  return (((mid & 0xffff) * 65536 + ll) >>> 0) >>> 0;
}

class Mt19937 {
  private mt = new Uint32Array(MT_N);
  private mti = MT_N + 1;

  constructor(key: Uint32Array) {
    // init_genrand(19650218)
    this.mt[0] = 19650218;
    for (let i = 1; i < MT_N; i++) {
      this.mt[i] = (mul32(1812433253, this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i) >>> 0;
    }
    // init_by_array(key)
    let i = 1;
    let j = 0;
    let k = Math.max(MT_N, key.length);
    for (; k; k--) {
      this.mt[i] =
        ((this.mt[i] ^ mul32(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= MT_N) {
        this.mt[0] = this.mt[MT_N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = MT_N - 1; k; k--) {
      this.mt[i] = ((this.mt[i] ^ mul32(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= MT_N) {
        this.mt[0] = this.mt[MT_N - 1];
        i = 1;
      }
    }
    this.mt[0] = MT_UPPER_MASK;
  }

  genrandUint32(): number {
    if (this.mti >= MT_N) {
      let y: number;
      for (let kk = 0; kk < MT_N - MT_M; kk++) {
        y = (this.mt[kk] & MT_UPPER_MASK) | (this.mt[kk + 1] & MT_LOWER_MASK);
        this.mt[kk] = this.mt[kk + MT_M] ^ (y >>> 1) ^ (y & 1 ? MT_MATRIX_A : 0);
      }
      for (let kk = MT_N - MT_M; kk < MT_N - 1; kk++) {
        y = (this.mt[kk] & MT_UPPER_MASK) | (this.mt[kk + 1] & MT_LOWER_MASK);
        this.mt[kk] = this.mt[kk + (MT_M - MT_N)] ^ (y >>> 1) ^ (y & 1 ? MT_MATRIX_A : 0);
      }
      y = (this.mt[MT_N - 1] & MT_UPPER_MASK) | (this.mt[0] & MT_LOWER_MASK);
      this.mt[MT_N - 1] = this.mt[MT_M - 1] ^ (y >>> 1) ^ (y & 1 ? MT_MATRIX_A : 0);
      this.mti = 0;
    }
    let y = this.mt[this.mti++]!;
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  }
}

/** String seed rule: str + sha512(str) concatenated into a big integer, then split into little-endian 32-bit words as the init_by_array seed */
function pyRandomSeedWords(seed: string): Uint32Array {
  const bytes = Buffer.from(seed, "utf8");
  const digest = createHash("sha512").update(bytes).digest();
  const total = Buffer.concat([bytes, digest]);
  let value = 0n;
  for (const byte of total) {
    value = (value << 8n) | BigInt(byte);
  }
  const bits = value === 0n ? 0 : value.toString(2).length;
  const keyUsed = bits === 0 ? 1 : Math.ceil(bits / 32);
  const key = new Uint32Array(keyUsed);
  let v = value;
  for (let i = 0; i < keyUsed; i++) {
    key[i] = Number(v & 0xffffffffn);
    v >>= 32n;
  }
  return key;
}

/** Seed-derived uuid (bit-identical to the reference implementation's values; falls back to NONE_ID on a NONE_ID collision) */
export function seededUuid(seed: string): number {
  const value = new Mt19937(pyRandomSeedWords(`ainobi-generated-inx:${seed}`)).genrandUint32();
  return value === NONE_ID ? NONE_ID : value;
}

// ---------------------------------------------------------------------------
// Model JSON assembly
// ---------------------------------------------------------------------------

interface PartNode {
  uuid: number;
  name: string;
  type: string;
  enabled: boolean;
  zsort: number;
  transform: Record<string, unknown>;
  lockToRoot: boolean;
  mesh: Record<string, unknown>;
  textures: number[];
  blend_mode: string;
  tint: number[];
  screenTint: number[];
  emissionStrength: number;
  mask_threshold: number;
  opacity: number;
}

function makeTransform(offset: [number, number] = [0, 0]): Record<string, unknown> {
  return {
    trans: [offset[0], offset[1], 0],
    rot: [0, 0, 0],
    scale: [1, 1],
  };
}

function makePart(params: {
  name: string;
  textureIndex: number;
  size: [number, number];
  offset: [number, number];
  zsort: number;
  opacity: number;
  maskThreshold?: number;
}): PartNode {
  const [width, height] = params.size;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return {
    uuid: seededUuid(`part:${params.name}`),
    name: params.name,
    type: "Part",
    enabled: true,
    zsort: params.zsort,
    transform: makeTransform(params.offset),
    lockToRoot: false,
    mesh: {
      verts: [-halfWidth, -halfHeight, -halfWidth, halfHeight, halfWidth, -halfHeight, halfWidth, halfHeight],
      uvs: [0, 0, 0, 1, 1, 0, 1, 1],
      indices: [...INDICES_QUAD],
      origin: [0, 0],
    },
    textures: [params.textureIndex, NONE_ID, NONE_ID],
    blend_mode: "Normal",
    tint: [1, 1, 1],
    screenTint: [0, 0, 0],
    emissionStrength: 1,
    mask_threshold: params.maskThreshold ?? 0.5,
    opacity: params.opacity,
  };
}

function mouthOpenParameter(mouthUuid: number): Record<string, unknown> {
  return {
    uuid: seededUuid("param:Mouth::Open"),
    name: "Mouth::Open",
    is_vec2: false,
    min: [0, 0],
    max: [1, 1],
    defaults: [0, 0],
    axis_points: [[0, 1], [0]],
    bindings: [
      {
        node: mouthUuid,
        param_name: "opacity",
        values: [[0], [1]],
        isSet: [[true], [true]],
        interpolate_mode: "Linear",
      },
    ],
  };
}

/** Cross-fade baked mouth frames: a per-frame opacity gradient on the standard Mouth::Open axis */
function mouthFramesParameter(mouthUuids: number[]): Record<string, unknown> {
  if (mouthUuids.length < 2) {
    throw new Error("a framed mouth parameter needs at least two frames");
  }
  const lastIndex = mouthUuids.length - 1;
  const axisPoints = Array.from({ length: mouthUuids.length }, (_, index) => index / lastIndex);
  const bindings = mouthUuids.map((mouthUuid, frameIndex) => ({
    node: mouthUuid,
    param_name: "opacity",
    values: Array.from({ length: mouthUuids.length }, (_, pointIndex) => [
      pointIndex === frameIndex ? 1 : 0,
    ]),
    isSet: Array.from({ length: mouthUuids.length }, () => [true]),
    interpolate_mode: "Linear",
  }));
  return {
    uuid: seededUuid("param:Mouth::Open"),
    name: "Mouth::Open",
    is_vec2: false,
    min: [0, 0],
    max: [1, 1],
    defaults: [0, 0],
    axis_points: [axisPoints, [0]],
    bindings,
  };
}

/** Nonzero alpha bbox expanded by padding (fully transparent throws) */
function paddedAlphaBbox(raster: Raster, padding = 2): [number, number, number, number] {
  const alpha = alphaBand(raster);
  const bbox = bandBBox(alpha, raster.width, raster.height);
  if (bbox === null) {
    throw new Error("generated avatar cutout is fully transparent");
  }
  return [
    Math.max(0, bbox[0] - padding),
    Math.max(0, bbox[1] - padding),
    Math.min(raster.width, bbox[2] + padding),
    Math.min(raster.height, bbox[3] + padding),
  ];
}

/** RGBA raster → PNG bytes (texture payload) */
function pngBytes(raster: Raster): Uint8Array {
  return encodePng(raster);
}

export interface InochiModelPayload {
  [key: string]: unknown;
}

/**
 * Writes a standard .inx with baked Mouth::Open texture frames.
 *
 * The single-frame path is backward compatible with early generated models; multi-frame avoids squashing one fully open mouth vertically —
 * that would collapse the dark cavity into a black line at intermediate openings.
 */
export async function writeInochiModel(
  baseRgba: Raster,
  mouthOpen: Raster | Raster[],
  mouthBbox: [number, number, number, number],
  outputPath: string,
): Promise<string> {
  const canvasWidth = baseRgba.width;
  const canvasHeight = baseRgba.height;
  const baseBbox = paddedAlphaBbox(baseRgba);
  const baseTexture = cropRaster(baseRgba, baseBbox);

  const [x0, y0, x1, y1] = mouthBbox;
  if (!(0 <= x0 && x0 < x1 && x1 <= canvasWidth && 0 <= y0 && y0 < y1 && y1 <= canvasHeight)) {
    throw new Error("mouth bbox is outside the generated avatar canvas");
  }
  const mouthImages = Array.isArray(mouthOpen) ? mouthOpen : [mouthOpen];
  if (mouthImages.length === 0) {
    throw new Error("at least one mouth texture is required");
  }
  const expectedSize: [number, number] = [x1 - x0, y1 - y0];
  const mouthTextures: Raster[] = [];
  for (const mouthImage of mouthImages) {
    if (mouthImage.width !== expectedSize[0] || mouthImage.height !== expectedSize[1]) {
      throw new Error(
        `mouth texture size ${mouthImage.width}x${mouthImage.height} does not match bbox ` +
          `${expectedSize[0]}x${expectedSize[1]}`,
      );
    }
    mouthTextures.push(cloneRaster(mouthImage));
  }

  const offset = (bbox: [number, number, number, number]): [number, number] => [
    (bbox[0] + bbox[2]) / 2 - canvasWidth / 2,
    (bbox[1] + bbox[3]) / 2 - canvasHeight / 2,
  ];

  const body = makePart({
    name: "body_base",
    textureIndex: 0,
    size: [baseTexture.width, baseTexture.height],
    offset: offset(baseBbox),
    zsort: 1,
    opacity: 1,
  });
  let mouthParts: PartNode[];
  let mouthParameter: Record<string, unknown>;
  if (mouthTextures.length === 1) {
    const part = makePart({
      name: "mouth_open",
      textureIndex: 1,
      size: [mouthTextures[0]!.width, mouthTextures[0]!.height],
      offset: offset(mouthBbox),
      zsort: 0,
      opacity: 0,
      maskThreshold: 0,
    });
    mouthParts = [part];
    mouthParameter = mouthOpenParameter(part.uuid);
  } else {
    mouthParts = mouthTextures.map((texture, index) =>
      makePart({
        name: `mouth_frame_${index}`,
        textureIndex: index + 1,
        size: [texture.width, texture.height],
        offset: offset(mouthBbox),
        zsort: -index / 1000,
        opacity: index === 0 ? 1 : 0,
        maskThreshold: 0,
      }),
    );
    mouthParameter = mouthFramesParameter(mouthParts.map((part) => part.uuid));
  }

  const payload: InochiModelPayload = {
    meta: {
      name: "AINOBI AI Teacher",
      version: "v0.8.6",
      rigger: "AINOBI multimodal avatar pipeline",
      artist: "gpt-image-2",
      rights: null,
      copyright: "",
      licenseURL: "",
      contact: "",
      reference: "multimodal-qa-accepted",
      thumbnailId: NONE_ID,
      preservePixels: false,
    },
    physics: { pixelsPerMeter: 1000, gravity: 9.8 },
    nodes: {
      uuid: seededUuid("root:generated-avatar"),
      name: "Root",
      type: "Node",
      enabled: true,
      zsort: 0,
      transform: makeTransform(),
      lockToRoot: false,
      children: [body, ...mouthParts],
    },
    param: [mouthParameter],
    automation: null,
    animations: null,
    groups: [],
  };

  const jsonBlob = Buffer.from(JSON.stringify(payload), "utf8");
  const textures = [baseTexture, ...mouthTextures];
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from(MAGIC, "latin1"));
  const jsonLen = Buffer.alloc(4);
  jsonLen.writeUInt32BE(jsonBlob.length, 0);
  chunks.push(jsonLen, jsonBlob);
  chunks.push(Buffer.from(TEX_SECTION, "latin1"));
  const count = Buffer.alloc(4);
  count.writeUInt32BE(textures.length, 0);
  chunks.push(count);
  for (const texture of textures) {
    const bytes = pngBytes(texture);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length, 0);
    chunks.push(len, Buffer.from([TEX_ENCODING_PNG]), Buffer.from(bytes));
  }
  const output = Buffer.concat(chunks);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  return outputPath;
}

/** Reads back the INP1 subset this writer produces (self-checking: signature/sections/encoding/no trailing bytes) */
export function readInochiModel(data: Uint8Array): { payload: InochiModelPayload; textures: Uint8Array[] } {
  const buf = Buffer.from(data);
  if (buf.subarray(0, 8).toString("latin1") !== MAGIC) {
    throw new Error("invalid Inochi2D INP1 signature");
  }
  const jsonLength = buf.readUInt32BE(8);
  const payload = JSON.parse(buf.subarray(12, 12 + jsonLength).toString("utf8")) as InochiModelPayload;
  let position = 12 + jsonLength;
  if (buf.subarray(position, position + 8).toString("latin1") !== TEX_SECTION) {
    throw new Error("Inochi2D model is missing TEX_SECT");
  }
  position += 8;
  const textureCount = buf.readUInt32BE(position);
  position += 4;
  const textures: Uint8Array[] = [];
  for (let i = 0; i < textureCount; i++) {
    const textureLength = buf.readUInt32BE(position);
    position += 4;
    const encoding = buf[position];
    position += 1;
    if (encoding !== TEX_ENCODING_PNG) {
      throw new Error("generated Inochi2D texture is not PNG");
    }
    textures.push(Uint8Array.from(buf.subarray(position, position + textureLength)));
    position += textureLength;
  }
  if (position !== buf.length) {
    throw new Error("unexpected trailing bytes in generated Inochi2D model");
  }
  return { payload, textures };
}
