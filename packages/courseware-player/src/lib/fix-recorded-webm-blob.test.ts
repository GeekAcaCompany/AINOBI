// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";

vi.mock("@fix-webm-duration/fix", () => ({
  fixWebmDuration: vi.fn(async (blob: Blob) => blob),
}));

import { fixWebmDuration } from "@fix-webm-duration/fix";

import { fixRecordedWebmBlob } from "./fix-recorded-webm-blob.ts";

describe("fixRecordedWebmBlob", () => {
  it("skips non-webm blobs", async () => {
    const mp4 = new Blob(["x"], { type: "audio/mp4" });
    await expect(fixRecordedWebmBlob(mp4, 5)).resolves.toBe(mp4);
    expect(fixWebmDuration).not.toHaveBeenCalled();
  });

  it("patches webm with duration in milliseconds", async () => {
    const webm = new Blob(["x"], { type: "audio/webm" });
    await fixRecordedWebmBlob(webm, 5.4);
    expect(fixWebmDuration).toHaveBeenCalledWith(webm, 5400, { logger: false });
  });
});
