// SPDX-License-Identifier: AGPL-3.0-only
/** MPEG-1 Layer III bitrates (kbps); index 0 and 15 are invalid. */
const MPEG1_L3_BITRATE_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;

/** MPEG-2 / MPEG-2.5 Layer III bitrates (kbps). */
const MPEG2_L3_BITRATE_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] as const;

const MPEG1_SAMPLE_RATE_HZ = [44100, 48000, 32000] as const;
const MPEG2_SAMPLE_RATE_HZ = [22050, 24000, 16000] as const;
const MPEG25_SAMPLE_RATE_HZ = [11025, 12000, 8000] as const;

type Mp3Version = "mpeg1" | "mpeg2" | "mpeg2.5";

interface Mp3FrameHeader {
  version: Mp3Version;
  bitrateKbps: number;
  sampleRateHz: number;
  padding: number;
  frameSizeBytes: number;
  samplesPerFrame: number;
}

const skipId3v2Tag = (buffer: Buffer): number => {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "ID3") return 0;
  const size =
    ((buffer[6]! & 0x7f) << 21) |
    ((buffer[7]! & 0x7f) << 14) |
    ((buffer[8]! & 0x7f) << 7) |
    (buffer[9]! & 0x7f);
  return 10 + size;
};

const trailingId3v1TagBytes = (buffer: Buffer): number => {
  if (buffer.length < 128) return 0;
  return buffer.toString("ascii", buffer.length - 128, buffer.length - 125) === "TAG" ? 128 : 0;
};

const parseMp3FrameHeader = (buffer: Buffer, offset: number): Mp3FrameHeader | null => {
  if (offset + 4 > buffer.length) return null;
  if (buffer[offset] !== 0xff || (buffer[offset + 1]! & 0xe0) !== 0xe0) return null;

  const b1 = buffer[offset + 1]!;
  const b2 = buffer[offset + 2]!;

  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits !== 0x01) return null;

  let version: Mp3Version;
  if (versionBits === 0x03) version = "mpeg1";
  else if (versionBits === 0x02) version = "mpeg2";
  else if (versionBits === 0x00) version = "mpeg2.5";
  else return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) return null;

  const bitrateKbps =
    version === "mpeg1"
      ? MPEG1_L3_BITRATE_KBPS[bitrateIndex]!
      : MPEG2_L3_BITRATE_KBPS[bitrateIndex]!;
  const sampleRateHz =
    version === "mpeg1"
      ? MPEG1_SAMPLE_RATE_HZ[sampleRateIndex]!
      : version === "mpeg2"
        ? MPEG2_SAMPLE_RATE_HZ[sampleRateIndex]!
        : MPEG25_SAMPLE_RATE_HZ[sampleRateIndex]!;
  if (!bitrateKbps || !sampleRateHz) return null;

  const samplesPerFrame = version === "mpeg1" ? 1152 : 576;
  const frameSizeBytes =
    version === "mpeg1"
      ? Math.floor((144 * bitrateKbps * 1000) / sampleRateHz) + padding
      : Math.floor((72 * bitrateKbps * 1000) / sampleRateHz) + padding;
  if (frameSizeBytes <= 0) return null;

  return {
    version,
    bitrateKbps,
    sampleRateHz,
    padding,
    frameSizeBytes,
    samplesPerFrame,
  };
};

const findFirstMp3FrameOffset = (buffer: Buffer, start: number): number => {
  const limit = Math.min(buffer.length - 4, start + 8192);
  for (let offset = start; offset < limit; offset += 1) {
    if (parseMp3FrameHeader(buffer, offset)) return offset;
  }
  return -1;
};

/** Walk consecutive MPEG audio frames (accurate for CBR/VBR TTS clips). */
const durationMsByFrameWalk = (buffer: Buffer, start: number): number | null => {
  const end = buffer.length - trailingId3v1TagBytes(buffer);
  let offset = start;
  let frames = 0;
  let sampleRateHz = 0;
  let samplesPerFrame = 0;

  while (offset + 4 <= end) {
    const header = parseMp3FrameHeader(buffer, offset);
    if (!header) break;
    if (frames === 0) {
      sampleRateHz = header.sampleRateHz;
      samplesPerFrame = header.samplesPerFrame;
    } else if (
      header.sampleRateHz !== sampleRateHz ||
      header.samplesPerFrame !== samplesPerFrame
    ) {
      break;
    }
    offset += header.frameSizeBytes;
    frames += 1;
    if (frames > 2_000_000) break;
  }

  if (!frames || !sampleRateHz) return null;
  return Math.round((frames * samplesPerFrame * 1000) / sampleRateHz);
};

const durationMsByCbrSize = (
  buffer: Buffer,
  start: number,
  header: Mp3FrameHeader,
): number => {
  const audioBytes = buffer.length - start - trailingId3v1TagBytes(buffer);
  if (audioBytes <= 0 || header.bitrateKbps <= 0) return 0;
  return Math.round((audioBytes * 8 * 1000) / (header.bitrateKbps * 1000));
};

/**
 * Read playback duration from an in-memory MP3 (ID3 + frame walk).
 * Returns `null` when the buffer does not look like a valid MP3.
 */
export const readMp3DurationMs = (buffer: Buffer): number | null => {
  if (!buffer.length) return null;

  const audioStart = findFirstMp3FrameOffset(buffer, skipId3v2Tag(buffer));
  if (audioStart < 0) return null;

  const walked = durationMsByFrameWalk(buffer, audioStart);
  if (walked != null && walked > 0) return walked;

  const firstHeader = parseMp3FrameHeader(buffer, audioStart);
  if (!firstHeader) return null;
  const cbr = durationMsByCbrSize(buffer, audioStart, firstHeader);
  return cbr > 0 ? cbr : null;
};
