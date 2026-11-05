// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PNG codec (a minimal implementation of the service's internal image kernel).
 *
 * The avatar pipeline needs to decode the b64 PNGs returned by OpenAI Images into pixels, and re-encode intermediate outputs and textures
 * back to PNG, in a runtime with no native image library. Decoding covers non-interlaced 8/16-bit
 * grayscale/palette/RGB/RGBA critical chunks; encoding always outputs 8-bit RGBA with a per-row filter heuristic
 * and compression (zlib).
 */

import { deflateSync, inflateSync } from "node:zlib";

/** PNG magic number */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 8x8 Raster (interleaved RGBA) — the carrier type of image.ts, only its structure is declared here to avoid a circular dependency */
export interface PngRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// CRC32 (PNG chunk checksum)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

/** Samples per pixel (colorType → count; palette is handled as an index stream) */
const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Unfilters a row (filter 0-4; bpp is the filter look-back bytes = ceil(bit depth/8)×channels) */
function unfilterRow(
  filter: number,
  row: Uint8Array,
  prev: Uint8Array | null,
  out: Uint8Array,
  bpp: number,
): void {
  const len = out.length;
  switch (filter) {
    case 0:
      for (let i = 0; i < len; i++) out[i] = row[i];
      break;
    case 1:
      for (let i = 0; i < len; i++) out[i] = (row[i] + (i >= bpp ? out[i - bpp] : 0)) & 0xff;
      break;
    case 2:
      for (let i = 0; i < len; i++) out[i] = (row[i] + (prev ? prev[i] : 0)) & 0xff;
      break;
    case 3:
      for (let i = 0; i < len; i++) {
        const left = i >= bpp ? out[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        out[i] = (row[i] + ((left + up) >> 1)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < len; i++) {
        const left = i >= bpp ? out[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        const ul = prev && i >= bpp ? prev[i - bpp] : 0;
        out[i] = (row[i] + paeth(left, up, ul)) & 0xff;
      }
      break;
    default:
      throw new Error(`unsupported PNG row filter: ${filter}`);
  }
}

/** Reads palette indexes from a packed row (bitDepth 1/2/4/8) */
function readPaletteIndex(row: Uint8Array, x: number, bitDepth: number): number {
  if (bitDepth === 8) return row[x];
  const perByte = 8 / bitDepth;
  const byteIndex = Math.floor(x / perByte);
  const shift = 8 - bitDepth * ((x % perByte) + 1);
  return (row[byteIndex] >> shift) & ((1 << bitDepth) - 1);
}

/**
 * Decodes PNG bytes into an RGBA Raster.
 *
 * 8/16-bit, grayscale/RGB/grayscale+alpha/RGBA/palette (including tRNS) all work; 16-bit takes the high byte;
 * interlaced PNGs are explicitly rejected (image model output and internal encodings are all non-interlaced).
 */
export function decodePng(bytes: Uint8Array): PngRaster {
  if (bytes.length < 8 || !SIGNATURE.equals(Buffer.from(bytes.subarray(0, 8)))) {
    throw new Error("invalid PNG signature");
  }
  let ihdr: Ihdr | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatChunks: Buffer[] = [];

  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const header = Buffer.from(bytes.buffer, bytes.byteOffset + pos, 8);
    const length = header.readUInt32BE(0);
    const type = bytes.subarray(pos + 4, pos + 8);
    const bodyStart = pos + 8;
    const bodyEnd = bodyStart + length;
    if (bodyEnd + 4 > bytes.length) {
      throw new Error("truncated PNG chunk");
    }
    const body = Uint8Array.from(bytes.subarray(bodyStart, bodyEnd));
    const crcBuf = Buffer.from(bytes.buffer, bytes.byteOffset + bodyEnd, 4);
    if (crcBuf.readUInt32BE(0) !== crc32(Uint8Array.from(bytes.subarray(pos + 4, bodyEnd)))) {
      throw new Error("PNG chunk CRC mismatch");
    }
    const tag = String.fromCharCode(type[0], type[1], type[2], type[3]);
    if (tag === "IHDR") {
      const b = Buffer.from(body);
      ihdr = {
        width: b.readUInt32BE(0),
        height: b.readUInt32BE(4),
        bitDepth: b[8],
        colorType: b[9],
        interlace: b[12],
      };
    } else if (tag === "PLTE") {
      palette = body;
    } else if (tag === "tRNS") {
      trns = body;
    } else if (tag === "IDAT") {
      idatChunks.push(Buffer.from(body));
    } else if (tag === "IEND") {
      break;
    }
    pos = bodyEnd + 4;
  }
  if (!ihdr || ihdr.width <= 0 || ihdr.height <= 0) {
    throw new Error("PNG is missing a usable IHDR");
  }
  if (ihdr.interlace !== 0) {
    throw new Error("interlaced PNG is not supported");
  }
  const channels = CHANNELS_BY_COLOR_TYPE[ihdr.colorType];
  if (channels === undefined) {
    throw new Error(`unsupported PNG color type: ${ihdr.colorType}`);
  }
  const { width, height, bitDepth, colorType } = ihdr;
  const paletteBits = colorType === 3 && (bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8);
  if (!paletteBits && bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  // Packed row byte count (palette packed by bits; everything else whole bytes per sample)
  const rowBytes = paletteBits
    ? Math.ceil((width * bitDepth) / 8)
    : width * channels * (bitDepth === 16 ? 2 : 1);
  // Filter look-back bytes (at least 1, consistent with libpng)
  const filterBpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));

  const rows: Uint8Array[] = [];
  let prev: Uint8Array | null = null;
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p];
    p += 1;
    const packed = Uint8Array.from(raw.subarray(p, p + rowBytes));
    p += rowBytes;
    const unpacked = new Uint8Array(rowBytes);
    unfilterRow(filter, packed, prev, unpacked, filterBpp);
    prev = unpacked;
    rows.push(unpacked);
  }

  const raster: PngRaster = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (paletteBits) {
        const idx = readPaletteIndex(row, x, bitDepth);
        if (!palette || idx * 3 + 2 >= palette.length) {
          throw new Error("PNG references a missing palette entry");
        }
        r = palette[idx * 3];
        g = palette[idx * 3 + 1];
        b = palette[idx * 3 + 2];
        if (trns && idx < trns.length) {
          a = trns[idx];
        }
      } else if (bitDepth === 16) {
        const off = x * channels * 2;
        if (colorType === 0 || colorType === 4) {
          r = g = b = row[off];
          if (colorType === 4) a = row[off + 2];
        } else {
          r = row[off];
          g = row[off + 2];
          b = row[off + 4];
          if (colorType === 6) a = row[off + 6];
        }
      } else {
        const off = x * channels;
        if (colorType === 0 || colorType === 4) {
          r = g = b = row[off];
          if (colorType === 4) a = row[off + 1];
        } else {
          r = row[off];
          g = row[off + 1];
          b = row[off + 2];
          if (colorType === 6) a = row[off + 3];
        }
      }
      const o = (y * width + x) * 4;
      raster.data[o] = r;
      raster.data[o + 1] = g;
      raster.data[o + 2] = b;
      raster.data[o + 3] = a;
    }
  }
  return raster;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Computes the absolute residual sum of a filter (residuals written into the reused out buffer) */
function applyFilter(src: Uint8Array, prev: Uint8Array | null, bpp: number, filter: number, out: Uint8Array): number {
  const len = src.length;
  let score = 0;
  for (let i = 0; i < len; i++) {
    const left = i >= bpp ? src[i - bpp] : 0;
    const up = prev ? prev[i] : 0;
    const ul = prev && i >= bpp ? prev[i - bpp] : 0;
    let value: number;
    switch (filter) {
      case 0: value = src[i]; break;
      case 1: value = src[i] - left; break;
      case 2: value = src[i] - up; break;
      case 3: value = src[i] - ((left + up) >> 1); break;
      default: value = src[i] - paeth(left, up, ul); break;
    }
    out[i] = value & 0xff;
    score += Math.abs(value);
  }
  return score;
}

/** Chunk buffer: byte segments appended by reference (spreading would blow the call stack on MB-sized IDATs) */
type PngChunkSink = { parts: Buffer[]; length: number };

function writeChunk(sink: PngChunkSink, type: string, body: Uint8Array): void {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = new Uint8Array(4 + body.length);
  crcInput.set(typeBuf, 0);
  crcInput.set(body, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  sink.parts.push(len, typeBuf, Buffer.from(body.buffer, body.byteOffset, body.byteLength), crc);
  sink.length += 4 + 4 + body.length + 4;
}

/** Encodes an RGBA Raster to PNG (8-bit RGBA, per-row filter heuristic + zlib compression) */
export function encodePng(raster: PngRaster): Uint8Array {
  const { width, height, data } = raster;
  const bpp = 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const sink: PngChunkSink = { parts: [Buffer.from(SIGNATURE)], length: SIGNATURE.length };
  writeChunk(sink, "IHDR", ihdr);

  const scratch = new Uint8Array(width * bpp);
  const trial = new Uint8Array(width * bpp);
  const rawChunks: Buffer[] = [];
  let prev: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const src = new Uint8Array(data.buffer, data.byteOffset + y * width * bpp, width * bpp);
    let bestFilter = 0;
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (let filter = 0; filter <= 4; filter++) {
      const score = applyFilter(src, prev, bpp, filter, trial);
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        scratch.set(trial);
      }
    }
    const row = Buffer.alloc(1 + width * bpp);
    row[0] = bestFilter;
    row.set(scratch, 1);
    rawChunks.push(row);
    prev = src;
  }
  const compressed = deflateSync(Buffer.concat(rawChunks), { level: 6 });
  writeChunk(sink, "IDAT", new Uint8Array(compressed));
  writeChunk(sink, "IEND", new Uint8Array(0));
  return new Uint8Array(Buffer.concat(sink.parts, sink.length));
}
