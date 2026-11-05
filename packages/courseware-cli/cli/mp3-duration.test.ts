// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { readMp3DurationMs } from "./mp3-duration.ts";

/** Minimal valid MPEG-1 Layer III 128kbps 44.1kHz frame (417 bytes, no audio payload). */
const buildSyntheticMpeg1Frame = (frameCount: number): Buffer => {
  const frameSize = 417;
  const buffer = Buffer.alloc(frameCount * frameSize);
  for (let index = 0; index < frameCount; index += 1) {
    const offset = index * frameSize;
    buffer[offset] = 0xff;
    buffer[offset + 1] = 0xfb;
    buffer[offset + 2] = 0x90;
    buffer[offset + 3] = 0x00;
  }
  return buffer;
};

test("readMp3DurationMs walks MPEG frames", () => {
  const frames = 38;
  const duration = readMp3DurationMs(buildSyntheticMpeg1Frame(frames));
  assert.ok(duration != null && duration > 0);
  assert.equal(duration, Math.round((frames * 1152 * 1000) / 44100));
});

test("readMp3DurationMs skips ID3v2 prefix", () => {
  const mp3 = buildSyntheticMpeg1Frame(20);
  const id3 = Buffer.alloc(10 + mp3.length);
  id3.write("ID3", 0, 3, "ascii");
  id3[6] = 0;
  id3[7] = 0;
  id3[8] = 0;
  id3[9] = 0;
  mp3.copy(id3, 10);
  const duration = readMp3DurationMs(id3);
  assert.ok(duration != null && duration > 0);
});

test("readMp3DurationMs returns null for non-mp3 data", () => {
  assert.equal(readMp3DurationMs(Buffer.from("not audio")), null);
});
