// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  fileWithSanitizedAssetName,
  sanitizeCoursewareAssetFileName,
} from "./sanitize-asset-filename.ts";

describe("sanitizeCoursewareAssetFileName", () => {
  it("strips brackets that break @mention wire tokens", () => {
    expect(sanitizeCoursewareAssetFileName("Z_[04-01] _kiku1.mp3")).toBe(
      "Z_04-01_kiku1.mp3",
    );
  });

  it("replaces path and shell-unsafe characters", () => {
    expect(sanitizeCoursewareAssetFileName('a/b\\c:d*e?.mp3')).toBe("a_b_c_d_e.mp3");
    expect(sanitizeCoursewareAssetFileName("cover|main.png")).toBe("cover_main.png");
  });

  it("collapses repeated underscores and spaces", () => {
    expect(sanitizeCoursewareAssetFileName("Z_  [04]  __.wav")).toBe("Z_04.wav");
  });

  it("preserves normal names and CJK", () => {
    expect(sanitizeCoursewareAssetFileName("リスニング教材.mp3")).toBe("リスニング教材.mp3");
    expect(sanitizeCoursewareAssetFileName("My Slide.png")).toBe("My Slide.png");
  });

  it("falls back when basename becomes empty", () => {
    expect(sanitizeCoursewareAssetFileName("[].mp3")).toBe("file.mp3");
  });

  it("is idempotent", () => {
    const once = sanitizeCoursewareAssetFileName("Z_[04-01] _kiku1.mp3");
    expect(sanitizeCoursewareAssetFileName(once)).toBe(once);
  });
});

describe("fileWithSanitizedAssetName", () => {
  it("returns same File when already safe", () => {
    const file = new File([new Uint8Array([1])], "ok.mp3", { type: "audio/mpeg" });
    expect(fileWithSanitizedAssetName(file)).toBe(file);
  });

  it("returns renamed File when illegal chars present", () => {
    const file = new File([new Uint8Array([1])], "Z_[04-01] _kiku1.mp3", {
      type: "audio/mpeg",
    });
    const next = fileWithSanitizedAssetName(file);
    expect(next).not.toBe(file);
    expect(next.name).toBe("Z_04-01_kiku1.mp3");
    expect(next.type).toBe(file.type);
    expect(next.size).toBe(file.size);
  });
});
