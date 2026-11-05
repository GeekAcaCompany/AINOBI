// SPDX-License-Identifier: AGPL-3.0-only
import { inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP extraction (stored / deflate). Reads exact sizes from the central directory.
 * For extracting PPTX media images (no external dependencies).
 */
export function unzipBuffer(buffer: Buffer): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const eocd = findEndOfCentralDirectory(buffer);
  if (!eocd) {
    return unzipViaLocalHeaders(buffer);
  }

  let offset = eocd.centralDirectoryOffset;
  for (let i = 0; i < eocd.totalEntries; i += 1) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const path = buffer.subarray(nameStart, nameEnd).toString("utf8");
    offset = nameEnd + extraLength + commentLength;
    if (path.endsWith("/")) continue;
    if (localHeaderOffset + 30 > buffer.length) continue;
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) continue;
    const compressed = buffer.subarray(dataStart, dataEnd);
    try {
      const data =
        compression === 0
          ? compressed
          : compression === 8
            ? inflateRawSync(compressed)
            : null;
      if (data) out[path] = data;
    } catch {
      // skip corrupt entry
    }
  }
  return out;
}

function findEndOfCentralDirectory(
  buffer: Buffer,
): { totalEntries: number; centralDirectoryOffset: number } | null {
  // EOCD is near end; comment max 65535 bytes
  const maxScan = Math.min(buffer.length, 65535 + 22);
  for (let i = buffer.length - 22; i >= buffer.length - maxScan; i -= 1) {
    if (i < 0) break;
    if (buffer.readUInt32LE(i) !== 0x06054b50) continue;
    return {
      totalEntries: buffer.readUInt16LE(i + 10),
      centralDirectoryOffset: buffer.readUInt32LE(i + 16),
    };
  }
  return null;
}

function unzipViaLocalHeaders(buffer: Buffer): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const compression = buffer.readUInt16LE(offset + 8);
    let compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const path = buffer.subarray(nameStart, nameEnd).toString("utf8");
    const hasDataDescriptor = (flags & 0x08) !== 0;
    if (hasDataDescriptor && compressedSize === 0) {
      // Cannot stream-scan reliably without descriptor hunt; skip
      break;
    }
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) break;
    const compressed = buffer.subarray(dataStart, dataEnd);
    if (!path.endsWith("/")) {
      try {
        const data =
          compression === 0
            ? compressed
            : compression === 8
              ? inflateRawSync(compressed)
              : null;
        if (data) out[path] = data;
      } catch {
        // skip
      }
    }
    offset = dataEnd;
  }
  return out;
}
