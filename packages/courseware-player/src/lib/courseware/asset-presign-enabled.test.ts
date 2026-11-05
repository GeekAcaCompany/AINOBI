// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";

describe("isCoursewareAssetPresignEnabled", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns false when config flag is off", async () => {
    vi.doMock("../../host/config.ts", () => ({
      default: { modules: { courseware: { assetPresignEnabled: false } } },
    }));
    const { isCoursewareAssetPresignEnabled } = await import("./asset-presign-enabled.ts");
    expect(isCoursewareAssetPresignEnabled()).toBe(false);
  });

  it("returns true when config flag is on", async () => {
    vi.doMock("../../host/config.ts", () => ({
      default: { modules: { courseware: { assetPresignEnabled: true } } },
    }));
    const { isCoursewareAssetPresignEnabled } = await import("./asset-presign-enabled.ts");
    expect(isCoursewareAssetPresignEnabled()).toBe(true);
  });
});
