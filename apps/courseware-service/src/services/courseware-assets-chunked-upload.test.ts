// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { uploadChunkSizeBytes } from "./courseware-assets-chunked-upload.ts";

function totalChunksForSizeLocal(fileSize: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(fileSize / chunkSize));
}

test("uploadChunkSizeBytes is at least 256KB", () => {
  assert.ok(uploadChunkSizeBytes() >= 256 * 1024);
});

test("totalChunksForSize covers edge cases", () => {
  const chunk = 4 * 1024 * 1024;
  assert.equal(totalChunksForSizeLocal(1, chunk), 1);
  assert.equal(totalChunksForSizeLocal(chunk, chunk), 1);
  assert.equal(totalChunksForSizeLocal(chunk + 1, chunk), 2);
  assert.equal(totalChunksForSizeLocal(chunk * 3, chunk), 3);
});
