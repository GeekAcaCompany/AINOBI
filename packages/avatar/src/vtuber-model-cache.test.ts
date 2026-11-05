// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  getRememberedLive2dUnlockForMountSig,
  parseLive2dMountSigElementIds,
  rememberLive2dUnlockForMountSig,
  resolveInitialLive2dUnlockedThroughIndex,
  shouldPreserveLive2dUnlockAcrossMountSigChange,
} from "./vtuber-model-cache.ts";

describe("resolveInitialLive2dUnlockedThroughIndex", () => {
  it("returns 0 when no models are warm", () => {
    const order = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    expect(
      resolveInitialLive2dUnlockedThroughIndex(order, () => "https://example.com/m.model3.json"),
    ).toBe(0);
  });

  it("returns contiguous warm prefix only", () => {
    const order = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const warm = new Set(["a"]);
    expect(
      resolveInitialLive2dUnlockedThroughIndex(order, (id) =>
        warm.has(id) ? "warm" : "cold",
      ),
    ).toBe(0);
  });
});

describe("shouldPreserveLive2dUnlockAcrossMountSigChange", () => {
  it("is false on first mount and on slide change", () => {
    expect(shouldPreserveLive2dUnlockAcrossMountSigChange("", "a:0|b:1")).toBe(false);
    expect(shouldPreserveLive2dUnlockAcrossMountSigChange("a:0", "c:0|d:1")).toBe(false);
  });

  it("is true when adding a second vtuber on the same slide", () => {
    expect(shouldPreserveLive2dUnlockAcrossMountSigChange("a:0", "a:0|b:1")).toBe(true);
  });
});

describe("parseLive2dMountSigElementIds", () => {
  it("parses element ids from mount sig", () => {
    expect(parseLive2dMountSigElementIds("el_a:0|el_b:1")).toEqual(
      new Set(["el_a", "el_b"]),
    );
  });
});

describe("live2d unlock memory", () => {
  it("restores unlock when returning to the same mount sig", () => {
    const memory = new Map<string, number>();
    rememberLive2dUnlockForMountSig(memory, "el_a:0|el_b:1", 1);
    expect(getRememberedLive2dUnlockForMountSig(memory, "el_a:0|el_b:1")).toBe(1);
    expect(getRememberedLive2dUnlockForMountSig(memory, "el_c:0")).toBeUndefined();
  });
});
